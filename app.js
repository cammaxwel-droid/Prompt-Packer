(function () {
  "use strict";

  var cfg = window.PP_CONFIG || null;
  var Store = window.PPStore || null;
  var Zip = window.PPZip || null;
  var AI = window.PP_AI || null;

  function $(id) {
    return document.getElementById(id);
  }

  function WS() {
    return window.PP_WORKSHOP || null;
  }

  function validModeKey(value) {
    var key = String(value || "");
    if (!key) return "";
    if (/^custom:[A-Za-z0-9_-]{1,40}$/.test(key)) return key;
    var list = (cfg && cfg.workshopModes) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === key) return key;
    }
    return "";
  }

  function modeLabel(key) {
    var ws = WS();
    if (ws && ws.modeByKey) {
      var mode = ws.modeByKey(key);
      if (mode) return mode.label;
    }
    return key ? key.replace(/^custom:/, "") : "";
  }

  function uid(prefix) {
    var bytes = new Uint8Array(6);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < 6; i++) bytes[i] = Math.floor(Math.random() * 256);
    var hex = "";
    for (var j = 0; j < bytes.length; j++) hex += ("0" + bytes[j].toString(16)).slice(-2);
    return (prefix || "p") + hex;
  }

  function safeFileName(value, fallback) {
    var name = String(value || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
    name = name.replace(/^\.+/, "").slice(0, 90);
    return name || (fallback || "prompt");
  }

  function fmtWhen(ts) {
    if (!ts) return "";
    var diff = Date.now() - ts;
    if (diff < 45000) return "just now";
    if (diff < 3600000) return Math.round(diff / 60000) + "m ago";
    if (diff < 86400000) return Math.round(diff / 3600000) + "h ago";
    if (diff < 604800000) return Math.round(diff / 86400000) + "d ago";
    try {
      return new Date(ts).toLocaleDateString();
    } catch (err) {
      return "";
    }
  }

  function fmtSize(bytes) {
    if (!bytes && bytes !== 0) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(2) + " MB";
  }

  function parseTagsInput(value) {
    var seen = {};
    var out = [];
    String(value || "")
      .split(/[,\n]/)
      .forEach(function (raw) {
        var tag = raw.trim().replace(/^#+/, "").slice(0, 40);
        if (!tag) return;
        var key = tag.toLowerCase();
        if (seen[key]) return;
        seen[key] = true;
        out.push(tag);
      });
    return out.slice(0, 24);
  }

  function defaultWorkshop() {
    return { mode: "general", count: 3, style: "balanced", source: "paste", fields: {}, toggles: {}, templates: [], customModes: [], draft: "" };
  }

  function defaultSettings() {
    return {
      theme: "dark",
      aiOpen: true,
      sort: "recent",
      lastFolderId: null,
      lastPromptId: null,
      ai: { provider: "auto", endpoint: "", model: "", temperature: 0.7 },
      workshop: defaultWorkshop()
    };
  }

  function mergeSettings(raw) {
    var base = defaultSettings();
    if (!raw || typeof raw !== "object") return base;
    var out = base;
    Object.keys(base).forEach(function (key) {
      if (key === "ai" || key === "workshop") return;
      if (raw[key] !== undefined) out[key] = raw[key];
    });
    var ai = Object.assign({}, base.ai, raw.ai || {});
    if (ai.provider !== "auto" && ai.provider !== "perchance" && ai.provider !== "endpoint" && ai.provider !== "manual") ai.provider = "auto";
    if (typeof ai.temperature !== "number" || isNaN(ai.temperature)) ai.temperature = 0.7;
    out.ai = ai;
    var ws = Object.assign(defaultWorkshop(), raw.workshop && typeof raw.workshop === "object" ? raw.workshop : {});
    if (typeof ws.mode !== "string" || !ws.mode) ws.mode = "general";
    if (typeof ws.draft !== "string") ws.draft = "";
    if (typeof ws.count !== "number" || ws.count < 2 || ws.count > 10) ws.count = 3;
    if (ws.style !== "conservative" && ws.style !== "balanced" && ws.style !== "experimental") ws.style = "balanced";
    if (!ws.fields || typeof ws.fields !== "object" || Array.isArray(ws.fields)) ws.fields = {};
    if (!ws.toggles || typeof ws.toggles !== "object" || Array.isArray(ws.toggles)) ws.toggles = {};
    ws.templates = Array.isArray(ws.templates) ? ws.templates.filter(function (t) {
      return t && typeof t === "object" && t.key && t.label;
    }).slice(0, 60) : [];
    ws.customModes = Array.isArray(ws.customModes) ? ws.customModes.filter(function (m) {
      return m && typeof m === "object" && m.key && m.label;
    }).slice(0, 40) : [];
    out.workshop = ws;
    return out;
  }

  var TRASH_LIMIT = 300;

  var state = {
    library: { folders: [], prompts: [], trash: [], meta: {} },
    settings: defaultSettings(),
    current: null,
    renderedId: null,
    dirty: false,
    saveTimer: null,
    listRefreshTimer: null,
    collapsed: {},
    ai: { running: false, controller: null, actionId: null, resultText: "", resultKind: "prompt", sourceTitle: "", extra: null },
    ws: {
      open: false,
      mode: "general",
      source: "paste",
      text: "",
      fields: {},
      toggles: {},
      focus: "",
      rating: "",
      count: 3,
      style: "balanced",
      promptId: null,
      promptTitle: "",
      blocks: [],
      running: false,
      controller: null,
      actionKey: null,
      lastSpec: null,
      forceAI: false,
      result: "",
      resultKind: "",
      resultLabel: "",
      resultNote: "",
      variations: null,
      analysis: null,
      history: [],
      chain: [],
      suggested: null,
      dismissed: false,
      adv: false,
      snapshot: null,
      manual: "",
      manualAnswer: "",
      tab: "prompt",
      blocksReady: false
    },
    ui: { selectedFolderId: (cfg && cfg.allFolderId) || "__all__", search: "", filter: "all", sort: "recent" }
  };

  function folderById(id) {
    if (!id) return null;
    for (var i = 0; i < state.library.folders.length; i++) {
      if (state.library.folders[i].id === id) return state.library.folders[i];
    }
    return null;
  }

  function promptById(id) {
    if (!id) return null;
    for (var i = 0; i < state.library.prompts.length; i++) {
      if (state.library.prompts[i].id === id) return state.library.prompts[i];
    }
    return null;
  }

  function trashArray() {
    if (!Array.isArray(state.library.trash)) state.library.trash = [];
    return state.library.trash;
  }

  function trashCount() {
    return trashArray().length;
  }

  function trashPrompt(record, reason) {
    if (!record) return;
    var copy = JSON.parse(JSON.stringify(record));
    delete copy.isDraft;
    copy.fromFolderId = record.folderId || null;
    copy.fromFolderPath = pathOf(record.folderId) || "";
    copy.trashReason = reason || "deleted";
    copy.trashedAt = Date.now();
    state.library.trash = trashArray()
      .filter(function (entry) {
        return entry.id !== copy.id;
      })
      .slice(0, TRASH_LIMIT - 1);
    state.library.trash.unshift(copy);
  }

  function restoreTrashed(id) {
    var trash = trashArray();
    var entry = null;
    for (var i = 0; i < trash.length; i++) {
      if (trash[i].id === id) {
        entry = trash[i];
        break;
      }
    }
    if (!entry) return null;
    state.library.trash = trash.filter(function (item) {
      return item.id !== id;
    });
    var record = entry;
    var home = entry.fromFolderId && folderById(entry.fromFolderId) ? entry.fromFolderId : null;
    delete record.trashedAt;
    delete record.trashReason;
    delete record.fromFolderPath;
    delete record.fromFolderId;
    if (promptById(record.id)) record.id = uid("p");
    record.folderId = home || unsortedFolderId();
    record.updatedAt = Date.now();
    state.library.prompts.push(record);
    return record;
  }

  function purgeTrashed(id) {
    state.library.trash = trashArray().filter(function (entry) {
      return entry.id !== id;
    });
  }

  function restoreTrashedByReason(reason, name) {
    var matches = trashArray().filter(function (entry) {
      if (entry.trashReason !== reason) return false;
      if (!name) return true;
      var path = entry.fromFolderPath || "";
      return path === name || path.indexOf(name) !== -1;
    });
    var restored = 0;
    matches.forEach(function (entry) {
      if (restoreTrashed(entry.id)) restored++;
    });
    return restored;
  }

  function pathOf(folderId, library) {
    var lib = library || state.library;
    var parts = [];
    var node = null;
    for (var i = 0; i < lib.folders.length; i++) {
      if (lib.folders[i].id === folderId) {
        node = lib.folders[i];
        break;
      }
    }
    var guard = 0;
    while (node && guard++ < 30) {
      parts.unshift(node.name);
      var parent = null;
      for (var j = 0; j < lib.folders.length; j++) {
        if (lib.folders[j].id === node.parentId) {
          parent = lib.folders[j];
          break;
        }
      }
      node = parent;
    }
    return parts.join(" > ");
  }

  function splitPath(path) {
    return String(path || "")
      .split(/[>\/\\|]+/)
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);
  }

  function normalizePathKey(path) {
    return splitPath(path).join(" > ").toLowerCase();
  }

  function findFolderByPath(path) {
    var key = normalizePathKey(path);
    if (!key) return null;
    for (var i = 0; i < state.library.folders.length; i++) {
      if (normalizePathKey(pathOf(state.library.folders[i].id)) === key) return state.library.folders[i];
    }
    return null;
  }

  function findFolderByName(name, parentId) {
    var key = String(name || "").trim().toLowerCase();
    for (var i = 0; i < state.library.folders.length; i++) {
      var f = state.library.folders[i];
      if (f.name.toLowerCase() === key && (f.parentId || null) === (parentId || null)) return f;
    }
    return null;
  }

  function ensureFolderPath(path) {
    var segments = splitPath(path);
    if (!segments.length) return null;
    var parentId = null;
    for (var i = 0; i < segments.length; i++) {
      var found = findFolderByName(segments[i], parentId);
      if (!found) {
        found = { id: uid("f"), name: segments[i], parentId: parentId, createdAt: Date.now() };
        state.library.folders.push(found);
      }
      parentId = found.id;
    }
    return parentId;
  }

  function unsortedFolderId() {
    var found = findFolderByPath(cfg.unsortedFolderName);
    if (found) return found.id;
    return ensureFolderPath(cfg.unsortedFolderName);
  }

  function importedFolderId() {
    var found = findFolderByPath(cfg.importedFolderName);
    if (found) return found.id;
    return ensureFolderPath(cfg.importedFolderName);
  }

  function addFolder(name, parentId) {
    var clean = String(name || "").trim().replace(/\s+/g, " ");
    if (!clean) return null;
    if (findFolderByName(clean, parentId)) return null;
    var folder = { id: uid("f"), name: clean.slice(0, 60), parentId: parentId || null, createdAt: Date.now() };
    state.library.folders.push(folder);
    if (parentId) state.collapsed[parentId] = false;
    state.ui.selectedFolderId = folder.id;
    markDirty();
    renderAll();
    return folder;
  }

  function childFolders(parentId) {
    var wanted = parentId || null;
    return state.library.folders
      .filter(function (f) {
        return (f.parentId || null) === wanted;
      })
      .sort(function (a, b) {
        return a.name.localeCompare(b.name, undefined, { numeric: true });
      });
  }

  function descendantFolderIds(rootId) {
    var out = [];
    var queue = [rootId];
    var guard = 0;
    while (queue.length && guard++ < 5000) {
      var current = queue.shift();
      childFolders(current).forEach(function (child) {
        out.push(child.id);
        queue.push(child.id);
      });
    }
    return out;
  }

  function isDescendantOf(folderId, ancestorId) {
    if (!folderId || !ancestorId) return false;
    if (folderId === ancestorId) return true;
    return descendantFolderIds(ancestorId).indexOf(folderId) !== -1;
  }

  function moveFolder(folderId, newParentId, options) {
    var opts = options || {};
    var folder = folderById(folderId);
    if (!folder) return false;
    if (newParentId && isDescendantOf(newParentId, folderId)) return false;
    var previous = folder.parentId || null;
    folder.parentId = newParentId || null;
    markDirty();
    if (!opts.quiet) {
      undoToast("Moved folder \"" + folder.name + "\"", function () {
        folder.parentId = previous;
      });
    }
    return true;
  }

  function deleteFolder(folderId, cascade) {
    var folder = folderById(folderId);
    if (!folder) return { moved: 0, trashed: 0 };
    var doomed = [folderId].concat(descendantFolderIds(folderId));
    var unsafeId = unsortedFolderId();
    var moved = 0;
    var trashed = 0;
    state.library.prompts = state.library.prompts.filter(function (p) {
      if (doomed.indexOf(p.folderId) === -1) return true;
      if (cascade) {
        trashPrompt(p, "folder-deleted");
        trashed++;
        return false;
      }
      p.folderId = unsafeId;
      p.updatedAt = Date.now();
      moved++;
      return true;
    });
    state.library.folders = state.library.folders.filter(function (f) {
      return doomed.indexOf(f.id) === -1;
    });
    if (state.ui.selectedFolderId && doomed.indexOf(state.ui.selectedFolderId) !== -1) {
      state.ui.selectedFolderId = cfg.allFolderId;
    }
    if (state.current && state.current.folderId && doomed.indexOf(state.current.folderId) !== -1) {
      state.current.folderId = unsafeId;
      state.renderedId = null;
    }
    markDirty();
    return { moved: moved, trashed: trashed, name: folder.name, parentId: folder.parentId || null, removedFolders: doomed };
  }

  function promptCounts() {
    var total = state.library.prompts.length;
    var favourites = state.library.prompts.filter(function (p) {
      return !!p.favourite;
    }).length;
    return { total: total, favourites: favourites, folders: state.library.folders.length };
  }

  function searchHit(prompt, query, options) {
    var haystack = [prompt.title || "", prompt.content || "", (prompt.tags || []).join(" "), options && options.folderPath ? options.folderPath : ""].join("\n").toLowerCase();
    var terms = query.split(/\s+/).filter(Boolean);
    for (var i = 0; i < terms.length; i++) {
      if (haystack.indexOf(terms[i]) === -1) return false;
    }
    return true;
  }

  function matchesFilter(prompt) {
    var filter = state.ui.filter;
    if (filter === "all") return true;
    if (filter === "recent") return (prompt.updatedAt || 0) > Date.now() - 7 * 86400000;
    if (filter === "favourites") return !!prompt.favourite;
    if (filter === "nsfw") {
      if (prompt.rating === "nsfw") return true;
      if (prompt.type === "nsfw") return true;
      return (prompt.tags || []).some(function (t) {
        return String(t).toLowerCase() === "nsfw";
      });
    }
    return prompt.type === filter;
  }

  function folderScopeIds() {
    var id = state.ui.selectedFolderId;
    if (!id || id === cfg.allFolderId) return null;
    if (!folderById(id)) return null;
    var map = {};
    map[id] = true;
    descendantFolderIds(id).forEach(function (childId) {
      map[childId] = true;
    });
    return map;
  }

  function sortPrompts(list) {
    var mode = state.ui.sort;
    if (mode === "title") {
      list.sort(function (a, b) {
        return (a.title || "").localeCompare(b.title || "", undefined, { numeric: true, sensitivity: "base" });
      });
    } else if (mode === "title-desc") {
      list.sort(function (a, b) {
        return (b.title || "").localeCompare(a.title || "", undefined, { numeric: true, sensitivity: "base" });
      });
    } else if (mode === "created") {
      list.sort(function (a, b) {
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
    } else if (mode === "folder") {
      list.sort(function (a, b) {
        var pa = pathOf(a.folderId);
        var pb = pathOf(b.folderId);
        return pa.localeCompare(pb) || (b.updatedAt || 0) - (a.updatedAt || 0);
      });
    } else {
      list.sort(function (a, b) {
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });
    }
    return list;
  }

  function visiblePrompts() {
    var query = state.ui.search.trim().toLowerCase();
    var scope = query ? null : folderScopeIds();
    var list = state.library.prompts.filter(function (p) {
      if (scope && !scope[p.folderId]) return false;
      if (!matchesFilter(p)) return false;
      if (query && !searchHit(p, query, { folderPath: pathOf(p.folderId) })) return false;
      return true;
    });
    return sortPrompts(list);
  }

  function libraryStats() {
    var chars = 0;
    var bytes = 0;
    state.library.prompts.forEach(function (p) {
      chars += (p.content || "").length;
      bytes += (p.content || "").length + (p.title || "").length;
    });
    return { chars: chars, bytes: bytes, prompts: state.library.prompts.length, folders: state.library.folders.length };
  }

  function snapshotLibrary() {
    return {
      meta: { app: cfg.appName, version: cfg.version, savedAt: Date.now() },
      folders: state.library.folders.map(function (f) {
        return { id: f.id, name: f.name, parentId: f.parentId || null, createdAt: f.createdAt || Date.now() };
      }),
      prompts: state.library.prompts.map(function (p) {
        return {
          id: p.id,
          title: p.title || "",
          content: p.content || "",
          folderId: p.folderId || null,
          tags: (p.tags || []).slice(),
          type: p.type || "other",
          rating: p.rating || "",
          mode: p.mode || "",
          sourceId: p.sourceId || "",
          favourite: !!p.favourite,
          createdAt: p.createdAt || Date.now(),
          updatedAt: p.updatedAt || p.createdAt || Date.now()
        };
      }),
      trash: trashArray().slice(0, TRASH_LIMIT).map(function (p) {
        return {
          id: p.id,
          title: p.title || "",
          content: p.content || "",
          folderId: p.fromFolderId || null,
          fromFolderId: p.fromFolderId || null,
          fromFolderPath: p.fromFolderPath || "",
          trashReason: p.trashReason || "deleted",
          trashedAt: p.trashedAt || Date.now(),
          tags: (p.tags || []).slice(),
          type: p.type || "other",
          rating: p.rating || "",
          mode: p.mode || "",
          sourceId: p.sourceId || "",
          favourite: !!p.favourite,
          createdAt: p.createdAt || Date.now(),
          updatedAt: p.updatedAt || p.createdAt || Date.now()
        };
      })
    };
  }

  function normalizeLibrary(raw) {
    raw = raw && typeof raw === "object" ? raw : {};
    var dropped = 0;
    var repaired = 0;
    var lib = { folders: [], prompts: [], trash: [], meta: raw.meta && typeof raw.meta === "object" ? raw.meta : {} };
    var seenFolder = {};
    (Array.isArray(raw.folders) ? raw.folders : []).forEach(function (f) {
      if (!f || typeof f !== "object") {
        dropped++;
        return;
      }
      var id = String(f.id || uid("f"));
      if (seenFolder[id]) {
        dropped++;
        return;
      }
      seenFolder[id] = true;
      lib.folders.push({
        id: id,
        name: String(f.name || "Folder").slice(0, 60),
        parentId: f.parentId || null,
        createdAt: Number(f.createdAt) || Date.now()
      });
    });
    lib.folders.forEach(function (f) {
      if (f.parentId && !seenFolder[f.parentId]) {
        f.parentId = null;
        repaired++;
      }
    });
    lib.folders.forEach(function (f) {
      var chain = {};
      var node = f;
      var guard = 0;
      while (node && node.parentId && guard++ < 1000) {
        if (chain[node.id]) {
          node.parentId = null;
          repaired++;
          break;
        }
        chain[node.id] = true;
        node = lib.folders.filter(function (x) {
          return x.id === node.parentId;
        })[0] || null;
      }
      if (guard >= 1000) {
        f.parentId = null;
        repaired++;
      }
    });
    var folderIds = {};
    lib.folders.forEach(function (f) {
      folderIds[f.id] = true;
    });
    var fallbackFolder = null;
    var seenPrompt = {};
    (Array.isArray(raw.prompts) ? raw.prompts : []).forEach(function (p) {
      if (!p || typeof p !== "object") {
        dropped++;
        return;
      }
      var folderId = p.folderId && folderIds[p.folderId] ? p.folderId : null;
      if (!folderId) {
        if (!fallbackFolder) {
          fallbackFolder = lib.folders.filter(function (f) {
            return f.name.toLowerCase() === cfg.unsortedFolderName.toLowerCase() && !f.parentId;
          })[0];
          if (!fallbackFolder) {
            fallbackFolder = { id: uid("f"), name: cfg.unsortedFolderName, parentId: null, createdAt: Date.now() };
            lib.folders.push(fallbackFolder);
            folderIds[fallbackFolder.id] = true;
          }
        }
        folderId = fallbackFolder.id;
      }
      var type = String(p.type || "other");
      if (!cfg.types.some(function (t) {
        return t.key === type;
      })) type = "other";
      var rating = String(p.rating || "");
      if (rating !== "sfw" && rating !== "nsfw") rating = "";
      var pid = String(p.id || uid("p"));
      if (!pid || seenPrompt[pid]) {
        pid = uid("p");
        repaired++;
      }
      seenPrompt[pid] = true;
      lib.prompts.push({
        id: pid,
        title: String(p.title || ""),
        content: String(p.content || ""),
        folderId: folderId,
        tags: Array.isArray(p.tags) ? p.tags.map(function (t) {
          return String(t).slice(0, 40);
        }).slice(0, 24) : [],
        type: type,
        rating: rating,
        mode: validModeKey(p.mode),
        sourceId: p.sourceId ? String(p.sourceId).slice(0, 80) : "",
        favourite: !!p.favourite,
        createdAt: Number(p.createdAt) || Date.now(),
        updatedAt: Number(p.updatedAt) || Number(p.createdAt) || Date.now()
      });
    });
    (Array.isArray(raw.trash) ? raw.trash : []).forEach(function (p) {
      if (!p || typeof p !== "object") {
        dropped++;
        return;
      }
      var tid = String(p.id || uid("p"));
      if (!tid || seenPrompt[tid]) {
        tid = uid("p");
        repaired++;
      }
      seenPrompt[tid] = true;
      var fromFolderId = p.fromFolderId || p.folderId || null;
      if (fromFolderId && !folderIds[fromFolderId]) fromFolderId = null;
      lib.trash.push({
        id: tid,
        title: String(p.title || ""),
        content: String(p.content || ""),
        folderId: fromFolderId,
        fromFolderId: fromFolderId,
        fromFolderPath: String(p.fromFolderPath || ""),
        trashReason: String(p.trashReason || "deleted"),
        trashedAt: Number(p.trashedAt) || Date.now(),
        tags: Array.isArray(p.tags) ? p.tags.map(function (t) {
          return String(t).slice(0, 40);
        }).slice(0, 24) : [],
        type: (function () {
          var t = String(p.type || "other");
          return cfg.types.some(function (x) {
            return x.key === t;
          }) ? t : "other";
        })(),
        rating: p.rating === "sfw" || p.rating === "nsfw" ? p.rating : "",
        mode: validModeKey(p.mode),
        sourceId: p.sourceId ? String(p.sourceId).slice(0, 80) : "",
        favourite: !!p.favourite,
        createdAt: Number(p.createdAt) || Date.now(),
        updatedAt: Number(p.updatedAt) || Number(p.createdAt) || Date.now()
      });
    });
    lib.trash = lib.trash.slice(0, TRASH_LIMIT);
    lib.meta.dropped = dropped;
    lib.meta.repaired = repaired;
    return lib;
  }

  function seedLibrary() {
    var lib = { folders: [], prompts: [], trash: [], meta: { seededAt: Date.now() } };
    state.library = lib;
    cfg.starterFolders.forEach(function (path) {
      ensureFolderPath(path);
    });
    (cfg.starterPrompts || []).forEach(function (seed) {
      var folderId = ensureFolderPath(seed.folderPath) || unsortedFolderId();
      lib.prompts.push({
        id: uid("p"),
        title: seed.title,
        content: seed.content,
        folderId: folderId,
        tags: (seed.tags || []).slice(),
        type: seed.type || "other",
        rating: seed.rating || "",
        favourite: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    });
    return lib;
  }

  function setStatus(kind, text) {
    var node = $("saveStatus");
    if (!node) return;
    var labels = { saved: "Saved", saving: "Saving...", dirty: "Unsaved changes", error: "Could not save" };
    node.className = "save-status " + kind;
    node.textContent = text || labels[kind] || "";
    if (kind === "dirty") {
      var dot = document.createElement("span");
      dot.textContent = "•";
      node.insertBefore(dot, node.firstChild);
    }
  }

  function commitDraftIfFilled() {
    var current = state.current;
    if (!current || !current.isDraft) return false;
    if (!String(current.title || "").trim() && !String(current.content || "").trim()) return false;
    current.isDraft = false;
    delete current.isDraft;
    if (!promptById(current.id)) state.library.prompts.push(current);
    state.ui.selectedPromptId = current.id;
    state.settings.lastPromptId = current.id;
    var del = $("deleteBtn");
    if (del) del.textContent = "Delete";
    return true;
  }

  function markDirty() {
    if (commitDraftIfFilled()) {
      renderTree();
      renderList();
    }
    if (state.current && !state.current.isDraft) state.current.updatedAt = Date.now();
    state.dirty = true;
    setStatus("dirty");
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(function () {
      flushSave();
    }, 800);
  }

  async function flushSave() {
    clearTimeout(state.saveTimer);
    if (!state.dirty) {
      if ($("saveStatus") && $("saveStatus").className.indexOf("saved") === -1) {
        if (Store.getMode() === "memory") setStatus("error", "In memory only");
        else setStatus("saved");
      }
      return;
    }
    setStatus("saving");
    var ok = false;
    try {
      ok = await Store.set(cfg.storageKeyLibrary, snapshotLibrary());
    } catch (err) {
      ok = false;
    }
    state.dirty = false;
    if (ok && Store.getMode() === "memory") setStatus("error", "In memory only");
    else if (ok) setStatus("saved");
    else setStatus("error");
    if (!ok) toast("Could not write to storage: " + (Store.getLastError() || "unknown error"), { type: "err", timeout: 8000 });
    renderStorageNote();
  }

  async function persistSettings() {
    try {
      await Store.set(cfg.storageKeySettings, state.settings);
    } catch (err) {}
  }

  function targetFolderId() {
    var id = state.ui.selectedFolderId;
    if (id && id !== cfg.allFolderId && folderById(id)) return id;
    return unsortedFolderId();
  }

  function createRecord(overrides) {
    var t = Date.now();
    var record = {
      id: uid("p"),
      title: "",
      content: "",
      folderId: targetFolderId(),
      tags: [],
      type: "other",
      rating: "",
      mode: "",
      sourceId: "",
      favourite: false,
      createdAt: t,
      updatedAt: t
    };
    Object.assign(record, overrides || {});
    return record;
  }

  function commitDraft() {
    var current = state.current;
    if (!current) {
      flushSave();
      return null;
    }
    if (!current.isDraft) {
      flushSave();
      return current;
    }
    if (!String(current.title || "").trim() && !String(current.content || "").trim()) {
      state.current = null;
      return null;
    }
    current.isDraft = false;
    delete current.isDraft;
    state.library.prompts.push(current);
    state.ui.selectedPromptId = current.id;
    markDirty();
    flushSave();
    return current;
  }

  function newPrompt(folderId) {
    commitDraft();
    var record = createRecord({ folderId: folderId || targetFolderId() });
    record.isDraft = true;
    state.current = record;
    state.renderedId = null;
    renderAll();
    var title = $("titleInput");
    if (title) title.focus();
  }

  function openPrompt(id) {
    if (state.current && state.current.id === id) return;
    commitDraft();
    var record = promptById(id);
    if (!record) return;
    state.current = record;
    state.ui.selectedPromptId = id;
    state.settings.lastPromptId = id;
    state.renderedId = null;
    renderAll();
    persistSettings();
  }

  function addPromptFromFields(fields) {
    var record = createRecord(fields);
    state.library.prompts.push(record);
    markDirty();
    return record;
  }

  function duplicatePrompt() {
    var current = state.current;
    if (!current) return;
    var copy = addPromptFromFields({
      title: (current.title ? current.title : "Untitled prompt") + " (copy)",
      content: current.content,
      folderId: current.folderId,
      tags: (current.tags || []).slice(),
      type: current.type,
      rating: current.rating,
      favourite: false
    });
    flushSave();
    openPrompt(copy.id);
    renderAll();
    toast("Duplicated as \"" + (copy.title || "Untitled prompt") + "\"", { type: "ok" });
  }

  function deletePrompt(id) {
    var record = promptById(id);
    if (!record) return;
    var title = record.title || "Untitled prompt";
    confirmDialog({
      title: "Move to trash",
      message: "Move \"" + title + "\" to the trash? You can restore it from the Trash folder in the library.",
      confirmLabel: "Move to trash",
      danger: true,
      onConfirm: function () {
        state.library.prompts = state.library.prompts.filter(function (p) {
          return p.id !== id;
        });
        if (state.current && state.current.id === id) {
          state.current = null;
          state.renderedId = null;
        }
        if (state.ui.selectedPromptId === id) state.ui.selectedPromptId = null;
        trashPrompt(record, "deleted");
        markDirty();
        flushSave();
        renderAll();
        toast("Moved \"" + title + "\" to the trash", {
          type: "warn",
          timeout: 12000,
          action: {
            label: "UNDO",
            onClick: function () {
              var restored = restoreTrashed(record.id);
              if (!restored) return;
              markDirty();
              flushSave();
              openPrompt(restored.id);
              renderAll();
            }
          }
        });
      }
    });
  }

  function toggleFavourite(id) {
    var record = promptById(id);
    if (!record) return;
    record.favourite = !record.favourite;
    markDirty();
    flushSave();
    renderAll();
    if (record.favourite) toast("Starred \"" + (record.title || "Untitled prompt") + "\"", { type: "ok" });
  }

  function movePrompt(id, folderId, options) {
    var opts = options || {};
    var record = promptById(id);
    if (!record || !folderById(folderId)) return false;
    if (record.folderId === folderId) return false;
    var previous = record.folderId;
    record.folderId = folderId;
    record.updatedAt = Date.now();
    markDirty();
    flushSave();
    renderAll();
    if (!opts.quiet) {
      undoToast("Moved \"" + (record.title || "Untitled prompt") + "\" to " + (pathOf(folderId) || "folder"), function () {
        record.folderId = previous;
        record.updatedAt = Date.now();
      });
    }
    return true;
  }

  function applyTags(record, tags, mode) {
    var incoming = parseTagsInput((tags || []).join(","));
    if (mode === "replace") {
      record.tags = incoming;
    } else {
      var seen = {};
      var merged = [];
      (record.tags || []).concat(incoming).forEach(function (tag) {
        var key = tag.toLowerCase();
        if (seen[key]) return;
        seen[key] = true;
        merged.push(tag);
      });
      record.tags = merged.slice(0, 24);
    }
    return record.tags;
  }

  function listAsTxt(filterFn, name) {
    var prompts = state.library.prompts.filter(filterFn || function () {
      return true;
    });
    prompts = sortPrompts(prompts);
    var lines = [];
    lines.push(cfg.appName + " export");
    lines.push("Exported: " + new Date().toISOString());
    lines.push("Prompts: " + prompts.length);
    lines.push("");
    prompts.forEach(function (p) {
      lines.push("======================================================================");
      lines.push("TITLE: " + (p.title || "Untitled prompt"));
      lines.push("FOLDER: " + (pathOf(p.folderId) || "(none)"));
      lines.push("TYPE: " + p.type + "   LABEL: " + (p.rating || "none") + "   TAGS: " + ((p.tags || []).join(", ") || "none"));
      lines.push("======================================================================");
      lines.push("");
      lines.push(p.content || "");
      lines.push("");
      lines.push("");
    });
    return lines.join("\n");
  }

  function txtForPrompt(prompt) {
    return (prompt.content || "") + "\n";
  }

  function zipFolder(folderId, rootName) {
    var scope = {};
    scope[folderId] = true;
    descendantFolderIds(folderId).forEach(function (id) {
      scope[id] = true;
    });
    var prompts = state.library.prompts.filter(function (p) {
      return scope[p.folderId];
    });
    prompts = sortPrompts(prompts);
    var files = [];
    var used = {};
    prompts.forEach(function (p) {
      var parts = [];
      var node = folderById(p.folderId);
      var guard = 0;
      while (node && guard++ < 30) {
        parts.unshift(safeFileName(node.name, "folder"));
        node = node.parentId ? folderById(node.parentId) : null;
      }
      if (rootName) parts.unshift(safeFileName(rootName, "folder"));
      var base = safeFileName(p.title || "prompt", "prompt");
      var path = parts.concat([base + ".txt"]).join("/");
      var n = 2;
      while (used[path]) {
        path = parts.concat([base + " (" + n++ + ").txt"]).join("/");
      }
      used[path] = true;
      files.push({ path: path, data: txtForPrompt(p) });
    });
    return { files: files, count: prompts.length };
  }

  function zipAll() {
    var files = [];
    var used = {};
    var prompts = sortPrompts(state.library.prompts.slice());
    prompts.forEach(function (p) {
      var parts = [];
      var node = folderById(p.folderId);
      var guard = 0;
      while (node && guard++ < 30) {
        parts.unshift(safeFileName(node.name, "folder"));
        node = node.parentId ? folderById(node.parentId) : null;
      }
      parts.unshift("prompts");
      var base = safeFileName(p.title || "prompt", "prompt");
      var path = parts.concat([base + ".txt"]).join("/");
      var n = 2;
      while (used[path]) {
        path = parts.concat([base + " (" + n++ + ").txt"]).join("/");
      }
      used[path] = true;
      files.push({ path: path, data: txtForPrompt(p) });
    });
    files.push({ path: "prompt-packer-backup.json", data: JSON.stringify(backupObject(), null, 2) });
    files.push({ path: "README.txt", data: readmeForZip() });
    return { files: files, count: prompts.length };
  }

  function readmeForZip() {
    return [
      cfg.appName + " export",
      "====================",
      "",
      "prompts/            one .txt file per prompt, inside a folder tree that mirrors your library",
      "prompt-packer-backup.json",
      "                    full backup: prompts, folders, tags, settings",
      "",
      "Restore this backup with: " + cfg.appName + " > Import Backup.",
      "The .txt files are plain text - you can read, edit or feed them to any tool.",
      "",
      "Exported: " + new Date().toISOString()
    ].join("\n");
  }

  function backupObject() {
    var snapshot = snapshotLibrary();
    snapshot.app = cfg.backupFormat;
    snapshot.backupVersion = cfg.backupVersion;
    snapshot.version = cfg.version;
    snapshot.exportedAt = new Date().toISOString();
    snapshot.settings = {
      theme: state.settings.theme,
      sort: state.settings.sort,
      ai: {
        provider: state.settings.ai.provider,
        endpoint: state.settings.ai.endpoint,
        model: state.settings.ai.model,
        temperature: state.settings.ai.temperature
      }
    };
    return snapshot;
  }

  function downloadBlob(filename, blob) {
    try {
      var url = URL.createObjectURL(blob);
      var link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      setTimeout(function () {
        URL.revokeObjectURL(url);
        link.remove();
      }, 4000);
      toast("Downloading " + filename, { type: "ok", timeout: 5000 });
      return true;
    } catch (err) {
      toast("Download failed: " + (err && err.message ? err.message : err), { type: "err", timeout: 8000 });
      return false;
    }
  }

  function downloadText(filename, text, mime) {
    return downloadBlob(filename, new Blob([text], { type: mime || "text/plain;charset=utf-8" }));
  }

  function readFileText(file) {
    if (file && typeof file.text === "function") return file.text();
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ""));
      };
      reader.onerror = function () {
        reject(reader.error || new Error("Could not read file"));
      };
      reader.readAsText(file);
    });
  }

  async function importTxtFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    var folderId = importedFolderId();
    var added = 0;
    var skipped = 0;
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      var name = String(file.name || "prompt.txt");
      var looksText = /\.(txt|md|markdown|text|prompt)$/i.test(name) || (file.type || "").indexOf("text") === 0 || !file.type;
      if (!looksText) {
        skipped++;
        continue;
      }
      var text = "";
      try {
        text = await readFileText(file);
      } catch (err) {
        skipped++;
        continue;
      }
      text = text.replace(/\r\n?/g, "\n").trim();
      if (!text) {
        skipped++;
        continue;
      }
      var title = name.replace(/\.[^.]+$/, "").replace(/[_\s]+/g, " ").trim();
      state.library.prompts.push(
        createRecord({
          title: title || "Imported prompt",
          content: text,
          folderId: folderId,
          type: "other",
          tags: ["imported"]
        })
      );
      added++;
    }
    markDirty();
    await flushSave();
    state.ui.selectedFolderId = folderId;
    state.ui.filter = "all";
    state.ui.search = "";
    var search = $("searchInput");
    if (search) search.value = "";
    renderAll();
    if (added) {
      toast("Imported " + added + " prompt" + (added === 1 ? "" : "s") + " into " + cfg.importedFolderName + (skipped ? ", " + skipped + " skipped" : "") + ". Use AUTO ORGANISE LIBRARY to file them.", { type: "ok", timeout: 10000 });
    } else {
      toast("Nothing imported" + (skipped ? " - " + skipped + " unsupported file(s) skipped" : ""), { type: "warn" });
    }
  }

  async function importBackupFile(file) {
    var text = await readFileText(file);
    var parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      toast("That file is not valid JSON", { type: "err" });
      return;
    }
    var incoming = null;
    if (parsed && Array.isArray(parsed.prompts) && Array.isArray(parsed.folders)) incoming = parsed;
    else if (parsed && parsed.library && Array.isArray(parsed.library.prompts)) incoming = parsed.library;
    if (!incoming) {
      toast("That does not look like a " + cfg.appName + " backup", { type: "err" });
      return;
    }
    var normalized = normalizeLibrary(incoming);
    var dropped = (normalized.meta && normalized.meta.dropped) || 0;
    var incomingVersion = Number(parsed.backupVersion != null ? parsed.backupVersion : parsed.version);
    var tooNew = !isNaN(incomingVersion) && incomingVersion > cfg.backupVersion;
    var existing = {};
    state.library.prompts.forEach(function (p) {
      existing[p.id] = true;
    });
    var newPrompts = normalized.prompts.filter(function (p) {
      return !existing[p.id];
    });
    var existingFolders = {};
    state.library.folders.forEach(function (f) {
      existingFolders[f.id] = true;
    });
    var newFolders = normalized.folders.filter(function (f) {
      return !existingFolders[f.id];
    });
    var existingTrash = {};
    trashArray().forEach(function (p) {
      existingTrash[p.id] = true;
    });
    var newTrash = (normalized.trash || []).filter(function (p) {
      return !existingTrash[p.id];
    });
    var body = [
      para("Backup contains " + normalized.prompts.length + " prompt(s), " + normalized.folders.length + " folder(s) and " + (normalized.trash || []).length + " trashed item(s)."),
      para("Your library currently has " + state.library.prompts.length + " prompt(s)."),
      para("MERGE adds the " + newPrompts.length + " prompt(s) and " + newFolders.length + " folder(s) that are not already here and leaves your current prompts untouched.", "hint"),
      para("REPLACE deletes your current library and restores the backup exactly.", "hint")
    ];
    if (dropped) {
      body.push(para("Warning: " + dropped + " entr" + (dropped === 1 ? "y" : "ies") + " in this file could not be read and will be skipped.", "hint"));
    }
    if (tooNew) {
      body.push(para("This backup was written by a newer version of the app (format " + incomingVersion + ", this app understands " + cfg.backupVersion + "). It will be imported as-is, but some fields may be ignored.", "hint"));
    }
    var dialog = modal({
      title: "Import backup",
      wide: false,
      body: body,
      buttons: [
        {
          label: "Merge",
          kind: "primary",
          onClick: function () {
            state.library.folders = state.library.folders.concat(newFolders);
            state.library.prompts = state.library.prompts.concat(newPrompts);
            if (newTrash.length) state.library.trash = trashArray().concat(newTrash).slice(0, TRASH_LIMIT);
            markDirty();
            flushSave();
            renderAll();
            toast("Merged " + newPrompts.length + " prompt(s)", { type: "ok" });
          }
        },
        {
          label: "Replace library",
          kind: "danger",
          keepOpen: true,
          onClick: function () {
            confirmDialog({
              title: "Replace entire library?",
              message: "This deletes all " + state.library.prompts.length + " prompt(s) currently in this browser and restores " + normalized.prompts.length + " prompt(s) from the backup.",
              confirmLabel: "Yes, replace everything",
              danger: true,
              onConfirm: function () {
                state.library = normalized;
                state.current = null;
                state.renderedId = null;
                state.ui.selectedPromptId = null;
                state.ui.selectedFolderId = cfg.allFolderId;
                if (incoming.settings) {
                  state.settings = mergeSettings(incoming.settings);
                  applyTheme();
                  persistSettings();
                }
                markDirty();
                flushSave();
                renderAll();
                toast("Library replaced with backup", { type: "ok" });
                dialog.close();
              }
            });
          }
        },
        { label: "Cancel", kind: "ghost" }
      ]
    });
    return dialog;
  }

  function exportBackup() {
    var name = "prompt-packer-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    downloadText(name, JSON.stringify(backupObject(), null, 2), "application/json");
  }

  function exportPromptTxt(prompt) {
    var record = prompt || state.current;
    if (!record) return;
    downloadText(safeFileName(record.title || "prompt", "prompt") + ".txt", txtForPrompt(record));
  }

  function exportFolderZip() {
    var folderId = state.ui.selectedFolderId;
    if (!folderId || folderId === cfg.allFolderId) {
      toast("Select a folder in the library first (or use Export / Backup > Entire library as ZIP)", { type: "warn", timeout: 9000 });
      return;
    }
    var folder = folderById(folderId);
    var result = zipFolder(folderId, null);
    if (!result.count) {
      toast("No prompts in " + (folder ? folder.name : "that folder"), { type: "warn" });
      return;
    }
    var blob = Zip.build(result.files);
    downloadBlob(safeFileName(folder ? folder.name : "folder", "folder") + "-prompts.zip", blob);
  }

  function exportAllZip() {
    var result = zipAll();
    var blob = Zip.build(result.files);
    downloadBlob("prompt-packer-export-" + new Date().toISOString().slice(0, 10) + ".zip", blob);
  }

  function exportAllTxt() {
    downloadText("prompt-packer-all-prompts.txt", listAsTxt(null));
  }

  function storageNoteText() {
    var mode = Store.getMode();
    var where = mode === "idb" ? "IndexedDB" : mode === "local" ? "localStorage" : "memory only";
    var stats = libraryStats();
    var bits = [mode === "memory" ? "Stored in memory only - saving may not survive a reload" : "Stored locally in this browser (" + where + ")"];
    bits.push(stats.prompts + " prompts, " + stats.folders + " folders, " + fmtSize(stats.bytes + 2048) + " of text");
    if (mode === "memory") bits.push("Allow storage for this site to keep your prompts.");
    return bits.join(" · ");
  }

  function renderStorageNote() {
    var node = $("storageNote");
    if (node) node.textContent = storageNoteText();
  }

  function applyTheme() {
    var theme = state.settings.theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#eef1f6" : "#0e1014");
  }

  function isPreviewLayout() {
    var base = appBase();
    return /\/src\/$/.test(base);
  }

  function appBase() {
    var src = "";
    try {
      if (document.currentScript && document.currentScript.src) src = document.currentScript.src;
    } catch (err) {}
    if (!src) {
      var scripts = document.getElementsByTagName("script");
      for (var i = scripts.length - 1; i >= 0; i--) {
        if (/app\.js(\?|$)/.test(scripts[i].src || "")) {
          src = scripts[i].src;
          break;
        }
      }
    }
    if (!src) return "";
    return src.replace(/[^/]*$/, "");
  }

  async function setupPwa() {
    if (isPreviewLayout()) return;
    var base = appBase();
    if (!base) return;
    try {
      if (!document.querySelector('link[rel="manifest"]')) {
        var link = document.createElement("link");
        link.rel = "manifest";
        link.href = base + "manifest.webmanifest";
        document.head.appendChild(link);
      }
    } catch (err) {}
    if (!("serviceWorker" in navigator)) return;
    try {
      var registration = await navigator.serviceWorker.register(base + "sw.js", { scope: base });
      registration.addEventListener("updatefound", function () {
        toast("A new version of Prompt Packer is installing. It will be ready next time you reload.", { type: "warn", timeout: 8000 });
      });
    } catch (err) {
      if (location.protocol !== "file:") console.warn("Service worker registration failed:", err);
    }
  }

  function node(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  function para(text, className) {
    return node("p", className, text);
  }

  function appendBody(target, body) {
    if (body == null) return;
    if (Array.isArray(body)) {
      body.forEach(function (entry) {
        appendBody(target, entry);
      });
      return;
    }
    if (typeof body === "string") {
      target.appendChild(node("div", null, body));
      return;
    }
    target.appendChild(body);
  }

  var modalStack = [];

  function modal(options) {
    var opts = options || {};
    var scrim = node("div", "modal-scrim");
    var box = node("div", "modal" + (opts.wide ? " wide" : ""));
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    if (opts.title) {
      var headId = uid("modal-title");
      var head = node("div", "modal-head", opts.title);
      head.id = headId;
      box.setAttribute("aria-labelledby", headId);
      box.appendChild(head);
    } else {
      box.setAttribute("aria-label", opts.ariaLabel || "Dialog");
    }
    var body = node("div", "modal-body" + (opts.bodyClass ? " " + opts.bodyClass : ""));
    appendBody(body, opts.body);
    box.appendChild(body);
    var api = { close: close, box: box, body: body };
    var buttons = opts.buttons || [];
    if (buttons.length) {
      var foot = node("div", "modal-foot");
      buttons.forEach(function (spec) {
        var cls = "btn";
        if (spec.kind) cls += " " + spec.kind;
        var button = node("button", cls, spec.label);
        button.addEventListener("click", function () {
          var keepOpen = false;
          if (spec.onClick) {
            try {
              keepOpen = spec.onClick() === false;
            } catch (err) {
              console.error(err);
              toast("Something went wrong: " + (err && err.message ? err.message : err), { type: "err" });
            }
          }
          if (spec.keepOpen || opts.keepOpen) keepOpen = true;
          if (!keepOpen) close();
        });
        foot.appendChild(button);
      });
      box.appendChild(foot);
    }
    scrim.appendChild(box);
    scrim.addEventListener("mousedown", function (event) {
      if (event.target === scrim && opts.dismissible !== false) close();
    });
    var restoreFocus = document.activeElement && document.activeElement.focus ? document.activeElement : null;
    function focusables() {
      return Array.prototype.slice
        .call(box.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"))
        .filter(function (el) {
          return !el.disabled && el.getClientRects().length > 0;
        });
    }
    function onKey(event) {
      if (event.key === "Escape") {
        if (modalStack.length && modalStack[modalStack.length - 1] !== api) return;
        event.stopPropagation();
        close();
        return;
      }
      if (event.key === "Tab") {
        if (modalStack.length && modalStack[modalStack.length - 1] !== api) return;
        var list = focusables();
        if (!list.length) return;
        var first = list[0];
        var last = list[list.length - 1];
        if (event.shiftKey && (document.activeElement === first || !box.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    function close() {
      document.removeEventListener("keydown", onKey, true);
      if (scrim.parentNode) scrim.parentNode.removeChild(scrim);
      modalStack = modalStack.filter(function (entry) {
        return entry !== api;
      });
      if (restoreFocus) {
        try {
          restoreFocus.focus();
        } catch (err) {}
      }
    }
    document.addEventListener("keydown", onKey, true);
    $("modalRoot").appendChild(scrim);
    modalStack.push(api);
    var focusTarget = opts.focus || null;
    setTimeout(function () {
      try {
        if (focusTarget) focusTarget.focus();
      } catch (err) {}
    }, 40);
    return api;
  }

  function textPromptDialog(opts) {
    var input = node("input", "input");
    input.value = opts.value == null ? "" : opts.value;
    if (opts.placeholder) input.placeholder = opts.placeholder;
    var submitted = false;
    function submit() {
      var value = input.value.trim();
      if (!value) {
        toast("Type a name first", { type: "warn" });
        return false;
      }
      submitted = true;
      if (opts.onConfirm) opts.onConfirm(value);
      return true;
    }
    var api = modal({
      title: opts.title,
      body: [para(opts.message || "", "hint"), input],
      focus: input,
      buttons: [
        { label: opts.confirmLabel || "Save", kind: "primary", onClick: submit },
        { label: "Cancel", kind: "ghost" }
      ]
    });
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        if (submit()) api.close();
      }
    });
    input.addEventListener("keyup", function () {
      submitted = submitted || false;
    });
    return api;
  }

  function confirmDialog(opts) {
    var body = [para(opts.message || "")];
    if (opts.extra) body = body.concat(opts.extra);
    return modal({
      title: opts.title || "Are you sure?",
      body: body,
      buttons: [
        {
          label: opts.confirmLabel || "Confirm",
          kind: opts.danger ? "danger" : "primary",
          onClick: opts.onConfirm
        },
        { label: opts.cancelLabel || "Cancel", kind: "ghost" }
      ]
    });
  }

  function toast(message, opts) {
    var options = opts || {};
    var root = $("toastRoot");
    if (!root) return { dismiss: function () {} };
    var el = node("div", "toast" + (options.type ? " " + options.type : ""));
    el.setAttribute("role", options.type === "err" ? "alert" : "status");
    el.appendChild(node("span", null, message));
    var timer = null;
    function dismiss() {
      if (timer) clearTimeout(timer);
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    if (options.action) {
      var button = node("button", "toast-action", options.action.label);
      button.setAttribute("aria-label", (options.action.label || "Action") + ": " + message);
      button.addEventListener("click", function () {
        try {
          options.action.onClick();
        } catch (err) {
          console.error(err);
        }
        dismiss();
      });
      el.appendChild(button);
    }
    root.appendChild(el);
    timer = setTimeout(dismiss, options.timeout || 4200);
    return { dismiss: dismiss };
  }

  function undoToast(message, revert, options) {
    var opts = options || {};
    toast(message, {
      type: opts.type || "ok",
      timeout: opts.timeout || 12000,
      action: {
        label: "UNDO",
        onClick: function () {
          try {
            revert();
          } catch (err) {
            console.error(err);
            toast("Could not undo that change", { type: "err" });
            return;
          }
          markDirty();
          flushSave();
          renderAll();
          toast("Undone", { type: "ok", timeout: 2500 });
        }
      }
    });
  }

  function showTextModal(title, text) {
    var area = node("textarea", "input textarea-mono");
    area.value = text;
    area.readOnly = true;
    modal({
      title: title,
      body: [para("Select the text and copy it manually.", "hint"), area],
      focus: area,
      buttons: [{ label: "Close", kind: "ghost" }]
    });
    setTimeout(function () {
      try {
        area.select();
      } catch (err) {}
    }, 60);
  }

  async function copyText(text, label) {
    var value = String(text == null ? "" : text);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
        toast((label || "Prompt") + " copied to clipboard", { type: "ok" });
        return true;
      }
    } catch (err) {}
    try {
      var area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.top = "-2000px";
      document.body.appendChild(area);
      area.select();
      area.setSelectionRange(0, value.length);
      var ok = document.execCommand("copy");
      area.remove();
      if (ok) {
        toast((label || "Prompt") + " copied to clipboard", { type: "ok" });
        return true;
      }
    } catch (err) {}
    showTextModal("Copy " + (label || "text") + " manually", value);
    return false;
  }

  function buildFolderCounts() {
    var counts = {};
    state.library.prompts.forEach(function (p) {
      var id = p.folderId;
      var guard = 0;
      while (id && guard++ < 30) {
        counts[id] = (counts[id] || 0) + 1;
        var folder = folderById(id);
        id = folder ? folder.parentId : null;
      }
    });
    return counts;
  }

  function folderTreeEach(parentId, depth, callback, includeCollapsed) {
    childFolders(parentId).forEach(function (folder) {
      callback(folder, depth);
      if (includeCollapsed || !state.collapsed[folder.id]) folderTreeEach(folder.id, depth + 1, callback, includeCollapsed);
    });
  }

  function renderTree() {
    var root = $("folderTree");
    if (!root) return;
    root.setAttribute("role", "tree");
    root.setAttribute("aria-label", "Folder tree");
    var counts = buildFolderCounts();
    var total = state.library.prompts.length;
    root.innerHTML = "";
    var allRow = node("div", "trow" + (state.ui.selectedFolderId === cfg.allFolderId ? " selected" : ""));
    allRow.tabIndex = 0;
    allRow.setAttribute("role", "treeitem");
    allRow.setAttribute("aria-selected", state.ui.selectedFolderId === cfg.allFolderId ? "true" : "false");
    allRow.appendChild(node("span", "twist", "\u2022"));
    allRow.appendChild(node("span", "trow-name", "ALL PROMPTS"));
    allRow.appendChild(node("span", "trow-count", String(total)));
    allRow.addEventListener("click", function () {
      selectFolder(cfg.allFolderId);
    });
    allRow.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectFolder(cfg.allFolderId);
      }
    });
    allRow.addEventListener("dragover", function (event) {
      if (!dragPayload) return;
      event.preventDefault();
      allRow.classList.add("drop-hover");
    });
    allRow.addEventListener("dragleave", function () {
      allRow.classList.remove("drop-hover");
    });
    allRow.addEventListener("drop", function (event) {
      event.preventDefault();
      allRow.classList.remove("drop-hover");
      onFolderDrop(event, unsortedFolderId());
    });
    root.appendChild(allRow);
    folderTreeEach(null, 0, function (folder, depth) {
      root.appendChild(folderRow(folder, depth, counts));
    });
    var trashTotal = trashCount();
    if (trashTotal > 0) {
      var trashRow = node("div", "trow trow-trash");
      trashRow.tabIndex = 0;
      trashRow.setAttribute("role", "treeitem");
      trashRow.setAttribute("aria-selected", "false");
      trashRow.appendChild(node("span", "twist", "\u267B"));
      trashRow.appendChild(node("span", "trow-name", "TRASH"));
      trashRow.appendChild(node("span", "trow-count", String(trashTotal)));
      trashRow.title = "Deleted prompts wait here until you remove them";
      trashRow.setAttribute("aria-label", "Trash, " + trashTotal + " item(s)");
      trashRow.addEventListener("click", function () {
        openTrashDialog();
      });
      trashRow.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openTrashDialog();
        }
      });
      root.appendChild(trashRow);
    }
  }

  function folderRow(folder, depth, counts) {
    var children = childFolders(folder.id);
    var collapsed = !!state.collapsed[folder.id];
    var row = node("div", "trow" + (state.ui.selectedFolderId === folder.id ? " selected" : ""));
    row.dataset.folderId = folder.id;
    row.draggable = !isTouchDevice;
    row.title = pathOf(folder.id);
    row.tabIndex = 0;
    row.setAttribute("role", "treeitem");
    row.setAttribute("aria-level", String(depth + 1));
    row.setAttribute("aria-selected", state.ui.selectedFolderId === folder.id ? "true" : "false");
    if (children.length) row.setAttribute("aria-expanded", collapsed ? "false" : "true");
    var twist = node("span", "twist", children.length ? (collapsed ? "\u25B8" : "\u25BE") : "\u00b7");
    if (children.length) {
      twist.style.cursor = "pointer";
      twist.addEventListener("click", function (event) {
        event.stopPropagation();
        state.collapsed[folder.id] = !collapsed;
        renderTree();
      });
    }
    row.appendChild(twist);
    var name = node("span", "trow-name", folder.name);
    if (depth) name.style.paddingLeft = depth * 8 + "px";
    row.appendChild(name);
    row.appendChild(node("span", "trow-count", String(counts[folder.id] || 0)));
    var menu = node("button", "trow-menu", "\u22ef");
    menu.title = "Folder actions";
    menu.setAttribute("aria-label", "Actions for folder " + folder.name);
    menu.addEventListener("click", function (event) {
      event.stopPropagation();
      openFolderMenu(folder);
    });
    row.appendChild(menu);
    row.addEventListener("click", function () {
      selectFolder(folder.id);
    });
    row.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectFolder(folder.id);
        return;
      }
      if (event.key === "ArrowRight" && children.length && collapsed) {
        event.preventDefault();
        state.collapsed[folder.id] = false;
        renderTree();
        return;
      }
      if (event.key === "ArrowLeft" && children.length && !collapsed) {
        event.preventDefault();
        state.collapsed[folder.id] = true;
        renderTree();
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        var rows = Array.prototype.slice.call(document.querySelectorAll("#folderTree .trow"));
        var index = rows.indexOf(row);
        var next = rows[index + (event.key === "ArrowDown" ? 1 : -1)];
        if (next) {
          event.preventDefault();
          next.focus();
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          var search = $("searchInput");
          if (search) search.focus();
        }
      }
    });
    row.addEventListener("dragstart", function (event) {
      dragPayload = { type: "folder", id: folder.id };
      row.classList.add("dragging");
      try {
        event.dataTransfer.setData("application/x-pp", JSON.stringify(dragPayload));
        event.dataTransfer.setData("text/plain", folder.name);
        event.dataTransfer.effectAllowed = "move";
      } catch (err) {}
    });
    row.addEventListener("dragend", function () {
      row.classList.remove("dragging");
      dragPayload = null;
    });
    row.addEventListener("dragover", function (event) {
      if (!dragPayload) return;
      var data = dragPayload;
      if (data.type === "folder" && (data.id === folder.id || isDescendantOf(folder.id, data.id))) {
        event.dataTransfer.dropEffect = "none";
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      row.classList.add("drop-hover");
    });
    row.addEventListener("dragleave", function () {
      row.classList.remove("drop-hover");
    });
    row.addEventListener("drop", function (event) {
      event.preventDefault();
      row.classList.remove("drop-hover");
      onFolderDrop(event, folder.id);
    });
    return row;
  }

  function readDragData(event) {
    var payload = null;
    try {
      var json = event.dataTransfer.getData("application/x-pp");
      if (json) payload = JSON.parse(json);
    } catch (err) {}
    if (!payload) {
      try {
        var plain = event.dataTransfer.getData("text/plain");
        if (plain && promptById(plain)) payload = { type: "prompt", id: plain };
      } catch (err) {}
    }
    return payload || dragPayload;
  }

  function onFolderDrop(event, folderId) {
    var data = readDragData(event);
    dragPayload = null;
    if (!data) return;
    if (data.type === "prompt") {
      movePrompt(data.id, folderId);
      return;
    }
    if (data.type === "folder") {
      if (data.id === folderId) return;
      if (moveFolder(data.id, folderId)) {
        markDirty();
        flushSave();
        renderAll();
      } else {
        toast("A folder cannot be moved inside itself", { type: "warn" });
      }
    }
  }

  function openFolderMenu(folder) {
    var counts = buildFolderCounts();
    var list = node("div", "column");
    list.style.display = "flex";
    list.style.flexDirection = "column";
    list.style.gap = "6px";
    var path = pathOf(folder.id);
    function add(label, cls, handler) {
      var button = node("button", "btn block" + (cls ? " " + cls : ""), label);
      button.addEventListener("click", function () {
        api.close();
        handler();
      });
      list.appendChild(button);
    }
    add("Rename folder", "", function () {
      textPromptDialog({
        title: "Rename folder",
        value: folder.name,
        onConfirm: function (value) {
          folder.name = value.slice(0, 60);
          markDirty();
          flushSave();
          renderAll();
        }
      });
    });
    add("New subfolder", "", function () {
      textPromptDialog({
        title: "New subfolder in " + folder.name,
        placeholder: "Subfolder name",
        onConfirm: function (value) {
          var created = addFolder(value, folder.id);
          if (!created) toast("That folder already exists here", { type: "warn" });
          else toast("Created " + pathOf(created.id), { type: "ok" });
        }
      });
    });
    add("Move folder to...", "", function () {
      folderPickerDialog("Move \"" + folder.name + "\" into:", function (targetId) {
        if (!moveFolder(folder.id, targetId)) toast("A folder cannot be moved inside itself", { type: "warn" });
        else {
          markDirty();
          flushSave();
          renderAll();
        }
      });
    });
    add("Export folder as ZIP of .txt", "", function () {
      state.ui.selectedFolderId = folder.id;
      exportFolderZip();
    });
    add("Delete folder", "danger", function () {
      var promptCount = counts[folder.id] || 0;
      var subCount = descendantFolderIds(folder.id).length;
      var detail = promptCount + " prompt" + (promptCount === 1 ? "" : "s") + (subCount ? " and " + subCount + " subfolder" + (subCount === 1 ? "" : "s") : "");
      var deleteMenu = modal({
        title: "Delete folder",
        body: [
          para("Delete \"" + path + "\"? It contains " + detail + "."),
          para("The safe option keeps every prompt by moving them to " + cfg.unsortedFolderName + ".", "hint"),
          para("The other option deletes the folder and moves its prompts to the Trash, where you can still restore them.", "hint")
        ],
        buttons: [
          {
            label: "Delete folder, keep prompts",
            kind: "primary",
            onClick: function () {
              var doomedIds = [folder.id].concat(descendantFolderIds(folder.id));
              var doomedFolders = doomedIds
                .map(function (id) {
                  var entry = folderById(id);
                  return entry ? { id: entry.id, name: entry.name, parentId: entry.parentId || null, createdAt: entry.createdAt || Date.now() } : null;
                })
                .filter(Boolean);
              var affected = state.library.prompts
                .filter(function (p) {
                  return doomedIds.indexOf(p.folderId) !== -1;
                })
                .map(function (p) {
                  return { id: p.id, folderId: p.folderId };
                });
              var result = deleteFolder(folder.id, false);
              flushSave();
              renderAll();
              undoToast("Deleted folder - " + result.moved + " prompt(s) moved to " + cfg.unsortedFolderName, function () {
                doomedFolders.forEach(function (entry) {
                  if (!folderById(entry.id)) state.library.folders.push(entry);
                });
                affected.forEach(function (entry) {
                  var record = promptById(entry.id);
                  if (record) {
                    record.folderId = entry.folderId;
                    record.updatedAt = Date.now();
                  }
                });
              });
            }
          },
          {
            label: "Delete folder and move prompts to Trash",
            kind: "danger",
            keepOpen: true,
            onClick: function () {
              confirmDialog({
                title: "Delete folder " + (promptCount ? "and its prompts" : "") + "?",
                message: promptCount
                  ? "This deletes \"" + path + "\" and moves its " + promptCount + " prompt(s) to the Trash. Nothing is lost - you can restore them from Trash."
                  : "This deletes the empty folder \"" + path + "\".",
                confirmLabel: "Delete folder",
                danger: true,
                onConfirm: function () {
                  var doomedFolders = [folder.id]
                    .concat(descendantFolderIds(folder.id))
                    .map(function (id) {
                      var entry = folderById(id);
                      return entry ? { id: entry.id, name: entry.name, parentId: entry.parentId || null, createdAt: entry.createdAt || Date.now() } : null;
                    })
                    .filter(Boolean);
                  var result = deleteFolder(folder.id, true);
                  flushSave();
                  renderAll();
                  deleteMenu.close();
                  var message = "Deleted folder";
                  if (result.trashed) message += " - " + result.trashed + " prompt(s) moved to Trash";
                  undoToast(message, function () {
                    doomedFolders.forEach(function (entry) {
                      if (!folderById(entry.id)) state.library.folders.push(entry);
                    });
                    restoreTrashedByReason("folder-deleted", result.name);
                  });
                }
              });
            }
          },
          { label: "Cancel", kind: "ghost" }
        ]
      });
    });
    var api = modal({ title: folder.name, body: [list], buttons: [{ label: "Close", kind: "ghost" }] });
  }

  function openTrashDialog() {
    var list = node("div", "column");
    list.style.display = "flex";
    list.style.flexDirection = "column";
    list.style.gap = "6px";
    var empty = para("Trash is empty. Deleted prompts wait here so a mistake is never permanent.", "hint");
    list.appendChild(empty);
    function redraw() {
      var entries = trashArray();
      empty.hidden = entries.length > 0;
      Array.prototype.slice.call(list.querySelectorAll(".review-item")).forEach(function (el) {
        el.remove();
      });
      entries.forEach(function (entry) {
        var row = node("div", "review-item");
        var text = node("div");
        text.style.flex = "1";
        text.appendChild(node("div", "r-title", entry.title || "Untitled prompt"));
        text.appendChild(
          node("div", "r-move", (entry.fromFolderPath || "(no folder)") + " · deleted " + fmtWhen(entry.trashedAt) + " · " + (entry.content || "").length + " chars")
        );
        row.appendChild(text);
        var restore = node("button", "btn sm primary", "Restore");
        restore.addEventListener("click", function () {
          var record = restoreTrashed(entry.id);
          if (!record) return;
          markDirty();
          flushSave();
          renderAll();
          redraw();
          toast("Restored \"" + (record.title || "Untitled prompt") + "\" to " + (pathOf(record.folderId) || "UNSORTED"), { type: "ok" });
        });
        row.appendChild(restore);
        var purge = node("button", "btn sm danger", "Delete forever");
        purge.addEventListener("click", function () {
          confirmDialog({
            title: "Delete forever",
            message: "Permanently remove \"" + (entry.title || "Untitled prompt") + "\"? This cannot be undone.",
            confirmLabel: "Delete forever",
            danger: true,
            onConfirm: function () {
              purgeTrashed(entry.id);
              markDirty();
              flushSave();
              redraw();
              renderTree();
            }
          });
        });
        row.appendChild(purge);
        list.appendChild(row);
      });
    }
    redraw();
    var api = modal({
      title: "Trash",
      wide: true,
      body: [
        para("Deleted prompts stay here until you remove them. Restoring puts a prompt back in the folder it came from, or in " + cfg.unsortedFolderName + " if that folder is gone.", "hint"),
        list
      ],
      buttons: []
    });
    var foot = api.box.querySelector(".modal-foot");
    if (!foot) {
      foot = node("div", "modal-foot");
      api.box.appendChild(foot);
    }
    var restoreAll = node("button", "btn", "Restore all");
    restoreAll.addEventListener("click", function () {
      var entries = trashArray().slice();
      if (!entries.length) {
        toast("Trash is empty", { type: "warn" });
        return;
      }
      var restored = 0;
      entries.forEach(function (entry) {
        if (restoreTrashed(entry.id)) restored++;
      });
      markDirty();
      flushSave();
      renderAll();
      redraw();
      toast("Restored " + restored + " prompt(s)", { type: "ok" });
    });
    var emptyBtn = node("button", "btn danger", "Empty trash");
    emptyBtn.addEventListener("click", function () {
      var count = trashArray().length;
      if (!count) {
        toast("Trash is empty", { type: "warn" });
        return;
      }
      confirmDialog({
        title: "Empty trash",
        message: "Permanently delete all " + count + " prompt(s) in the trash? This cannot be undone.",
        confirmLabel: "Empty trash",
        danger: true,
        onConfirm: function () {
          state.library.trash = [];
          markDirty();
          flushSave();
          redraw();
          renderTree();
          toast("Trash emptied", { type: "warn" });
        }
      });
    });
    var closeBtn = node("button", "btn ghost", "Close");
    closeBtn.addEventListener("click", function () {
      api.close();
    });
    foot.appendChild(restoreAll);
    foot.appendChild(emptyBtn);
    foot.appendChild(closeBtn);
    return api;
  }

  function folderPickerDialog(title, onPick) {
    var list = node("div", "picker-list");
    var unsorted = unsortedFolderId();
    folderTreeEach(null, 0, function (folder, depth) {
      var row = node("div", "picker-item", (depth ? new Array(depth + 1).join("\u2014 ") : "") + folder.name);
      row.addEventListener("click", function () {
        api.close();
        onPick(folder.id);
      });
      list.appendChild(row);
    }, true);
    if (!list.childNodes.length) list.appendChild(node("div", "picker-item", "(no folders yet)"));
    var api = modal({
      title: title || "Choose a folder",
      body: [list],
      buttons: [{ label: "Cancel", kind: "ghost" }]
    });
    return api;
  }

  function renderList() {
    var wrap = $("promptList");
    if (!wrap) return;
    var list = visiblePrompts();
    var query = state.ui.search.trim();
    var showPaths = !!query || state.ui.selectedFolderId === cfg.allFolderId;
    wrap.innerHTML = "";
    $("listCount").textContent = list.length ? "(" + list.length + ")" : "";
    var label;
    if (query) label = "Search results";
    else if (state.ui.selectedFolderId === cfg.allFolderId) label = "All prompts";
    else label = pathOf(state.ui.selectedFolderId) || "Folder";
    var filterMeta = cfg.filters.filter(function (f) {
      return f.key === state.ui.filter;
    })[0];
    if (filterMeta && state.ui.filter !== "all") label += " · " + filterMeta.label;
    $("listLabel").textContent = label;
    if (!list.length) {
      wrap.appendChild(
        para(query ? "No prompts found for \"" + query + "\"." : "No prompts here yet - create a prompt or import a TXT file.", "hint")
      );
      return;
    }
    var renderCap = 500;
    if (list.length > renderCap) {
      wrap.appendChild(
        para("Showing the first " + renderCap + " of " + list.length + " prompts. Narrow it down with search or open a folder to see the rest.", "hint")
      );
      list.slice(0, renderCap).forEach(function (prompt) {
        wrap.appendChild(listItem(prompt, showPaths));
      });
      return;
    }
    list.forEach(function (prompt) {
      wrap.appendChild(listItem(prompt, showPaths));
    });
  }
  function listItem(prompt, showPath) {
    var item = node("div", "pitem" + (state.current && state.current.id === prompt.id ? " selected" : ""));
    item.dataset.pid = prompt.id;
    item.draggable = !isTouchDevice;
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    item.setAttribute("aria-label", (prompt.title || "Untitled prompt") + (prompt.favourite ? ", favourited" : ""));
    var top = node("div", "pitem-top");
    var star = node("button", "pitem-star" + (prompt.favourite ? " on" : ""), prompt.favourite ? "\u2605" : "\u2606");
    star.title = prompt.favourite ? "Remove from favourites" : "Add to favourites";
    star.setAttribute("aria-label", (prompt.favourite ? "Remove from favourites: " : "Add to favourites: ") + (prompt.title || "Untitled prompt"));
    star.setAttribute("aria-pressed", prompt.favourite ? "true" : "false");
    star.addEventListener("click", function (event) {
      event.stopPropagation();
      toggleFavourite(prompt.id);
    });
    top.appendChild(star);
    top.appendChild(node("div", "pitem-title", prompt.title || "Untitled prompt"));
    item.appendChild(top);
    var snippet = (prompt.content || "").replace(/\s+/g, " ").trim();
    item.appendChild(node("div", "pitem-snip", snippet || "(empty prompt)"));
    var foot = node("div", "pitem-foot");
    var typeMeta = cfg.types.filter(function (t) {
      return t.key === prompt.type;
    })[0];
    if (typeMeta) {
      var typeTag = node("span", "tag type", typeMeta.label);
      typeTag.style.background = typeMeta.color;
      foot.appendChild(typeTag);
    }
    if (prompt.rating === "nsfw") foot.appendChild(node("span", "tag rating-nsfw", "NSFW"));
    else if (prompt.rating === "sfw") foot.appendChild(node("span", "tag rating-sfw", "SFW"));
    (prompt.tags || []).slice(0, 4).forEach(function (tag) {
      foot.appendChild(node("span", "tag", tag));
    });
    if ((prompt.tags || []).length > 4) foot.appendChild(node("span", "tag", "+" + ((prompt.tags || []).length - 4)));
    if (showPath) foot.appendChild(node("span", "pitem-path", pathOf(prompt.folderId) || "(no folder)"));
    item.appendChild(foot);
    item.addEventListener("click", function () {
      openPrompt(prompt.id);
    });
    item.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openPrompt(prompt.id);
      }
    });
    item.addEventListener("dragstart", function (event) {
      dragPayload = { type: "prompt", id: prompt.id };
      item.classList.add("dragging");
      try {
        event.dataTransfer.setData("application/x-pp", JSON.stringify(dragPayload));
        event.dataTransfer.setData("text/plain", prompt.id);
        event.dataTransfer.effectAllowed = "move";
      } catch (err) {}
    });
    item.addEventListener("dragend", function () {
      item.classList.remove("dragging");
      dragPayload = null;
    });
    return item;
  }

  function selectFolder(folderId) {
    state.ui.selectedFolderId = folderId;
    state.settings.lastFolderId = folderId;
    persistSettings();
    renderTree();
    renderList();
    closeOverlays();
  }

  function bindEvents() {
    var search = $("searchInput");
    var searchTimer = null;
    search.addEventListener("input", function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        state.ui.search = search.value;
        renderList();
      }, 120);
    });
    search.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        search.value = "";
        state.ui.search = "";
        renderList();
      }
    });

    $("sortSelect").addEventListener("change", function () {
      state.ui.sort = this.value;
      state.settings.sort = this.value;
      persistSettings();
      renderList();
    });

    $("newPromptBtn").addEventListener("click", function () {
      newPrompt();
      closeOverlays();
    });
    $("emptyNewBtn").addEventListener("click", function () {
      newPrompt();
    });
    $("newFolderBtn").addEventListener("click", function () {
      var parentId = state.ui.selectedFolderId && state.ui.selectedFolderId !== cfg.allFolderId ? state.ui.selectedFolderId : null;
      textPromptDialog({
        title: parentId ? "New subfolder in " + pathOf(parentId) : "New top-level folder",
        placeholder: "Folder name",
        onConfirm: function (value) {
          var created = addFolder(value, parentId);
          if (!created) toast("That folder already exists here", { type: "warn" });
          else toast("Created " + pathOf(created.id), { type: "ok" });
        }
      });
    });

    var title = $("titleInput");
    title.addEventListener("input", function () {
      if (!state.current) return;
      state.current.title = title.value;
      markDirty();
      scheduleListItemRefresh();
    });
    title.addEventListener("blur", function () {
      flushSave();
    });

    var textarea = $("promptText");
    textarea.addEventListener("input", function () {
      if (!state.current) return;
      state.current.content = textarea.value;
      markDirty();
      renderStats();
      scheduleListItemRefresh();
    });
    textarea.addEventListener("blur", function () {
      flushSave();
    });

    var tags = $("tagsInput");
    tags.addEventListener("input", function () {
      if (!state.current) return;
      state.current.tags = parseTagsInput(tags.value);
      markDirty();
      scheduleListItemRefresh();
    });

    $("folderSelect").addEventListener("change", function () {
      if (!state.current) return;
      var folderId = this.value;
      if (state.current.isDraft || !promptById(state.current.id)) {
        state.current.folderId = folderId;
        state.current.updatedAt = Date.now();
        markDirty();
        flushSave();
        renderTree();
        renderList();
        return;
      }
      if (!movePrompt(state.current.id, folderId)) renderAll();
    });

    $("typeSelect").addEventListener("change", function () {
      if (!state.current) return;
      state.current.type = this.value;
      markDirty();
      flushSave();
      renderList();
    });

    $("ratingGroup").addEventListener("click", function (event) {
      var button = event.target.closest("button[data-rating]");
      if (!button || !state.current) return;
      state.current.rating = button.dataset.rating;
      markDirty();
      flushSave();
      renderEditor();
      renderList();
    });

    $("favBtn").addEventListener("click", function () {
      if (!state.current) return;
      state.current.favourite = !state.current.favourite;
      markDirty();
      flushSave();
      renderEditor();
      renderList();
    });

    $("saveBtn").addEventListener("click", function () {
      saveNow(true);
    });

    $("duplicateBtn").addEventListener("click", duplicatePrompt);

    $("deleteBtn").addEventListener("click", function () {
      if (!state.current) return;
      if (state.current.isDraft) {
        state.current = null;
        state.renderedId = null;
        renderAll();
        toast("Discarded the empty draft", { type: "warn" });
        return;
      }
      deletePrompt(state.current.id);
    });

    $("moveBtn").addEventListener("click", function () {
      if (!state.current) return;
      folderPickerDialog("Move prompt to...", function (folderId) {
        movePrompt(state.current.id, folderId);
      });
    });

    $("copyBtn").addEventListener("click", function () {
      if (!state.current) return;
      copyText(state.current.content || "", "Prompt");
    });

    $("downloadBtn").addEventListener("click", function () {
      if (!state.current) return;
      exportPromptTxt(state.current);
    });

    $("shareBtn").addEventListener("click", function () {
      if (!state.current) return;
      sharePrompt(state.current);
    });

    $("importTxtBtn").addEventListener("click", function () {
      $("fileInput").click();
    });
    $("emptyImportBtn").addEventListener("click", function () {
      $("fileInput").click();
    });
    $("fileInput").addEventListener("change", function () {
      importTxtFiles(this.files);
      this.value = "";
    });

    $("importBackupBtn").addEventListener("click", function () {
      $("backupInput").click();
    });
    $("emptyBackupBtn").addEventListener("click", function () {
      $("backupInput").click();
    });
    $("backupInput").addEventListener("change", function () {
      if (this.files && this.files[0]) importBackupFile(this.files[0]);
      this.value = "";
    });

    $("exportBtn").addEventListener("click", openExportModal);
    $("settingsBtn").addEventListener("click", openSettingsModal);

    $("aiToggleBtn").addEventListener("click", toggleAIPanel);
    $("aiToggleBtnM").addEventListener("click", toggleAIPanel);
    $("aiCloseBtn").addEventListener("click", function () {
      closeOverlays();
    });
    $("libraryBtn").addEventListener("click", function () {
      $("sidebar").classList.add("open");
      $("scrim").hidden = false;
      $("libraryBtn").setAttribute("aria-expanded", "true");
    });
    $("sidebarCloseBtn").addEventListener("click", closeOverlays);
    $("scrim").addEventListener("click", closeOverlays);

    $("runCustomBtn").addEventListener("click", function () {
      runAIAction("custom");
    });
    $("aiActionsWrap").addEventListener("click", function (event) {
      var button = event.target.closest("button[data-action]");
      if (!button) return;
      runAIAction(button.dataset.action);
    });

    document.addEventListener("keydown", function (event) {
      var meta = event.ctrlKey || event.metaKey;
      if (meta && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveNow(true);
        return;
      }
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        $("searchInput").focus();
        $("searchInput").select();
      }
    });

    window.addEventListener("dragover", function (event) {
      if (event.dataTransfer && Array.prototype.indexOf.call(event.dataTransfer.types || [], "Files") !== -1) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }
    });
    window.addEventListener("drop", function (event) {
      if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length) {
        event.preventDefault();
        importTxtFiles(event.dataTransfer.files);
      }
    });

    window.addEventListener("beforeunload", function () {
      if (state.dirty) {
        try {
          Store.set(cfg.storageKeyLibrary, snapshotLibrary());
        } catch (err) {}
      }
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") flushSave();
    });
    window.addEventListener("online", renderAIStatus);
    window.addEventListener("offline", renderAIStatus);
    window.addEventListener("beforeinstallprompt", function (event) {
      event.preventDefault();
      deferredInstall = event;
    });
  }

  function scheduleListItemRefresh() {
    clearTimeout(state.listRefreshTimer);
    state.listRefreshTimer = setTimeout(function () {
      refreshSelectedListItem();
    }, 350);
  }

  function refreshSelectedListItem() {
    var current = state.current;
    if (!current) return;
    var item = document.querySelector('.pitem[data-pid="' + current.id + '"]');
    if (!item) {
      renderList();
      return;
    }
    var titleNode = item.querySelector(".pitem-title");
    if (titleNode) titleNode.textContent = current.title || "Untitled prompt";
    var snippet = item.querySelector(".pitem-snip");
    if (snippet) snippet.textContent = (current.content || "").replace(/\s+/g, " ").trim() || "(empty prompt)";
  }

  function renderStats() {
    var statsNode = $("promptStats");
    if (!statsNode) return;
    var current = state.current;
    if (!current) {
      statsNode.textContent = "";
      return;
    }
    var content = current.content || "";
    var words = content.trim() ? content.trim().split(/\s+/).length : 0;
    var lines = content ? content.split("\n").length : 0;
    statsNode.textContent = content.length + " chars · " + words + " words · " + lines + " lines · " + (fmtWhen(current.updatedAt) || "new");
  }

  function renderMobileTitle() {
    var label = $("mbTitle");
    if (!label) return;
    label.textContent = state.current ? state.current.title || "Untitled prompt" : "PROMPT PACKER";
  }

  function renderFolderSelect() {
    var select = $("folderSelect");
    if (!select) return;
    var signature = state.library.folders
      .map(function (f) {
        return f.id + ":" + f.name + ":" + (f.parentId || "");
      })
      .sort()
      .join("|");
    if (select.dataset.signature !== signature) {
      select.dataset.signature = signature;
      var current = state.current ? state.current.folderId : null;
      select.innerHTML = "";
      folderTreeEach(null, 0, function (folder, depth) {
        var option = document.createElement("option");
        option.value = folder.id;
        option.textContent = new Array(depth + 1).join("\u00a0\u00a0\u00a0") + folder.name;
        select.appendChild(option);
      }, true);
      if (current) select.value = current;
    }
    if (state.current) select.value = state.current.folderId;
  }

  function renderTypeSelect() {
    var select = $("typeSelect");
    if (!select) return;
    if (!select.dataset.ready) {
      select.dataset.ready = "1";
      cfg.types.forEach(function (type) {
        var option = document.createElement("option");
        option.value = type.key;
        option.textContent = type.label;
        select.appendChild(option);
      });
    }
    if (state.current) select.value = state.current.type || "other";
  }

  function renderRatingGroup() {
    var group = $("ratingGroup");
    if (!group) return;
    if (!group.dataset.ready) {
      group.dataset.ready = "1";
      cfg.ratings.forEach(function (rating) {
        var button = node("button", "seg-btn", rating.label);
        button.dataset.rating = rating.key;
        button.title = rating.key ? "Label this prompt as " + rating.label : "No content label";
        group.appendChild(button);
      });
    }
    var active = state.current ? state.current.rating || "" : "";
    Array.prototype.forEach.call(group.children, function (button) {
      var on = button.dataset.rating === active;
      button.classList.toggle("active", on);
      button.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function renderEditor() {
    var current = state.current;
    var hasCurrent = !!current;
    $("editorEmpty").hidden = hasCurrent;
    $("editorWrap").hidden = !hasCurrent;
    if (!hasCurrent) {
      renderMobileTitle();
      return;
    }
    var isNew = state.renderedId !== current.id;
    if (isNew) {
      $("titleInput").value = current.title || "";
      $("promptText").value = current.content || "";
      $("tagsInput").value = (current.tags || []).join(", ");
    } else {
      if ($("titleInput").value !== (current.title || "")) $("titleInput").value = current.title || "";
      if ($("promptText").value !== (current.content || "")) $("promptText").value = current.content || "";
    }
    state.renderedId = current.id;
    renderFolderSelect();
    renderTypeSelect();
    renderRatingGroup();
    var fav = $("favBtn");
    fav.classList.toggle("on", !!current.favourite);
    fav.textContent = current.favourite ? "\u2605 Favourited" : "\u2606 Favourite";
    fav.setAttribute("aria-pressed", current.favourite ? "true" : "false");
    $("deleteBtn").textContent = current.isDraft ? "Discard draft" : "Delete";
    renderStats();
    renderMobileTitle();
  }

  function renderChips() {
    var wrap = $("filterChips");
    if (!wrap) return;
    wrap.innerHTML = "";
    cfg.filters.forEach(function (filter) {
      var button = node("button", "chip" + (state.ui.filter === filter.key ? " active" : ""), filter.label);
      button.addEventListener("click", function () {
        state.ui.filter = filter.key;
        renderChips();
        renderList();
      });
      wrap.appendChild(button);
    });
  }

  function renderSortSelect() {
    var select = $("sortSelect");
    if (select) select.value = state.ui.sort;
  }

  function renderAIStatus() {
    var status = AI.status();
    var pill = $("aiStatusPill");
    if (pill) {
      pill.textContent = status.ready ? status.label : status.online ? "manual mode" : "offline";
      pill.className = "pill " + (status.ready ? "ok" : "warn");
      pill.title = status.label;
    }
    var note = $("aiProviderNote");
    if (note) {
      note.className = "ai-note" + (status.ready ? "" : " warn");
      note.textContent = status.ready
        ? "Connected to " + status.label + ". Actions work on the prompt in the editor. Nothing is overwritten until you press REPLACE ORIGINAL."
        : (status.online ? "AI provider unavailable. " : "AI provider unavailable and you are offline. ") +
          "You can still copy the generated AI request and use it externally, then paste the answer back. Connect a local endpoint in Settings to automate it.";
    }
    updateAIButtons();
  }

  function buildAIActions() {
    var wrap = $("aiActionsWrap");
    if (!wrap) return;
    wrap.innerHTML = "";
    var groups = {};
    var order = [];
    AI.ACTION_ORDER.forEach(function (id) {
      var spec = AI.ACTIONS[id];
      if (!spec) return;
      if (!groups[spec.group]) {
        groups[spec.group] = [];
        order.push(spec.group);
      }
      groups[spec.group].push({ id: id, spec: spec });
    });
    order.forEach(function (groupName) {
      var section = node("div", "ai-group");
      section.appendChild(node("div", "ai-group-title", groupName.toUpperCase()));
      var grid = node("div", "ai-actions");
      groups[groupName].forEach(function (entry) {
        var button = node("button", "ai-btn" + (entry.id === "organise" || entry.id === "autosort" ? " wide" : ""), entry.spec.label);
        button.dataset.action = entry.id;
        button.title = entry.spec.tip || "";
        grid.appendChild(button);
      });
      section.appendChild(grid);
      wrap.appendChild(section);
    });
  }

  function updateAIButtons() {
    var wrap = $("aiActionsWrap");
    if (!wrap) return;
    var busy = state.ai.running;
    var hasContent = !!(state.current && (state.current.content || "").trim());
    Array.prototype.forEach.call(wrap.querySelectorAll("button[data-action]"), function (button) {
      var id = button.dataset.action;
      var needsPrompt = id !== "organise";
      button.disabled = busy || (needsPrompt && !hasContent);
      button.classList.toggle("busy", busy && state.ai.actionId === id);
    });
    var custom = $("runCustomBtn");
    if (custom) {
      custom.disabled = busy || !state.current;
      custom.textContent = busy ? "WORKING..." : "RUN CUSTOM INSTRUCTION";
    }
  }

  function renderAll() {
    renderTree();
    renderList();
    renderEditor();
    renderAIStatus();
    renderStorageNote();
  }

  function saveNow(announce) {
    var current = state.current;
    if (!current) {
      flushSave();
      return;
    }
    if (current.isDraft) {
      var committed = commitDraft();
      if (!committed) {
        if (announce) toast("Nothing to save yet", { type: "warn" });
        return;
      }
      renderAll();
      if (announce) toast("Saved \"" + (committed.title || "Untitled prompt") + "\"", { type: "ok" });
      return;
    }
    markDirty();
    flushSave();
    if (announce) toast("Saved", { type: "ok", timeout: 2000 });
  }

  function toggleAIPanel() {
    state.ui.aiOpen = !state.ui.aiOpen;
    state.settings.aiOpen = state.ui.aiOpen;
    persistSettings();
    applyAIPanelState();
    if (state.ui.aiOpen) renderAIStatus();
  }

  function applyAIPanelState() {
    var app = $("app");
    var panel = $("aiPanel");
    if (!app || !panel) return;
    var mobile = window.innerWidth <= 860;
    app.classList.toggle("ai-closed", !state.ui.aiOpen && !mobile);
    panel.classList.toggle("open", state.ui.aiOpen);
    var toggle = $("aiToggleBtn");
    if (toggle) toggle.setAttribute("aria-expanded", state.ui.aiOpen ? "true" : "false");
    var toggleM = $("aiToggleBtnM");
    if (toggleM) toggleM.setAttribute("aria-expanded", state.ui.aiOpen ? "true" : "false");
  }

  function closeOverlays() {
    var sidebar = $("sidebar");
    var panel = $("aiPanel");
    if (sidebar) sidebar.classList.remove("open");
    if (window.innerWidth <= 860 && panel) panel.classList.remove("open");
    var scrim = $("scrim");
    if (scrim) scrim.hidden = true;
    var libraryBtn = $("libraryBtn");
    if (libraryBtn) libraryBtn.setAttribute("aria-expanded", "false");
  }

  function openExportModal() {
    var counts = promptCounts();
    var list = node("div", "column");
    list.style.display = "flex";
    list.style.flexDirection = "column";
    list.style.gap = "6px";
    var api = modal({
      title: "Export and backup",
      body: [
        para(counts.total + " prompt(s) in " + counts.folders + " folder(s). Everything can be exported as plain .txt, as a ZIP that mirrors your folders, or as a JSON backup.", "hint"),
        list
      ],
      buttons: [{ label: "Close", kind: "ghost" }]
    });
    function add(label, hint, handler) {
      var button = node("button", "btn block", label);
      button.title = hint || "";
      button.addEventListener("click", function () {
        api.close();
        handler();
      });
      list.appendChild(button);
    }
    add("Export current prompt as .txt", "Plain text of the prompt in the editor", function () {
      exportPromptTxt(state.current);
    });
    add("Export current folder as ZIP of .txt files", "Keeps the subfolder structure", exportFolderZip);
    add("Export entire library as ZIP", "One .txt per prompt plus a JSON backup inside", exportAllZip);
    add("Export every prompt as one .txt", "Readable, with a header block per prompt", exportAllTxt);
    add("Export backup (JSON)", "Prompts, folders, tags, labels and settings", exportBackup);
    add("Import TXT files...", "One prompt per file, filed under IMPORTED", function () {
      $("fileInput").click();
    });
    add("Import backup (JSON)...", "Merge or replace your library", function () {
      $("backupInput").click();
    });
    if (deferredInstall) {
      add("Install Prompt Packer as an app", "Add it to your desktop or home screen", promptInstall);
    }
    return api;
  }

  async function promptInstall() {
    if (!deferredInstall) return;
    var event = deferredInstall;
    deferredInstall = null;
    try {
      event.prompt();
      var choice = await event.userChoice;
      if (choice && choice.outcome === "accepted") toast("Installing Prompt Packer", { type: "ok" });
    } catch (err) {
      toast("Install prompt failed: " + (err && err.message ? err.message : err), { type: "err" });
    }
  }

  function openSettingsModal() {
    var themeGroup = node("div", "seg");
    ["dark", "light"].forEach(function (mode) {
      var button = node("button", "seg-btn" + (state.settings.theme === mode ? " active" : ""), mode === "dark" ? "Dark" : "Light");
      button.addEventListener("click", function () {
        state.settings.theme = mode;
        Array.prototype.forEach.call(themeGroup.children, function (child) {
          child.classList.remove("active");
        });
        button.classList.add("active");
        applyTheme();
      });
      themeGroup.appendChild(button);
    });

    var providerSelect = node("select", "input");
    [
      ["auto", "Automatic (recommended)"],
      ["perchance", "Perchance AI only (free, when available)"],
      ["endpoint", "Local / self-hosted endpoint only"],
      ["manual", "Manual mode (no automatic AI)"]
    ].forEach(function (pair) {
      var option = document.createElement("option");
      option.value = pair[0];
      option.textContent = pair[1];
      providerSelect.appendChild(option);
    });
    providerSelect.value = state.settings.ai.provider;

    var endpointInput = node("input", "input");
    endpointInput.placeholder = "http://localhost:11434/v1";
    endpointInput.value = state.settings.ai.endpoint || "";
    var modelInput = node("input", "input");
    modelInput.placeholder = "llama3.1 (or any model name your server accepts)";
    modelInput.value = state.settings.ai.model || "";
    var testLine = para("", "hint");

    var body = [
      para("Appearance", "ai-group-title"),
      themeGroup,
      para("AI provider", "ai-group-title"),
      para("Prompt Packer ships with three interchangeable providers. Perchance AI is used automatically whenever the page is running on perchance.org (it is free). Otherwise point it at any OpenAI-compatible server on your own machine, such as Ollama, LM Studio or llama.cpp. No key is required for local servers, and nothing is sent anywhere else.", "hint"),
      providerSelect,
      endpointInput,
      modelInput,
      testLine,
      para("Storage", "ai-group-title"),
      para(storageNoteText(), "hint"),
      para("Your prompts live in this browser only. Use Export / Backup to move them to another device - there is no account and nothing is uploaded.", "hint")
    ];
    if (cfg.version) body.push(para(cfg.appName + " v" + cfg.version, "hint app-version"));

    var buttons = [
      {
        label: "Test endpoint",
        kind: "ghost",
        keepOpen: true,
        onClick: function () {
          testEndpoint(endpointInput.value.trim(), testLine);
        }
      },
      {
        label: "Save settings",
        kind: "primary",
        keepOpen: true,
        onClick: function () {
          state.settings.theme = state.settings.theme === "light" ? "light" : "dark";
          state.settings.ai.provider = providerSelect.value;
          state.settings.ai.endpoint = endpointInput.value.trim();
          state.settings.ai.model = modelInput.value.trim();
          persistSettings();
          applyTheme();
          renderAIStatus();
          toast("Settings saved", { type: "ok" });
        }
      },
      { label: "Close", kind: "ghost" }
    ];
    if (deferredInstall) {
      buttons.unshift({
        label: "Install as app",
        kind: "ghost",
        onClick: promptInstall
      });
    }
    return modal({ title: "Settings", body: body, buttons: buttons });
  }

  async function testEndpoint(endpoint, line) {
    if (!endpoint) {
      line.textContent = "Enter an endpoint URL first, for example http://localhost:11434/v1";
      return;
    }
    line.textContent = "Testing " + endpoint + " ...";
    try {
      var base = endpoint.replace(/\/+$/, "");
      var res = await fetch(base + "/models", { method: "GET" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      var json = await res.json();
      var models = (json.data || json.models || []).map(function (entry) {
        return entry.id || entry.name || entry.model;
      }).filter(Boolean);
      line.textContent = models.length ? "Connected. Models: " + models.slice(0, 8).join(", ") : "Connected, but no models were listed.";
    } catch (err) {
      line.textContent = "Could not reach that endpoint (" + (err && err.message ? err.message : err) + "). Check the URL, and that your server allows this page as an origin.";
    }
  }

  function sharePrompt(record) {
    var title = record.title || "Untitled prompt";
    var shareText = title + "\n\n" + (record.content || "");
    if (navigator.share) {
      navigator
        .share({ title: title, text: shareText })
        .then(function () {
          return null;
        })
        .catch(function (err) {
          if (err && err.name === "AbortError") return;
          sharePromptDialog(record);
        });
      return;
    }
    sharePromptDialog(record);
  }

  function base64UrlEncode(text) {
    var bytes = new TextEncoder().encode(String(text));
    var binary = "";
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function base64UrlDecode(text) {
    var normalized = String(text).replace(/-/g, "+").replace(/_/g, "/");
    while (normalized.length % 4) normalized += "=";
    var binary = atob(normalized);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function shareLinkFor(record) {
    var payload = {
      v: 1,
      t: record.title || "",
      c: record.content || "",
      g: (record.tags || []).slice(0, 24),
      y: record.type || "other",
      r: record.rating || ""
    };
    var base = String(location.href || "").split("#")[0].split("?")[0];
    if (window.generatorName && /\.perchance\.org$/i.test(location.hostname)) {
      base = "https://perchance.org/" + window.generatorName;
    }
    return base + "?pp=" + base64UrlEncode(JSON.stringify(payload));
  }

  function sharedToken() {
    var fromHash = /^#(?:pp|share)=(.+)$/.exec(String(location.hash || ""));
    if (fromHash) return fromHash[1];
    var search = String(location.search || "");
    if (search.length > 1) {
      var params = new URLSearchParams(search);
      var value = params.get("pp") || params.get("share");
      if (value) return value;
    }
    return null;
  }

  function readSharedPayload() {
    var token = sharedToken();
    if (!token) return null;
    var payload = null;
    try {
      payload = JSON.parse(base64UrlDecode(token));
    } catch (err) {
      return null;
    }
    if (!payload || typeof payload !== "object") return null;
    var content = String(payload.c == null ? "" : payload.c);
    if (!content.trim()) return null;
    return {
      title: String(payload.t || "").slice(0, 120),
      content: content,
      tags: Array.isArray(payload.g) ? payload.g.map(String).slice(0, 24) : [],
      type: typeof payload.y === "string" ? payload.y : "other",
      rating: typeof payload.r === "string" ? payload.r : ""
    };
  }

  function clearShareParams() {
    try {
      var params = new URLSearchParams(String(location.search || ""));
      params.delete("pp");
      params.delete("share");
      var rest = params.toString();
      history.replaceState(null, "", location.pathname + (rest ? "?" + rest : ""));
    } catch (err) {
      try {
        if (location.hash) location.hash = "";
      } catch (err2) {}
    }
  }

  function addSharedPrompt(shared) {
    var record = createRecord({
      title: shared.title || "Shared prompt",
      content: shared.content,
      folderId: importedFolderId() || unsortedFolderId(),
      tags: shared.tags,
      type: shared.type,
      rating: shared.rating
    });
    state.library.prompts.push(record);
    markDirty();
    flushSave();
    openPrompt(record.id);
    renderAll();
    toast("Shared prompt added to " + cfg.importedFolderName, { type: "ok" });
    return record;
  }

  function openSharedPromptDialog(shared) {
    var title = shared.title || "Shared prompt";
    var preview = node("textarea", "input textarea-mono");
    preview.readOnly = true;
    preview.value = shared.content;
    preview.setAttribute("aria-label", "Shared prompt text");
    var api = modal({
      title: "Shared prompt: " + title,
      body: [
        para(
          "This prompt arrived inside a link - no server was involved, the text is in the URL itself. Adding it makes a copy in " +
            cfg.importedFolderName +
            ". Nothing in your library is replaced.",
          "hint"
        ),
        preview
      ],
      buttons: [
        {
          label: "Add to my library",
          kind: "primary",
          onClick: function () {
            addSharedPrompt(shared);
          }
        },
        {
          label: "Copy text",
          kind: "ghost",
          keepOpen: true,
          onClick: function () {
            copyText(shared.content, "Shared prompt");
          }
        },
        { label: "Close", kind: "ghost" }
      ]
    });
    return api;
  }

  function handleSharedHash() {
    if (!sharedToken()) return;
    var shared = readSharedPayload();
    clearShareParams();
    if (!shared) {
      toast("That share link could not be read - it looks damaged or was cut short by the app it travelled through.", {
        type: "err",
        timeout: 10000
      });
      return;
    }
    openSharedPromptDialog(shared);
  }

  function sharePromptDialog(record) {
    var title = record.title || "Untitled prompt";
    var folder = pathOf(record.folderId);
    var metaLine = [folder, record.type, record.rating ? record.rating.toUpperCase() : "", (record.tags || []).join(", ")].filter(Boolean).join(" · ");
    var shareableText = title + "\n" + metaLine + "\n\n" + (record.content || "");
    var link = shareLinkFor(record);
    var linkInput = node("input", "input");
    linkInput.type = "text";
    linkInput.readOnly = true;
    linkInput.value = link;
    linkInput.setAttribute("aria-label", "Share link");
    linkInput.addEventListener("focus", function () {
      try {
        linkInput.select();
      } catch (err) {}
    });
    var list = node("div", "column");
    list.style.display = "flex";
    list.style.flexDirection = "column";
    list.style.gap = "6px";
    function add(label, handler) {
      var button = node("button", "btn block", label);
      button.addEventListener("click", function () {
        api.close();
        handler();
      });
      list.appendChild(button);
    }
    var api = modal({
      title: "Share \"" + title + "\"",
      body: [
        para(navigator.share ? "This device supports the system share sheet." : "Sharing options for this prompt.", "hint"),
        linkInput,
        para("That link carries the prompt text itself, so it works with no server and no account. Paste it anywhere.", "hint"),
        list
      ],
      buttons: [{ label: "Close", kind: "ghost" }]
    });
    if (navigator.share) {
      add("Open system share sheet", function () {
        navigator
          .share({ title: title, text: title + "\n\n" + (record.content || "") })
          .catch(function (err) {
            if (err && err.name !== "AbortError") toast("Share cancelled", { type: "warn" });
          });
      });
    }
    add("Copy share link", function () {
      copyText(link, "Share link");
    });
    add("Copy prompt", function () {
      copyText(record.content || "", "Prompt");
    });
    add("Copy title + prompt", function () {
      copyText(title + "\n\n" + (record.content || ""), "Title and prompt");
    });
    add("Copy shareable text (with folder, type, tags)", function () {
      copyText(shareableText, "Shareable text");
    });
    add("Download as .txt", function () {
      exportPromptTxt(record);
    });
    return api;
  }

  var isTouchDevice = (function () {
    try {
      return window.matchMedia("(hover: none)").matches;
    } catch (err) {
      return false;
    }
  })();

  function buildResultCard(label) {
    var wrap = $("aiResultWrap");
    var card = node("div", "ai-result");
    var head = node("div", "ai-result-head");
    head.appendChild(node("span", null, label));
    var providerPill = node("span", "pill", AI.status().label);
    head.appendChild(providerPill);
    head.appendChild(node("span", "spacer"));
    var progress = node("span", "progress-line");
    head.appendChild(progress);
    card.appendChild(head);
    var area = node("textarea");
    area.spellcheck = false;
    card.appendChild(area);
    var actions = node("div", "ai-result-actions");
    card.appendChild(actions);
    card.dataset.state = "running";
    wrap.innerHTML = "";
    wrap.appendChild(card);
    wrap.hidden = false;
    return { card: card, area: area, actions: actions, progress: progress, providerPill: providerPill };
  }

  function resultButtonsFor(kind) {
    if (kind === "notes") {
      return [
        { label: "Copy critique", mode: "copy" },
        { label: "Append as notes", mode: "append" },
        { label: "Discard", mode: "discard" }
      ];
    }
    if (kind === "tags") {
      return [
        { label: "Apply tags", mode: "apply-tags" },
        { label: "Copy", mode: "copy" },
        { label: "Discard", mode: "discard" }
      ];
    }
    if (kind === "title") {
      return [
        { label: "Apply title", mode: "apply-title" },
        { label: "Copy", mode: "copy" },
        { label: "Discard", mode: "discard" }
      ];
    }
    var buttons = [
      { label: "Replace original", mode: "replace" },
      { label: "Append", mode: "append" },
      { label: "Save as new prompt", mode: "new" },
      { label: "Copy", mode: "copy" }
    ];
    if (kind === "variations") buttons.push({ label: "Save each as a prompt", mode: "split" });
    buttons.push({ label: "Discard", mode: "discard" });
    return buttons;
  }

  function finishResultCard(parts, spec) {
    var card = parts.card;
    card.dataset.state = "done";
    parts.actions.innerHTML = "";
    parts.progress.textContent = state.ai.resultText ? state.ai.resultText.length + " chars" : "empty result";
    if (spec.kind === "sort") {
      var suggestion = parseSortSuggestion(state.ai.resultText);
      if (suggestion) {
        renderSortSuggestion(suggestion, parts);
        parts.card.style.display = "none";
        return;
      }
      parts.actions.innerHTML = "";
      appendResultButton(parts, { label: "Try again", mode: "retry" });
      appendResultButton(parts, { label: "Copy raw reply", mode: "copy" });
      appendResultButton(parts, { label: "Close", mode: "discard" });
      return;
    }
    resultButtonsFor(spec.kind).forEach(function (entry) {
      appendResultButton(parts, entry);
    });
  }

  function appendResultButton(parts, entry) {
    var button = node("button", "btn sm", entry.label);
    if (entry.mode === "discard") button.className = "btn sm ghost";
    if (entry.mode === "replace") button.className = "btn sm primary";
    button.addEventListener("click", function () {
      if (entry.mode === "retry") {
        runAIAction(state.ai.actionId);
        return;
      }
      applyAIResult(entry.mode);
    });
    parts.actions.appendChild(button);
  }

  function runAIAction(actionId, options) {
    var opts = options || {};
    var spec = AI.ACTIONS[actionId];
    if (!spec) return;
    if (actionId === "organise") {
      startOrganise();
      return;
    }
    var current = state.current;
    if (!current) {
      toast("Open a prompt first", { type: "warn" });
      return;
    }
    if (state.ai.running) {
      toast("An AI action is already running", { type: "warn" });
      return;
    }
    if (actionId === "custom" && !($("customInstruction").value || "").trim()) {
      toast("Type a custom instruction first", { type: "warn" });
      $("customInstruction").focus();
      return;
    }
    var content = opts.content != null ? opts.content : current.content || "";
    if (!content.trim() && actionId !== "custom") {
      toast("This prompt is empty - write or paste something first", { type: "warn" });
      return;
    }
    var instruction;
    var manualPackage;
    var ctx = {
      prompt: content,
      custom: ($("customInstruction").value || "").trim(),
      library: state.library
    };
    try {
      instruction = AI.buildInstruction(actionId, ctx);
      manualPackage = AI.buildManualPackage(actionId, ctx);
    } catch (err) {
      toast(err && err.message ? err.message : "Could not build that instruction", { type: "warn" });
      return;
    }
    startAI(actionId, spec, instruction, manualPackage);
  }

  function startAI(actionId, spec, instruction, manualPackage) {
    state.ai.running = true;
    state.ai.actionId = actionId;
    state.ai.resultKind = spec.kind;
    state.ai.resultText = "";
    state.ai.controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    updateAIButtons();
    var parts = buildResultCard(spec.label);
    parts.area.addEventListener("input", function () {
      state.ai.resultText = parts.area.value;
    });
    var stopButton = node("button", "btn sm danger", "Stop");
    stopButton.addEventListener("click", function () {
      if (state.ai.controller) state.ai.controller.abort();
    });
    parts.actions.appendChild(stopButton);
    parts.progress.innerHTML = "";
    parts.progress.appendChild(node("span", "spinner"));
    parts.progress.appendChild(node("span", null, " generating..."));
    var painted = 0;
    function paint(full) {
      parts.area.value = full;
      if (!painted) parts.area.scrollTop = 0;
    }
    AI.generateWithAI(instruction, {
      signal: state.ai.controller ? state.ai.controller.signal : undefined,
      manualPackage: manualPackage,
      onChunk: function (chunk, full) {
        state.ai.resultText = full != null ? String(full) : state.ai.resultText + (chunk || "");
        painted++;
        paint(state.ai.resultText);
      }
    })
      .then(function (result) {
        state.ai.resultText = String(result.text || "").trim();
        if (state.ai.resultText) parts.area.value = state.ai.resultText;
        state.ai.running = false;
        parts.providerPill.textContent = result.provider === AI.PROVIDER.PERCHANCE ? "Perchance AI" : "local endpoint";
        parts.actions.innerHTML = "";
        if (!state.ai.resultText) {
          parts.progress.textContent = "The AI returned nothing.";
          appendResultButton(parts, { label: "Try again", mode: "retry" });
          appendResultButton(parts, { label: "Close", mode: "discard" });
          updateAIButtons();
          return;
        }
        finishResultCard(parts, spec);
        updateAIButtons();
      })
      .catch(function (err) {
        state.ai.running = false;
        updateAIButtons();
        var message = err && err.message ? err.message : String(err);
        if (err && (err.code === "no-provider" || err.code === "offline")) {
          parts.card.parentNode.removeChild(parts.card);
          $("aiResultWrap").hidden = true;
          showManualMode(
            (err && err.manualPackage) || manualPackage || err.instruction || instruction,
            err.code === "offline" ? "AI needs a connection. " + message : message
          );
          return;
        }
        if (err && err.name === "AbortError") {
          parts.progress.textContent = "stopped";
          parts.actions.innerHTML = "";
          appendResultButton(parts, { label: "Retry", mode: "retry" });
          appendResultButton(parts, { label: "Use what arrived", mode: "replace" });
          appendResultButton(parts, { label: "Discard", mode: "discard" });
          return;
        }
        parts.progress.textContent = "";
        parts.progress.appendChild(node("span", null, "failed"));
        parts.actions.innerHTML = "";
        toast("AI action failed: " + message, { type: "err", timeout: 9000 });
        var retry = node("button", "btn sm", "Try again");
        retry.addEventListener("click", function () {
          runAIAction(state.ai.actionId);
        });
        parts.actions.appendChild(retry);
        var manual = node("button", "btn sm", "Manual mode");
        manual.addEventListener("click", function () {
          showManualMode(manualPackage || instruction, "The provider failed, so here is the request to run in any external AI tool.");
        });
        parts.actions.appendChild(manual);
        var discard = node("button", "btn sm ghost", "Discard");
        discard.addEventListener("click", clearAIResult);
        parts.actions.appendChild(discard);
      });
  }

  function clearAIResult() {
    var wrap = $("aiResultWrap");
    if (wrap) {
      wrap.innerHTML = "";
      wrap.hidden = true;
    }
    var sortWrap = $("aiSortWrap");
    if (sortWrap) {
      sortWrap.innerHTML = "";
      sortWrap.hidden = true;
    }
    state.ai.resultText = "";
  }

  function applyAIResult(mode) {
    var current = state.current;
    var area = document.querySelector("#aiResultWrap textarea");
    var text = (area ? area.value : state.ai.resultText) || "";
    if (mode === "copy") {
      copyText(text, "AI result");
      return;
    }
    if (mode === "discard") {
      clearAIResult();
      return;
    }
    if (!current) {
      toast("Open a prompt first", { type: "warn" });
      return;
    }
    if (mode === "apply-tags") {
      var parsed = extractTags(text);
      if (!parsed.tags.length && !parsed.rating) {
        toast("No usable tags found in the reply", { type: "warn" });
        return;
      }
      applyTags(current, parsed.tags, "merge");
      if (parsed.rating) current.rating = parsed.rating;
      current.updatedAt = Date.now();
      state.renderedId = null;
      markDirty();
      flushSave();
      clearAIResult();
      renderAll();
      toast("Added " + parsed.tags.length + " tag(s)" + (parsed.rating ? " and set the label to " + parsed.rating.toUpperCase() : ""), { type: "ok" });
      return;
    }
    if (mode === "apply-title") {
      var newTitle = extractTitle(text);
      if (!newTitle) {
        toast("No usable title found in the reply", { type: "warn" });
        return;
      }
      current.title = newTitle;
      current.updatedAt = Date.now();
      state.renderedId = null;
      markDirty();
      flushSave();
      clearAIResult();
      renderAll();
      toast("Title set to \"" + newTitle + "\"", { type: "ok" });
      return;
    }
    if (mode === "split") {
      var parts = splitVariations(text);
      if (parts.length < 2) {
        toast("Could not find numbered variations in the reply", { type: "warn" });
        return;
      }
      parts.forEach(function (part, index) {
        addPromptFromFields({
          title: (current.title || "Untitled prompt") + " - variation " + (index + 1),
          content: part,
          folderId: current.folderId,
          tags: (current.tags || []).slice(0, 8),
          type: current.type,
          rating: current.rating
        });
      });
      markDirty();
      flushSave();
      clearAIResult();
      renderAll();
      toast("Saved " + parts.length + " variations as prompts", { type: "ok" });
      return;
    }
    if (!text.trim()) {
      toast("There is no AI result to apply", { type: "warn" });
      return;
    }
    if (mode === "replace") {
      var before = current.content || "";
      current.content = text;
      current.updatedAt = Date.now();
      state.renderedId = null;
      markDirty();
      flushSave();
      clearAIResult();
      renderAll();
      toast("Prompt replaced with the AI result", {
        type: "ok",
        timeout: 12000,
        action: {
          label: "UNDO",
          onClick: function () {
            current.content = before;
            current.updatedAt = Date.now();
            state.renderedId = null;
            markDirty();
            flushSave();
            renderAll();
          }
        }
      });
      return;
    }
    if (mode === "append") {
      var joiner = current.content && current.content.trim() ? "\n\n" : "";
      var prevContent = current.content || "";
      current.content = (current.content || "") + joiner + text;
      current.updatedAt = Date.now();
      state.renderedId = null;
      markDirty();
      flushSave();
      clearAIResult();
      renderAll();
      undoToast("Appended to the prompt", function () {
        var record = promptById(current.id);
        if (!record) return;
        record.content = prevContent;
        record.updatedAt = Date.now();
      });
      return;
    }
    if (mode === "new") {
      var record = addPromptFromFields({
        title: (current.title || "Untitled prompt") + " (AI)",
        content: text,
        folderId: current.folderId,
        tags: (current.tags || []).slice(),
        type: current.type,
        rating: current.rating
      });
      markDirty();
      flushSave();
      clearAIResult();
      openPrompt(record.id);
      renderAll();
      toast("Saved as a new prompt", { type: "ok" });
    }
  }

  function showManualMode(instruction, note) {
    var wrap = $("aiManualWrap");
    if (!wrap) return;
    var packageText = String(instruction || "").trim();
    if (!packageText || packageText.indexOf("ACTION:") !== 0) {
      var current = state.current;
      var fallbackId = state.ai.actionId || "improve";
      packageText = AI.buildManualPackage(fallbackId, {
        prompt: current ? current.content || "" : "",
        custom: ($("customInstruction") && $("customInstruction").value) || "",
        library: state.library
      });
    }
    wrap.innerHTML = "";
    wrap.hidden = false;
    var box = node("div", "ai-result");
    var offlineNow = typeof navigator !== "undefined" && navigator.onLine === false;
    box.appendChild(
      node("div", "ai-result-head", offlineNow ? "MANUAL MODE - NO CONNECTION" : "MANUAL MODE - NO AI PROVIDER CONNECTED")
    );
    box.appendChild(
      para(
        note || "Copy this request into any external AI tool (ChatGPT, Claude, Gemini, a local model), then paste the answer back below. The library works fully without an AI provider.",
        "hint"
      )
    );
    var instructionArea = node("textarea");
    instructionArea.value = packageText;
    instructionArea.readOnly = true;
    instructionArea.style.minHeight = "120px";
    instructionArea.setAttribute("aria-label", "AI request package");
    box.appendChild(instructionArea);
    var row = node("div", "ai-result-actions");
    var copyButton = node("button", "btn sm primary", "COPY AI REQUEST");
    copyButton.addEventListener("click", function () {
      copyText(packageText, "AI request");
    });
    row.appendChild(copyButton);
    var useButton = node("button", "btn sm", "Use as result");
    row.appendChild(useButton);
    var closeButton = node("button", "btn sm ghost", "Close");
    closeButton.addEventListener("click", function () {
      wrap.innerHTML = "";
      wrap.hidden = true;
    });
    row.appendChild(closeButton);
    box.appendChild(row);
    var answerLabel = node("div", "ai-group-title", "PASTE THE AI ANSWER HERE");
    box.appendChild(answerLabel);
    var answerArea = node("textarea");
    answerArea.placeholder = "Paste the AI response here, then press Use as result.";
    answerArea.setAttribute("aria-label", "Pasted AI answer");
    box.appendChild(answerArea);
    var applyRow = node("div", "ai-result-actions");
    var applyButton = node("button", "btn sm primary", "Use as result");
    applyRow.appendChild(applyButton);
    box.appendChild(applyRow);
    wrap.appendChild(box);
    function useAnswer() {
      var answer = answerArea.value.trim();
      if (!answer) {
        toast("Paste the AI answer first", { type: "warn" });
        return;
      }
      var spec = AI.ACTIONS[state.ai.actionId || "improve"] || AI.ACTIONS.improve;
      var parts = buildResultCard(spec.label + " (manual)");
      state.ai.resultText = answer;
      parts.area.value = answer;
      parts.providerPill.textContent = "manual";
      finishResultCard(parts, spec);
    }
    applyButton.addEventListener("click", useAnswer);
    useButton.addEventListener("click", useAnswer);
    if (state.ui.aiOpen) {
      var panel = $("aiPanel");
      if (panel) panel.classList.add("open");
    }
    if (!state.ui.aiOpen) toggleAIPanel();
    setTimeout(function () {
      try {
        answerArea.focus();
      } catch (err) {}
    }, 60);
  }

  function extractTags(text) {
    var parsed = AI.parseLooseJson(text);
    var raw = [];
    var rating = "";
    if (Array.isArray(parsed)) raw = parsed;
    else if (parsed && Array.isArray(parsed.tags)) raw = parsed.tags;
    else if (parsed && typeof parsed.tags === "string") raw = parsed.tags.split(",");
    if (parsed && typeof parsed.rating === "string") {
      var lower = parsed.rating.toLowerCase();
      if (lower.indexOf("nsfw") !== -1) rating = "nsfw";
      else if (lower.indexOf("sfw") !== -1) rating = "sfw";
    }
    var cleaned = raw
      .map(function (entry) {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object") return entry.tag || entry.name || entry.label || "";
        return "";
      })
      .filter(Boolean);
    return { tags: parseTagsInput(cleaned.join(",")), rating: rating };
  }

  function extractTitle(text) {
    var parsed = AI.parseLooseJson(text);
    if (parsed && typeof parsed.title === "string" && parsed.title.trim()) return parsed.title.trim().slice(0, 120);
    var match = String(text).match(/"title"\s*:\s*"([^"]{2,120})"/);
    if (match) return match[1].trim();
    var plain = String(text).trim().split("\n")[0].replace(/^title\s*[:\-]\s*/i, "").replace(/^["'\s]+|["'\s]+$/g, "");
    return plain && plain.length <= 120 ? plain : "";
  }

  function splitVariations(text) {
    var parts = String(text)
      .split(/\n(?=\s*\d+[\.\)]\s)/)
      .map(function (part) {
        return part.replace(/^\s*\d+[\.\)]\s*/, "").trim();
      })
      .filter(Boolean);
    return parts.length > 1 ? parts : [];
  }

  function parseSortSuggestion(text) {
    var parsed = AI.parseLooseJson(text);
    if (!parsed || typeof parsed !== "object") return null;
    var path = parsed.folderPath || parsed.folder || parsed.path || parsed.location;
    if (!path || typeof path !== "string") return null;
    var tags = [];
    if (Array.isArray(parsed.tags)) tags = parseTagsInput(parsed.tags.join(","));
    else if (typeof parsed.tags === "string") tags = parseTagsInput(parsed.tags);
    var rating = "";
    if (typeof parsed.rating === "string") {
      var lower = parsed.rating.toLowerCase();
      if (lower.indexOf("nsfw") !== -1) rating = "nsfw";
      else if (lower.indexOf("sfw") !== -1) rating = "sfw";
    }
    return {
      folderPath: splitPath(path).join(" > "),
      tags: tags,
      rating: rating,
      title: typeof parsed.title === "string" ? parsed.title.trim() : ""
    };
  }

  function renderSortSuggestion(suggestion, parts) {
    var wrap = $("aiSortWrap");
    if (!wrap) return;
    wrap.innerHTML = "";
    wrap.hidden = false;
    var box = node("div", "suggestion");
    box.appendChild(node("div", "ai-group-title", "AI SUGGESTED LOCATION"));
    var matched = findFolderByPath(suggestion.folderPath);
    box.appendChild(node("div", "path", suggestion.folderPath + (matched ? "" : "  (will be created)")));
    var extras = [];
    if (suggestion.tags.length) extras.push("tags: " + suggestion.tags.join(", "));
    if (suggestion.rating) extras.push("label: " + suggestion.rating.toUpperCase());
    var current = state.current;
    if (suggestion.title && current && (!current.title || /^untitled|^imported/i.test(current.title))) {
      extras.push("title: " + suggestion.title);
    }
    if (extras.length) box.appendChild(para("Also suggests - " + extras.join(" | "), "hint"));
    var row = node("div", "ai-result-actions");
    var accept = node("button", "btn sm primary", "Accept");
    accept.addEventListener("click", function () {
      applySortSuggestion(suggestion);
    });
    var choose = node("button", "btn sm", "Choose different folder");
    choose.addEventListener("click", function () {
      folderPickerDialog("Move prompt to...", function (folderId) {
        var target = state.current;
        if (!target) return;
        var before = { folderId: target.folderId, tags: (target.tags || []).slice(), rating: target.rating || "" };
        target.folderId = folderId;
        target.updatedAt = Date.now();
        if (suggestion.tags.length) applyTags(target, suggestion.tags, "merge");
        if (suggestion.rating) target.rating = suggestion.rating;
        markDirty();
        flushSave();
        clearAIResult();
        renderAll();
        undoToast("Moved to " + pathOf(folderId), function () {
          var record = promptById(target.id);
          if (!record) return;
          record.folderId = before.folderId;
          record.tags = before.tags;
          record.rating = before.rating;
          record.updatedAt = Date.now();
        });
      });
    });
    var cancel = node("button", "btn sm ghost", "Cancel");
    cancel.addEventListener("click", clearAIResult);
    row.appendChild(accept);
    row.appendChild(choose);
    row.appendChild(cancel);
    box.appendChild(row);
    wrap.appendChild(box);
    if (parts && parts.card) parts.card.remove();
    if (!state.ui.aiOpen) toggleAIPanel();
  }

  function applySortSuggestion(suggestion) {
    var current = state.current;
    if (!current) return;
    var folderId = ensureFolderPath(suggestion.folderPath);
    if (!folderId) {
      toast("Could not create that folder path", { type: "warn" });
      return;
    }
    var before = {
      folderId: current.folderId,
      tags: (current.tags || []).slice(),
      rating: current.rating || "",
      title: current.title || ""
    };
    current.folderId = folderId;
    current.updatedAt = Date.now();
    if (suggestion.tags.length) applyTags(current, suggestion.tags, "merge");
    if (suggestion.rating) current.rating = suggestion.rating;
    if (suggestion.title && (!current.title || /^untitled|^imported/i.test(current.title))) current.title = suggestion.title;
    markDirty();
    flushSave();
    clearAIResult();
    renderAll();
    undoToast("Filed under " + pathOf(folderId), function () {
      var record = promptById(current.id);
      if (!record) return;
      record.folderId = before.folderId;
      record.tags = before.tags;
      record.rating = before.rating;
      record.title = before.title;
      record.updatedAt = Date.now();
    });
  }

  function startOrganise() {
    if (state.ai.running) {
      toast("An AI action is already running", { type: "warn" });
      return;
    }
    var all = state.library.prompts.slice();
    if (!all.length) {
      toast("No prompts to organise yet", { type: "warn" });
      return;
    }
    var selection = visiblePrompts();
    var unsortedIds = [unsortedFolderId(), importedFolderId()];
    var loose = all.filter(function (p) {
      return unsortedIds.indexOf(p.folderId) !== -1;
    });
    var options = [
      { label: "IMPORTED + UNSORTED only (" + loose.length + ")", list: loose, note: "Safest: only prompts that have not been filed yet." },
      { label: "Everything (" + all.length + ")", list: all, note: "Reviews every prompt and suggests a folder for each." },
      { label: "Current selection (" + selection.length + ")", list: selection, note: "Whatever the library list is showing right now." }
    ].filter(function (option) {
      return option.list.length > 0;
    });
    if (!options.length) {
      toast("No prompts to organise", { type: "warn" });
      return;
    }
    var list = node("div", "column");
    list.style.display = "flex";
    list.style.flexDirection = "column";
    list.style.gap = "6px";
    var api = modal({
      title: "Auto organise library",
      body: [
        para("The AI reads each prompt and suggests a folder, tags and a content label. Nothing moves until you review and accept the suggestions.", "hint"),
        list
      ],
      buttons: [{ label: "Cancel", kind: "ghost" }]
    });
    options.forEach(function (option) {
      var button = node("button", "btn block", option.label);
      button.title = option.note;
      button.addEventListener("click", function () {
        api.close();
        runOrganise(option.list);
      });
      list.appendChild(button);
    });
  }

  async function runOrganise(prompts) {
    var chunks = [];
    for (var i = 0; i < prompts.length; i += 20) chunks.push(prompts.slice(i, i + 20));
    state.ai.running = true;
    state.ai.actionId = "organise";
    state.ai.controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    updateAIButtons();
    var progress = node("div", "progress-line");
    var spinner = node("span", "spinner");
    progress.appendChild(spinner);
    progress.appendChild(node("span", null, " Asking the AI to file " + prompts.length + " prompt(s)..."));
    var body = [para("The AI is reviewing your prompts. Nothing is moved until the review screen appears.", "hint"), progress];
    var api = modal({ title: "Auto organise", body: body, buttons: [], dismissible: false });
    var suggestions = [];
    var failures = 0;
    var stop = node("button", "btn danger", "Stop");
    stop.addEventListener("click", function () {
      if (state.ai.controller) state.ai.controller.abort();
    });
    api.box.appendChild(node("div", "modal-foot")).appendChild(stop);
    try {
      for (var c = 0; c < chunks.length; c++) {
        progress.lastChild.textContent = " Batch " + (c + 1) + " of " + chunks.length + " (" + prompts.length + " prompts)...";
        var instruction = AI.buildOrganiseInstruction(chunks[c], state.library);
        var result = await AI.generateWithAI(instruction, { signal: state.ai.controller ? state.ai.controller.signal : undefined });
        var parsed = AI.parseLooseJson(result.text);
        if (Array.isArray(parsed)) {
          parsed.forEach(function (entry) {
            if (entry && entry.id) {
              var match = chunks[c].filter(function (p) {
                return p.id === String(entry.id);
              })[0];
              if (match) suggestions.push({ prompt: match, entry: entry });
            }
          });
        } else {
          failures++;
        }
      }
    } catch (err) {
      state.ai.running = false;
      updateAIButtons();
      api.close();
      var message = err && err.message ? err.message : String(err);
      if (err && (err.code === "no-provider" || err.code === "offline")) {
        toast(message + " Auto organise needs an AI provider - see Settings.", { type: "warn", timeout: 9000 });
      } else if (err && err.name === "AbortError") {
        toast("Auto organise stopped. Nothing was changed.", { type: "warn" });
      } else {
        toast("Auto organise failed: " + message, { type: "err", timeout: 9000 });
      }
      return;
    }
    state.ai.running = false;
    updateAIButtons();
    api.close();
    if (!suggestions.length) {
      toast(failures ? "The AI did not return usable suggestions" : "No suggestions were returned", { type: "warn" });
      return;
    }
    showOrganiseReview(suggestions);
  }

  function showOrganiseReview(suggestions) {
    var rows = [];
    var list = node("div", "column");
    list.style.display = "flex";
    list.style.flexDirection = "column";
    list.style.gap = "6px";
    var moves = 0;
    suggestions.forEach(function (entry) {
      var prompt = entry.prompt;
      var path = splitPath(entry.entry.folderPath || "");
      if (!path.length) return;
      var currentPath = pathOf(prompt.folderId) || "(no folder)";
      var targetPath = path.join(" > ");
      var sameFolder = findFolderByPath(targetPath) === findFolderByPath(currentPath);
      var row = node("div", "review-item");
      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = !sameFolder;
      checkbox.addEventListener("change", updateApplyLabel);
      row.appendChild(checkbox);
      var text = node("div");
      text.style.flex = "1";
      text.appendChild(node("div", "r-title", prompt.title || "Untitled prompt"));
      var moveLine = node("div", "r-move");
      moveLine.appendChild(node("span", null, currentPath + "  \u2192  "));
      var strong = node("b", null, targetPath);
      moveLine.appendChild(strong);
      if (sameFolder) moveLine.appendChild(node("span", null, "  (already here)"));
      text.appendChild(moveLine);
      var extras = [];
      if (Array.isArray(entry.entry.tags) && entry.entry.tags.length) extras.push("tags: " + entry.entry.tags.slice(0, 8).join(", "));
      if (entry.entry.rating) extras.push("label: " + String(entry.entry.rating).toUpperCase());
      if (extras.length) text.appendChild(node("div", "r-move", extras.join("  |  ")));
      row.appendChild(text);
      list.appendChild(row);
      rows.push({ checkbox: checkbox, prompt: prompt, entry: entry, targetPath: targetPath });
      if (checkbox.checked) moves++;
    });
    if (!rows.length) {
      toast("The AI did not suggest any usable folders", { type: "warn" });
      return;
    }
    var applyButton = node("button", "btn primary", "");
    function updateApplyLabel() {
      var count = rows.filter(function (row) {
        return row.checkbox.checked;
      }).length;
      applyButton.textContent = "Apply " + count + " move(s)";
      applyButton.disabled = count === 0;
    }
    updateApplyLabel();
    var api = modal({
      title: "Review AI suggestions",
      wide: true,
      body: [
        para("Uncheck anything you do not want. Prompts are only moved and tagged - nothing is ever deleted. Folders that do not exist yet will be created.", "hint"),
        list
      ],
      buttons: [{ label: "Cancel", kind: "ghost" }]
    });
    applyButton.className = "btn primary";
    applyButton.addEventListener("click", function () {
      var applied = 0;
      var undoStates = [];
      rows.forEach(function (row) {
        if (!row.checkbox.checked) return;
        var folderId = ensureFolderPath(row.targetPath);
        if (!folderId) return;
        undoStates.push({
          id: row.prompt.id,
          folderId: row.prompt.folderId,
          tags: (row.prompt.tags || []).slice(),
          rating: row.prompt.rating || ""
        });
        row.prompt.folderId = folderId;
        row.prompt.updatedAt = Date.now();
        var tags = row.entry.tags;
        if (Array.isArray(tags) && tags.length) applyTags(row.prompt, tags, "merge");
        if (typeof row.entry.rating === "string") {
          var lower = row.entry.rating.toLowerCase();
          if (lower.indexOf("nsfw") !== -1) row.prompt.rating = "nsfw";
          else if (lower.indexOf("sfw") !== -1) row.prompt.rating = "sfw";
        }
        applied++;
      });
      markDirty();
      flushSave();
      renderAll();
      api.close();
      if (!applied) {
        toast("Nothing was moved", { type: "warn" });
        return;
      }
      undoToast("Filed " + applied + " prompt(s)", function () {
        undoStates.forEach(function (entry) {
          var record = promptById(entry.id);
          if (!record) return;
          record.folderId = entry.folderId;
          record.tags = entry.tags;
          record.rating = entry.rating;
          record.updatedAt = Date.now();
        });
      });
    });
    api.box.querySelector(".modal-foot").insertBefore(applyButton, api.box.querySelector(".modal-foot").firstChild);
    return api;
  }

  // ============================================================ PROMPT WORKSHOP
  //
  // One interface, mode-specific instructions. The prompt-engineering logic lives in
  // workshop.js (window.PP_WORKSHOP); everything here is presentation, session state,
  // local persistence and library write-through. Provider calls go through
  // PP_WORKSHOP.run -> PP_AI.generateWithAI, never directly.

  var WS_SUGGEST_DELAY = 420;

  function wsSettings() {
    if (!state.settings.workshop || typeof state.settings.workshop !== "object") state.settings.workshop = defaultWorkshop();
    return state.settings.workshop;
  }

  function wsGrab(kind, modeKey) {
    var s = wsSettings();
    var bag = s[kind] && typeof s[kind] === "object" && !Array.isArray(s[kind]) ? s[kind] : (s[kind] = {});
    var key = modeKey || state.ws.mode || "general";
    if (!bag[key] || typeof bag[key] !== "object" || Array.isArray(bag[key])) bag[key] = {};
    return bag[key];
  }

  var wsPersistTimer = null;

  function wsPersist() {
    wsStash();
    clearTimeout(wsPersistTimer);
    wsPersistTimer = setTimeout(function () {
      persistSettings();
    }, 320);
  }

  function wsStash() {
    var s = wsSettings();
    s.mode = state.ws.mode || "general";
    s.draft = state.ws.text || "";
    s.count = state.ws.count || 3;
    s.style = state.ws.style || "balanced";
  }

  function wsPersistNow() {
    clearTimeout(wsPersistTimer);
    wsStash();
    persistSettings();
  }

  function wsModeType(modeKey) {
    var map = { coding: "coding", debugging: "coding", image: "image", creative: "creative", agent: "agent", writing: "writing" };
    var key = map[modeKey] || "other";
    var ok = (cfg.types || []).some(function (t) {
      return t.key === key;
    });
    return ok ? key : "other";
  }

  function wsIsMobile() {
    return window.innerWidth <= 980;
  }

  function wsStatusReady() {
    try {
      return !!AI.status().ready;
    } catch (err) {
      return false;
    }
  }

  function wsCtx() {
    return {
      mode: state.ws.mode || "general",
      text: state.ws.text || "",
      fields: state.ws.fields || {},
      toggles: state.ws.toggles || {},
      focus: state.ws.focus || "",
      rating: state.ws.rating || "",
      count: state.ws.count || 3,
      style: state.ws.style || "balanced",
      library: state.library
    };
  }

  // ---------------------------------------------------------------- open / close

  function wsSetMode(key, opts) {
    var lib = WS();
    var mode = lib ? lib.modeByKey(key) : null;
    var next = mode ? mode.key : "general";
    state.ws.mode = next;
    state.ws.fields = wsGrab("fields", next);
    state.ws.toggles = wsGrab("toggles", next);
    if (lib && !Object.keys(state.ws.toggles).length) {
      var defaults = lib.defaultToggles(next);
      Object.keys(defaults).forEach(function (k) {
        state.ws.toggles[k] = defaults[k];
      });
    }
    state.ws.suggested = null;
    var bar = $("wsSuggest");
    if (bar) {
      bar.hidden = true;
      bar.innerHTML = "";
    }
    if (!opts || opts.persist !== false) wsPersist();
    if (state.ws.open) wsRender();
  }

  function wsNewSession() {
    var ws = state.ws;
    ws.running = false;
    ws.controller = null;
    ws.actionKey = null;
    ws.lastSpec = null;
    ws.result = "";
    ws.resultKind = "";
    ws.resultLabel = "";
    ws.resultNote = "";
    ws.manual = "";
    ws.analysis = null;
    ws.variations = null;
    ws.history = [];
    ws.chain = [];
    ws.snapshot = null;
    ws.dismissed = false;
    ws.suggested = null;
    ws.adv = false;
    ws.tab = "prompt";
    ws.blocks = [];
    ws.blocksReady = false;
  }

  function wsOpen(opts) {
    var options = opts || {};
    var ws = state.ws;
    var saved = wsSettings();
    wsNewSession();
    ws.open = true;
    if (options.prompt) {
      ws.promptId = options.prompt.id;
      ws.promptTitle = options.prompt.title || "";
      ws.rating = options.prompt.rating || "";
      ws.text = options.prompt.content || "";
      ws.source = "paste";
    } else if (options.text != null) {
      ws.promptId = null;
      ws.promptTitle = "";
      ws.rating = options.rating || "";
      ws.text = String(options.text || "");
      ws.source = options.source || "paste";
    } else {
      ws.promptId = null;
      ws.promptTitle = "";
      ws.rating = "";
      ws.text = options.resume === false ? "" : saved.draft || "";
      ws.source = options.source || (ws.text.trim() ? "paste" : "build");
    }
    var mode = options.mode || saved.mode || "general";
    wsSetMode(mode, { persist: false });
    ws.tab = "prompt";
    var overlay = $("wsOverlay");
    if (overlay) overlay.hidden = false;
    document.body.classList.add("ws-open");
    if (ws.source === "build" || (options.advanced && !ws.text.trim())) ws.adv = true;
    wsRender();
    wsSetAdvanced(ws.adv);
    wsPersist();
    setTimeout(function () {
      var el = $("wsPrompt");
      if (el && !ws.text.trim()) el.focus();
      else if (wsIsMobile()) {
        var a = $("wsPrompt");
        if (a) a.focus();
      }
    }, 40);
  }

  function wsClose() {
    if (state.ws.running) {
      toast("Stop the AI action first", { type: "warn" });
      return;
    }
    state.ws.open = false;
    var overlay = $("wsOverlay");
    if (overlay) overlay.hidden = true;
    document.body.classList.remove("ws-open");
    wsStash();
    persistSettings();
    renderAll();
  }

  function wsSetAdvanced(open) {
    var body = $("wsAdvBody");
    var btn = $("wsAdvBtn");
    var caret = $("wsAdvCaret");
    var label = $("wsAdvLabel");
    state.ws.adv = !!open;
    if (body) body.hidden = !open;
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (caret) caret.textContent = open ? "\u25b4" : "\u25be";
    if (label) label.textContent = open ? "Hide advanced options" : "Advanced options";
    if (open) wsRenderAdvanced();
  }

  // ---------------------------------------------------------------- render

  function wsRender() {
    if (!state.ws.open) return;
    wsRenderModes();
    wsRenderSource();
    wsRenderPrompt();
    wsRenderScore();
    wsRenderActions();
    wsRenderAdvanced();
    wsRenderTabs();
    wsRenderResult();
    wsRenderChain();
    wsMaybeSuggest();
  }

  function wsRenderModes() {
    var wrap = $("wsModes");
    var lib = WS();
    if (!wrap) return;
    var modes = lib ? lib.modeList() : [];
    wrap.innerHTML = "";
    modes.forEach(function (mode) {
      var button = node("button", "ws-mode" + (mode.key === state.ws.mode ? " active" : ""), mode.label);
      button.dataset.mode = mode.key;
      button.title = mode.hint || "";
      button.setAttribute("aria-selected", mode.key === state.ws.mode ? "true" : "false");
      if (mode.user) button.classList.add("ws-mode-user");
      wrap.appendChild(button);
    });
    var add = node("button", "ws-mode ws-mode-add", "+ MODE");
    add.dataset.modeAdd = "1";
    add.title = "Create, edit or delete your own modes";
    wrap.appendChild(add);
    var pill = $("wsModePill");
    if (pill) {
      var mode = lib ? lib.modeByKey(state.ws.mode) : null;
      pill.textContent = mode ? mode.label + " MODE" : "";
      pill.title = mode && mode.hint ? mode.hint : "";
    }
  }

  function wsRenderSource() {
    var seg = $("wsSource");
    if (!seg) return;
    Array.prototype.forEach.call(seg.querySelectorAll("button[data-source]"), function (button) {
      var on = button.dataset.source === state.ws.source;
      button.classList.toggle("active", on);
      button.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function wsRenderPrompt() {
    var area = $("wsPrompt");
    if (area && area.value !== (state.ws.text || "")) area.value = state.ws.text || "";
    var meta = $("wsPromptMeta");
    if (meta) {
      meta.innerHTML = "";
      var bits = [];
      if (state.ws.promptId) bits.push("OPEN LIBRARY PROMPT: " + (state.ws.promptTitle || "Untitled"));
      var mode = modeLabel(state.ws.mode);
      if (mode) bits.push(mode + " MODE");
      if (state.ws.rating) bits.push(state.ws.rating.toUpperCase());
      if (state.ws.promptId) bits.push("edits here update that prompt");
      if (bits.length) meta.appendChild(node("span", "ws-flag", bits.join("  \u00b7  ")));
    }
    wsRenderOriginal();
  }

  function wsRenderOriginal() {
    var box = $("wsOriginalText");
    if (!box) return;
    var text = state.ws.snapshot != null ? state.ws.snapshot : state.ws.text || "";
    box.textContent = text.trim() ? text : "(nothing yet)";
  }

  function wsRenderScore() {
    var wrap = $("wsScore");
    var lib = WS();
    if (!wrap) return;
    var text = state.ws.text || "";
    wrap.innerHTML = "";
    if (!lib) return;
    if (!text.trim()) {
      wrap.appendChild(node("p", "hint", "Paste or write a prompt and a practical checklist appears here. It describes what may still be missing - it never blocks you."));
      return;
    }
    var score = lib.scorecard(text);
    var head = node("div", "ws-score-head");
    head.appendChild(node("span", "ws-score-title", "PROMPT CHECKLIST"));
    head.appendChild(node("span", "spacer"));
    head.appendChild(
      node("span", "ws-score-count", score.ready + "/" + score.total + " covered \u00b7 " + score.words + " words \u00b7 " + score.sections + " sections")
    );
    wrap.appendChild(head);
    var list = node("div", "ws-score-items");
    score.items.forEach(function (item) {
      var chip = node("span", "ws-score-item " + item.state);
      chip.appendChild(node("span", "ws-dot"));
      chip.appendChild(node("span", null, item.label));
      chip.title = item.detail || "";
      list.appendChild(chip);
    });
    wrap.appendChild(list);
    wrap.appendChild(
      node(
        "p",
        "hint ws-score-note",
        "A checklist, not a score. Prompt quality cannot be measured perfectly - these are the things models most often have to guess."
      )
    );
  }

  var WS_GROUP_ORDER = ["Build", "Work on it", "Direction", "Visual"];

  function wsRenderActions() {
    var wrap = $("wsActions");
    var lib = WS();
    if (!wrap) return;
    wrap.innerHTML = "";
    if (!lib) {
      wrap.appendChild(para("The prompt-engineering module did not load, so the Workshop actions are unavailable.", "hint"));
      return;
    }
    var mode = lib.modeByKey(state.ws.mode);
    var keys = (mode && mode.actions) || ["expand", "improve", "review"];
    var groups = {};
    var order = [];
    keys.forEach(function (key) {
      var spec = lib.actionSpec(key);
      var group = spec.group || "Actions";
      if (!groups[group]) {
        groups[group] = [];
        order.push(group);
      }
      groups[group].push({ key: key, spec: spec });
    });
    order.sort(function (a, b) {
      var ai = WS_GROUP_ORDER.indexOf(a);
      var bi = WS_GROUP_ORDER.indexOf(b);
      return (ai === -1 ? 90 : ai) - (bi === -1 ? 90 : bi);
    });
    var fields = lib.fieldsFor(state.ws.mode);
    if (fields.length && !state.ws.adv) {
      var hint = node("button", "ws-adv-hint");
      hint.appendChild(node("span", null, "Optional fields are available - fill in what you know for a much stronger build."));
      hint.appendChild(node("span", "ws-adv-hint-link", "Open advanced options"));
      hint.addEventListener("click", function () {
        wsSetAdvanced(true);
      });
      wrap.appendChild(hint);
    }
    order.forEach(function (name) {
      var section = node("div", "ai-group");
      section.appendChild(node("div", "ai-group-title", name.toUpperCase()));
      var grid = node("div", "ai-actions");
      groups[name].forEach(function (entry) {
        var button = node("button", "ai-btn", entry.spec.label);
        button.dataset.wsAction = entry.key;
        button.title = entry.spec.tip || "";
        if (entry.spec.kind === "notes") button.classList.add("ws-kind-notes");
        if (entry.spec.kind === "variations") button.classList.add("ws-kind-variations");
        grid.appendChild(button);
      });
      section.appendChild(grid);
      wrap.appendChild(section);
    });
    var tools = node("div", "ai-group");
    tools.appendChild(node("div", "ai-group-title", "WORKSHOP TOOLS"));
    var toolGrid = node("div", "ai-actions");
    [
      { label: "ANALYSE PROMPT", fn: function () { wsRun("analyse"); }, tip: "Purpose, ambiguities, contradictions and structural improvements - shown separately, nothing is changed" },
      { label: "TEMPLATES", fn: wsTemplatesModal, tip: "Built-in starting points and your own" },
      { label: "PROMPT ASSEMBLER", fn: wsAssemblerModal, tip: "Build a prompt out of labelled blocks" },
      { label: "CUSTOM MODES", fn: wsCustomModesModal, tip: "Define your own workflow and fields" }
    ].forEach(function (entry) {
      var button = node("button", "ai-btn", entry.label);
      button.title = entry.tip;
      button.addEventListener("click", entry.fn);
      toolGrid.appendChild(button);
    });
    tools.appendChild(toolGrid);
    wrap.appendChild(tools);
  }

  function wsRenderAdvanced() {
    var body = $("wsAdvBody");
    var lib = WS();
    if (!body) return;
    body.innerHTML = "";
    if (!lib) return;
    if (!state.ws.adv && !body.hidden) body.hidden = true;
    if (body.hidden) return;
    var mode = lib.modeByKey(state.ws.mode);
    var fields = lib.fieldsFor(state.ws.mode);
    var toggles = lib.togglesFor(state.ws.mode);
    if (mode && mode.hint) body.appendChild(node("p", "hint", mode.hint + " Every field is optional: fill in whatever you know and press a build button."));
    if (mode && mode.system) {
      var sys = node("div", "ws-sys");
      sys.appendChild(node("div", "lbl", "YOUR MODE INSTRUCTIONS"));
      sys.appendChild(node("pre", "ws-pre", mode.system));
      body.appendChild(sys);
    }
    if (fields.length) {
      var grid = node("div", "ws-fields");
      fields.forEach(function (field) {
        var label = node("label", "ws-field" + (field.one ? " one" : ""));
        label.appendChild(node("span", "lbl", field.label));
        var input = field.one ? node("input", "input") : node("textarea", "input ws-field-area");
        input.dataset.wsField = field.key;
        if (field.one) input.type = "text";
        input.placeholder = field.hint || "";
        input.value = state.ws.fields[field.key] || "";
        if (!field.one) input.rows = 2;
        label.appendChild(input);
        grid.appendChild(label);
      });
      body.appendChild(grid);
    }
    if (toggles.length) {
      body.appendChild(node("div", "ai-group-title", "BEHAVIOUR"));
      var tWrap = node("div", "ws-toggles");
      toggles.forEach(function (toggle) {
        var row = node("label", "ws-toggle");
        var box = node("input");
        box.type = "checkbox";
        box.dataset.wsToggle = toggle.key;
        box.checked = !!state.ws.toggles[toggle.key];
        row.appendChild(box);
        var text = node("span", "ws-toggle-text");
        text.appendChild(node("span", "ws-toggle-label", toggle.label));
        if (toggle.hint) text.appendChild(node("span", "ws-toggle-hint", toggle.hint));
        row.appendChild(text);
        tWrap.appendChild(row);
      });
      body.appendChild(tWrap);
    }
    if (!fields.length && !toggles.length && !(mode && mode.system)) {
      body.appendChild(
        para("This mode works directly on the prompt text, so there are no fixed fields. Create a custom mode if you want your own questions and output structure.", "hint")
      );
    }
    body.appendChild(node("div", "ai-group-title", "VARIATIONS"));
    var varRow = node("div", "ws-var-row");
    var countWrap = node("label", "ws-mini");
    countWrap.appendChild(node("span", "lbl", "HOW MANY"));
    var count = node("input", "input ws-tiny");
    count.type = "number";
    count.min = "2";
    count.max = "10";
    count.step = "1";
    count.value = String(state.ws.count || 3);
    count.dataset.wsCount = "1";
    countWrap.appendChild(count);
    varRow.appendChild(countWrap);
    var styleWrap = node("label", "ws-mini");
    styleWrap.appendChild(node("span", "lbl", "STYLE"));
    var style = node("select", "input ws-tiny");
    style.dataset.wsStyle = "1";
    [
      { key: "conservative", label: "CONSERVATIVE" },
      { key: "balanced", label: "BALANCED" },
      { key: "experimental", label: "EXPERIMENTAL" }
    ].forEach(function (entry) {
      var option = document.createElement("option");
      option.value = entry.key;
      option.textContent = entry.label;
      style.appendChild(option);
    });
    style.value = state.ws.style || "balanced";
    styleWrap.appendChild(style);
    varRow.appendChild(styleWrap);
    var ratingWrap = node("div", "ws-mini");
    ratingWrap.appendChild(node("span", "lbl", "CONTENT LABEL"));
    var seg = node("div", "seg ws-rating-seg");
    [
      { key: "", label: "NONE" },
      { key: "sfw", label: "SFW" },
      { key: "nsfw", label: "NSFW" }
    ].forEach(function (entry) {
      var button = node("button", "seg-btn" + (entry.key === (state.ws.rating || "") ? " active" : ""), entry.label);
      button.dataset.wsRating = entry.key;
      seg.appendChild(button);
    });
    ratingWrap.appendChild(seg);
    varRow.appendChild(ratingWrap);
    body.appendChild(varRow);
    body.appendChild(node("div", "ai-group-title", "EXTRA INSTRUCTION FOR THESE ACTIONS"));
    var focus = node("textarea", "input ws-field-area");
    focus.dataset.wsFocus = "1";
    focus.rows = 2;
    focus.placeholder = "Anything else the AI must know while working on this prompt (optional)";
    focus.value = state.ws.focus || "";
    body.appendChild(focus);
  }

  function wsRenderTabs() {
    var tabs = $("wsTabs");
    if (!tabs) return;
    Array.prototype.forEach.call(tabs.querySelectorAll("button[data-tab]"), function (button) {
      var on = button.dataset.tab === state.ws.tab;
      button.classList.toggle("active", on);
      button.setAttribute("aria-selected", on ? "true" : "false");
    });
    var po = $("wsPaneOriginal");
    var pr = $("wsPaneResult");
    if (po) po.classList.toggle("active", state.ws.tab === "prompt");
    if (pr) pr.classList.toggle("active", state.ws.tab === "result");
    tabs.hidden = !wsIsMobile();
  }

  function wsRenderChain() {
    var wrap = $("wsChain");
    if (!wrap) return;
    wrap.innerHTML = "";
    if (!state.ws.chain.length) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    wrap.appendChild(node("span", "ws-chain-label", "THIS SESSION"));
    state.ws.chain.forEach(function (step, index) {
      if (index) wrap.appendChild(node("span", "ws-chain-sep", "\u2192"));
      wrap.appendChild(node("span", "ws-chain-chip", step));
    });
    var clear = node("button", "btn tiny ghost", "Clear");
    clear.addEventListener("click", function () {
      state.ws.chain = [];
      wsRenderChain();
    });
    wrap.appendChild(clear);
  }

  function wsUpdateProgress(text) {
    var node_ = $("wsResultProgress");
    if (node_) node_.textContent = text || "";
  }

  function wsRenderResult() {
    var ws = state.ws;
    var area = $("wsResultText");
    var label = $("wsResultLabel");
    var pill = $("wsResultPill");
    var note = $("wsResultNote");
    var actions = $("wsResultActions");
    var analysisBox = $("wsAnalysis");
    var variationsBox = $("wsVariations");
    var manualBox = $("wsManualBox");
    if (label) label.textContent = (ws.resultLabel || "").toUpperCase() || "AI RESULT";
    if (pill) {
      var status = AI.status();
      var ready = status.ready;
      pill.textContent = ws.running ? "working" : ready ? status.label : "manual mode";
      pill.className = "pill " + (ws.running ? "warn" : ready ? "ok" : "warn");
      pill.title = status.label;
    }
    var showText = ws.resultKind !== "analysis" && ws.resultKind !== "variations" && ws.resultKind !== "manual";
    if (area) {
      if (area.value !== (ws.result || "")) area.value = ws.result || "";
      area.hidden = !showText;
    }
    if (note) {
      var emptyResult = !ws.result && !ws.running && !ws.resultKind;
      note.textContent = emptyResult
        ? "Nothing yet \u2014 choose an action on the left and the result appears here, next to your original. Your prompt is never changed until you press REPLACE ORIGINAL."
        : ws.resultNote || "";
      note.hidden = !note.textContent;
    }
    if (analysisBox) analysisBox.hidden = ws.resultKind !== "analysis";
    if (variationsBox) variationsBox.hidden = ws.resultKind !== "variations";
    if (manualBox) manualBox.hidden = ws.resultKind !== "manual";
    if (ws.resultKind === "manual") {
      var manualText = $("wsManualText");
      if (manualText) manualText.value = ws.manual || "";
    }
    wsRenderAnalysis();
    wsRenderVariations();
    if (actions) {
      actions.innerHTML = "";
      wsResultActions(actions);
    }
    wsUpdateProgress(ws.running ? "generating\u2026" : ws.result ? ws.result.length + " chars" : "");
  }

  function wsResultButton(actions, label, mode, kind) {
    var button = node("button", "btn sm" + (kind ? " " + kind : ""), label);
    button.dataset.wsResult = mode;
    actions.appendChild(button);
    return button;
  }

  function wsResultActions(actions) {
    var ws = state.ws;
    if (ws.running) {
      wsResultButton(actions, "STOP", "stop", "danger");
      return;
    }
    if (ws.resultKind === "manual") {
      return;
    }
    if (ws.resultKind === "error") {
      wsResultButton(actions, "TRY AGAIN", "retry", "primary");
      wsResultButton(actions, "MANUAL REQUEST", "manual");
      wsResultButton(actions, "DISCARD", "discard", "ghost");
      return;
    }
    if (!ws.resultKind) {
      return;
    }
    if (ws.resultKind === "analysis") {
      wsResultButton(actions, "COPY ANALYSIS", "copy");
      wsResultButton(actions, "TRY AGAIN", "retry");
      wsResultButton(actions, "ANALYSE A CHANGE", "analyse-missing");
      wsResultButton(actions, "DISCARD", "discard", "ghost");
      return;
    }
    if (ws.resultKind === "variations") {
      wsResultButton(actions, "COPY ALL", "copy");
      wsResultButton(actions, "TRY AGAIN", "retry");
      wsResultButton(actions, "MORE VARIATIONS", "more-variations");
      wsResultButton(actions, "DISCARD", "discard", "ghost");
      return;
    }
    if (ws.resultKind === "notes") {
      wsResultButton(actions, "COPY CRITIQUE", "copy");
      wsResultButton(actions, "APPEND AS NOTES", "append");
      wsResultButton(actions, "SAVE AS NEW PROMPT", "save");
      wsResultButton(actions, "TRY AGAIN", "retry");
      wsResultButton(actions, "DISCARD", "discard", "ghost");
      return;
    }
    wsResultButton(actions, "REPLACE ORIGINAL", "replace", "primary");
    wsResultButton(actions, "APPEND", "append");
    wsResultButton(actions, "CONTINUE FROM RESULT", "continue");
    wsResultButton(actions, "SAVE\u2026", "save");
    wsResultButton(actions, "COPY RESULT", "copy");
    wsResultButton(actions, "TRY AGAIN", "retry");
    if (ws.history.length) wsResultButton(actions, "UNDO", "undo");
  }

  function wsRenderAnalysis() {
    var box = $("wsAnalysis");
    if (!box) return;
    var data = state.ws.analysis;
    box.innerHTML = "";
    if (state.ws.resultKind !== "analysis") return;
    if (!state.ws.result.trim()) return;
    if (!data) {
      box.appendChild(node("p", "hint", "The model answered in prose rather than the structured form, so here it is unparsed."));
      box.appendChild(node("pre", "ws-pre ws-readout", state.ws.result));
      return;
    }
    if (data.purpose) {
      var purpose = node("div", "ws-analysis-block");
      purpose.appendChild(node("div", "ws-analysis-title", "PURPOSE"));
      purpose.appendChild(node("p", null, data.purpose));
      box.appendChild(purpose);
    }
    if (data.type) {
      var type = node("div", "ws-analysis-block");
      type.appendChild(node("div", "ws-analysis-title", "LIKELY PROMPT TYPE"));
      type.appendChild(node("p", null, data.type));
      box.appendChild(type);
    }
    var sections = [
      { key: "clear", label: "WHAT IS CLEAR", kind: "ok" },
      { key: "constraints", label: "IMPORTANT CONSTRAINTS", kind: "ok" },
      { key: "ambiguous", label: "WHAT IS AMBIGUOUS", kind: "warn" },
      { key: "missing", label: "WHAT MAY BE MISSING", kind: "warn" },
      { key: "contradictions", label: "CONTRADICTIONS", kind: "bad" },
      { key: "repeated", label: "REPEATED INSTRUCTIONS", kind: "warn" },
      { key: "structure", label: "POTENTIAL STRUCTURAL IMPROVEMENTS", kind: "info" }
    ];
    sections.forEach(function (section) {
      var items = data[section.key] || [];
      if (!items.length) return;
      var block = node("div", "ws-analysis-block " + section.kind);
      block.appendChild(node("div", "ws-analysis-title", section.label));
      var list = node("ul", "ws-analysis-list");
      items.forEach(function (item) {
        list.appendChild(node("li", null, item));
      });
      block.appendChild(list);
      box.appendChild(block);
    });
    box.appendChild(
      node("p", "hint", "Recommendations only. The prompt above has not been changed - press REPLACE ORIGINAL, or use an action to apply what you agree with.")
    );
  }

  function wsRenderVariations() {
    var box = $("wsVariations");
    if (!box) return;
    box.innerHTML = "";
    if (state.ws.resultKind !== "variations") return;
    var list = state.ws.variations;
    if (!list || !list.length) {
      if (state.ws.result.trim()) {
        box.appendChild(node("p", "hint", "Could not find separate variations in the reply, so here it is as one block."));
        box.appendChild(node("pre", "ws-pre ws-readout", state.ws.result));
      }
      return;
    }
    var head = node("div", "ws-var-head");
    head.appendChild(node("span", "ws-score-title", list.length + " VARIATIONS \u00b7 " + (state.ws.style || "balanced").toUpperCase()));
    box.appendChild(head);
    list.forEach(function (variation, index) {
      var card = node("div", "ws-var-card");
      var top = node("div", "ws-var-top");
      top.appendChild(node("span", "ws-var-index", "V" + (index + 1)));
      top.appendChild(node("span", "ws-var-approach", variation.approach || "Approach " + (index + 1)));
      card.appendChild(top);
      var body = node("textarea", "input ws-field-area ws-var-text");
      body.spellcheck = false;
      body.rows = 5;
      body.value = variation.text;
      card.appendChild(body);
      var row = node("div", "ai-result-actions");
      var buttons = [
        {
          label: "COPY",
          kind: "",
          fn: function () {
            copyText(body.value, "Variation " + (index + 1));
          }
        },
        {
          label: "SAVE",
          kind: "",
          fn: function () {
            wsSaveTo(wsCurrentFolderId(), wsSuggestTitle() + " \u2013 variation " + (index + 1), body.value);
          }
        },
        {
          label: "OPEN IN WORKSHOP",
          kind: "primary",
          fn: function () {
            wsAdopt(body.value, "variation");
          }
        }
      ];
      buttons.forEach(function (entry) {
        var button = node("button", "btn sm" + (entry.kind ? " " + entry.kind : ""), entry.label);
        button.addEventListener("click", entry.fn);
        row.appendChild(button);
      });
      card.appendChild(row);
      box.appendChild(card);
    });
  }

  function wsMaybeSuggest() {
    var ws = state.ws;
    var bar = $("wsSuggest");
    if (!bar) return;
    var lib = WS();
    if (!lib || ws.dismissed) return;
    var guess = lib.detectMode(ws.text || "");
    if (!guess || guess === ws.mode) {
      ws.suggested = null;
      bar.hidden = true;
      bar.innerHTML = "";
      return;
    }
    ws.suggested = guess;
    bar.hidden = false;
    bar.innerHTML = "";
    var guessLabel = modeLabel(guess).toLowerCase();
    bar.appendChild(node("span", "ws-suggest-text", "This looks like " + (/^[aeiou]/.test(guessLabel) ? "an " : "a ") + guessLabel + " prompt."));
    bar.appendChild(node("span", "ws-suggest-strong", modeLabel(guess) + " MODE"));
    var use = node("button", "btn tiny primary", "USE SUGGESTION");
    use.addEventListener("click", function () {
      wsSetMode(guess);
    });
    bar.appendChild(use);
    var mine = node("button", "btn tiny ghost", "CHOOSE MYSELF");
    mine.addEventListener("click", function () {
      ws.dismissed = true;
      bar.hidden = true;
      bar.innerHTML = "";
    });
    bar.appendChild(mine);
  }

  // ---------------------------------------------------------------- running actions

  function wsRun(actionKey, opts) {
    var lib = WS();
    if (!lib) {
      toast("The Workshop module did not load", { type: "err" });
      return;
    }
    var ws = state.ws;
    var options = opts || {};
    if (ws.running) {
      toast("An AI action is already running", { type: "warn" });
      return;
    }
    var ctx = wsCtx();
    if (actionKey !== "analyse" && actionKey !== "variations" && actionKey !== "directions" && !String(ctx.text || "").trim()) {
      var hasFields = Object.keys(ctx.fields || {}).some(function (key) {
        return String(ctx.fields[key] || "").trim();
      });
      if (!hasFields) {
        toast("Write or paste a prompt first", { type: "warn" });
        var area = $("wsPrompt");
        if (area) area.focus();
        return;
      }
    }
    if (actionKey === "analyse" && !String(ctx.text || "").trim()) {
      toast("Paste or write a prompt for the analysis to work on", { type: "warn" });
      return;
    }
    var spec;
    try {
      spec = lib.build(actionKey, ctx);
    } catch (err) {
      toast("Could not build that request", { type: "err" });
      return;
    }
    ws.actionKey = actionKey;
    ws.lastSpec = spec;
    ws.snapshot = ws.text || "";
    ws.resultKind = spec.kind;
    ws.resultLabel = spec.label;
    ws.resultNote = "";
    ws.result = "";
    ws.manual = "";
    ws.analysis = null;
    ws.variations = null;
    ws.tab = "result";
    ws.chain.push(spec.label + (actionKey === "buildCustom" ? "" : ""));
    if (ws.chain.length > 12) ws.chain = ws.chain.slice(-12);
    wsPersist();
    var manual = !wsStatusReady() || !!options.manual;
    if (manual) {
      wsShowManual(spec, options.manualNote || "");
      return;
    }
    ws.running = true;
    ws.controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    wsRender();
    wsUpdateProgress("0 chars");
    lib
      .run(actionKey, ctx, {
        signal: ws.controller ? ws.controller.signal : undefined,
        onChunk: function (chunk, full) {
          if (full != null && full !== "") ws.result = String(full);
          else ws.result = (ws.result || "") + (chunk || "");
          var area = $("wsResultText");
          if (area && area.value !== ws.result) area.value = ws.result;
          wsUpdateProgress(ws.result.length + " chars \u00b7 generating\u2026");
        }
      })
      .then(function (result) {
        ws.running = false;
        ws.result = String(result.text || "").trim();
        wsFinishResult();
      })
      .catch(function (err) {
        ws.running = false;
        if (err && (err.code === "no-provider" || err.code === "offline")) {
          wsShowManual(spec, err && err.message ? err.message : "");
          return;
        }
        if (err && err.name === "AbortError") {
          ws.resultKind = "error";
          ws.resultNote = "Stopped before it finished. Keep what arrived, or try again.";
          wsRender();
          return;
        }
        ws.resultKind = "error";
        ws.resultNote = (err && err.message ? err.message : String(err)) + " Try again, or use the manual request path.";
        wsRender();
        toast("AI action failed", { type: "err", timeout: 9000 });
      });
  }

  function wsFinishResult() {
    var ws = state.ws;
    var lib = WS();
    ws.running = false;
    if (!ws.result) {
      ws.resultKind = "error";
      ws.resultNote = "The AI returned nothing. Try again, or use the manual request path.";
      wsRender();
      return;
    }
    if (lib && ws.resultKind === "variations") ws.variations = lib.parseVariations(ws.result);
    if (lib && ws.resultKind === "analysis") ws.analysis = lib.parseAnalysis(ws.result);
    wsRender();
  }

  function wsStop() {
    if (state.ws.controller) state.ws.controller.abort();
  }

  function wsShowManual(spec, note) {
    var ws = state.ws;
    ws.running = false;
    ws.controller = null;
    ws.resultKind = "manual";
    ws.resultLabel = spec && spec.label ? spec.label : "REQUEST";
    ws.manual = spec && spec.manual ? spec.manual : "";
    var offline = typeof navigator !== "undefined" && navigator.onLine === false;
    var base = offline
      ? "AI provider unavailable and you are offline. You can still copy the generated AI request and use it externally, then paste the answer back - every Workshop feature still works this way."
      : "No AI provider is connected, so here is the complete request built locally. Copy it into any AI tool, then paste the answer back - every Workshop feature still works this way.";
    ws.resultNote = note ? note + " " + base : base;
    var answer = $("wsManualAnswer");
    if (answer) answer.value = "";
    wsRender();
    setTimeout(function () {
      var el = $("wsManualAnswer");
      if (el) el.focus();
    }, 60);
  }

  function wsManualUse() {
    var ws = state.ws;
    var area = $("wsManualAnswer");
    var answer = area ? String(area.value || "").trim() : "";
    if (!answer) {
      toast("Paste the AI answer first", { type: "warn" });
      if (area) area.focus();
      return;
    }
    var spec = ws.lastSpec;
    ws.result = answer;
    ws.resultKind = spec ? spec.kind : "prompt";
    ws.resultLabel = spec ? spec.label + " (manual)" : "RESULT (manual)";
    ws.resultNote = "Manually produced result. Nothing is applied until you press REPLACE ORIGINAL.";
    wsFinishResult();
  }

  // ---------------------------------------------------------------- applying results

  function wsPushHistory(label) {
    var ws = state.ws;
    ws.history.push({ text: ws.text || "", label: label || "edit", at: Date.now() });
    if (ws.history.length > 40) ws.history.shift();
  }

  function wsUndo() {
    var ws = state.ws;
    var entry = ws.history.pop();
    if (!entry) {
      toast("Nothing to undo in this session yet", { type: "warn" });
      return;
    }
    ws.text = entry.text;
    if (ws.promptId) wsWriteThrough(entry.text, "");
    ws.snapshot = null;
    wsPersist();
    wsRender();
    toast("Restored the prompt from before " + (entry.label || "that change"), { type: "ok" });
  }

  function wsAdopt(text, label) {
    var ws = state.ws;
    wsPushHistory(label || "adopt");
    ws.text = text;
    ws.snapshot = null;
    ws.result = "";
    ws.resultKind = "";
    ws.resultLabel = "";
    ws.resultNote = "";
    ws.manual = "";
    ws.analysis = null;
    ws.variations = null;
    ws.tab = "prompt";
    ws.lastSpec = null;
    wsPersist();
    wsRender();
  }

  function wsDiscard() {
    var ws = state.ws;
    ws.result = "";
    ws.resultKind = "";
    ws.resultLabel = "";
    ws.resultNote = "";
    ws.manual = "";
    ws.analysis = null;
    ws.variations = null;
    wsRender();
  }

  function wsWriteThrough(text, label) {
    var ws = state.ws;
    var record = ws.promptId ? promptById(ws.promptId) : null;
    if (!record) return false;
    var before = record.content || "";
    if (before === text) return false;
    record.content = text;
    record.updatedAt = Date.now();
    if (state.current && state.current.id === record.id) state.renderedId = null;
    markDirty();
    flushSave();
    renderAll();
    if (label) {
      undoToast(label, function () {
        var again = promptById(record.id);
        if (!again) return;
        again.content = before;
        again.updatedAt = Date.now();
        if (state.ws.promptId === record.id) {
          state.ws.text = before;
          wsRender();
        }
      });
    }
    return true;
  }

  function wsApply(mode) {
    var ws = state.ws;
    if (mode === "stop") {
      wsStop();
      return;
    }
    if (mode === "discard") {
      wsDiscard();
      return;
    }
    if (mode === "retry") {
      wsRun(ws.actionKey);
      return;
    }
    if (mode === "undo") {
      wsUndo();
      return;
    }
    if (mode === "copy") {
      copyText(ws.result, "AI result");
      return;
    }
    if (mode === "save") {
      wsSaveMenu();
      return;
    }
    if (mode === "manual") {
      wsShowManual(ws.lastSpec, "");
      return;
    }
    if (mode === "analyse-missing") {
      wsRun("missing");
      return;
    }
    if (mode === "more-variations") {
      wsRun("variations");
      return;
    }
    var text = String(ws.result || "").trim();
    if (!text) {
      toast("There is no result to use yet", { type: "warn" });
      return;
    }
    if (mode === "continue") {
      wsPushHistory("CONTINUE FROM RESULT");
      ws.text = ws.result;
      wsWriteThrough(ws.text, "Continued from the result");
      ws.snapshot = ws.result;
      ws.result = "";
      ws.resultKind = "";
      ws.resultLabel = "";
      ws.resultNote = "";
      ws.manual = "";
      ws.analysis = null;
      ws.variations = null;
      ws.tab = "prompt";
      ws.lastSpec = null;
      wsPersist();
      wsRender();
      wsSetAdvanced(false);
      toast("The result is now the input - pick the next action", { type: "ok" });
      return;
    }
    if (mode === "replace") {
      wsPushHistory("REPLACE ORIGINAL");
      ws.text = ws.result;
      ws.snapshot = state.ws.snapshot;
      var wrote = wsWriteThrough(ws.text, "Replaced the original prompt");
      wsPersist();
      wsRender();
      if (!wrote) toast("Prompt replaced \u2014 UNDO is available for this session", { type: "ok", timeout: 9000 });
      return;
    }
    if (mode === "append") {
      wsPushHistory("APPEND");
      var joiner = String(ws.text || "").trim() ? "\n\n" : "";
      ws.text = (ws.text || "") + joiner + ws.result;
      wsWriteThrough(ws.text, "Appended the AI result to the prompt");
      wsPersist();
      wsRender();
      if (ws.resultKind === "notes") toast("Appended the critique as notes", { type: "ok" });
      return;
    }
  }

  // ---------------------------------------------------------------- saving

  function wsCurrentFolderId() {
    var ws = state.ws;
    if (ws.promptId) {
      var record = promptById(ws.promptId);
      if (record) return record.folderId;
    }
    return targetFolderId();
  }

  function wsSuggestTitle() {
    var ws = state.ws;
    var base = String(ws.promptTitle || "").replace(/\s*\(workshop\)\s*$/i, "").trim();
    if (!base) {
      var line = String(ws.text || "").split("\n").filter(function (l) {
        return l.trim();
      })[0] || "";
      base = line.replace(/^[A-Za-z][A-Za-z0-9 /&_-]{1,30}:\s*/, "").trim().slice(0, 60);
    }
    if (!base) base = modeLabel(ws.mode) + " prompt";
    return base + " (workshop)";
  }

  function wsSaveTo(folderId, title, text) {
    var ws = state.ws;
    var body = text != null ? text : ws.result;
    if (!String(body || "").trim()) {
      toast("There is nothing to save yet", { type: "warn" });
      return null;
    }
    var record = addPromptFromFields({
      title: String(title || wsSuggestTitle()).slice(0, 120),
      content: body,
      folderId: folderId || wsCurrentFolderId(),
      tags: [],
      type: wsModeType(ws.mode),
      rating: ws.rating || "",
      mode: ws.mode,
      sourceId: ws.promptId || ""
    });
    markDirty();
    flushSave();
    renderAll();
    toast("Saved to " + (pathOf(record.folderId) || "your library"), { type: "ok" });
    return record;
  }

  function wsSaveAsNew() {
    var ws = state.ws;
    textPromptDialog({
      title: "Save as a new prompt",
      message: "The result is saved as a new prompt in " + (pathOf(wsCurrentFolderId()) || "your library") + ".",
      value: wsSuggestTitle(),
      placeholder: "Prompt title",
      confirmLabel: "Save prompt",
      onConfirm: function (value) {
        wsSaveTo(wsCurrentFolderId(), value, ws.result);
      }
    });
  }

  function wsUpdateOpenPrompt() {
    var ws = state.ws;
    if (!ws.promptId) return;
    if (!String(ws.result || "").trim()) {
      toast("There is no result to apply", { type: "warn" });
      return;
    }
    wsPushHistory("UPDATE THE OPEN PROMPT");
    ws.text = ws.result;
    wsWriteThrough(ws.text, "Updated the open prompt");
    wsPersist();
    wsRender();
  }

  function wsSaveMenu() {
    var ws = state.ws;
    if (!String(ws.result || "").trim()) {
      toast("There is nothing to save yet", { type: "warn" });
      return;
    }
    var preview = node("textarea", "input textarea-mono ws-save-preview");
    preview.value = ws.result;
    preview.readOnly = true;
    var api;
    var buttons = [
      {
        label: "SAVE TO CURRENT FOLDER",
        kind: "primary",
        onClick: function () {
          api.close();
          wsSaveTo(wsCurrentFolderId(), wsSuggestTitle());
        }
      },
      {
        label: "SAVE TO A DIFFERENT FOLDER\u2026",
        onClick: function () {
          api.close();
          folderPickerDialog("Save to folder\u2026", function (folderId) {
            wsSaveTo(folderId, wsSuggestTitle());
          });
        }
      },
      {
        label: "SAVE AS NEW PROMPT\u2026",
        onClick: function () {
          api.close();
          wsSaveAsNew();
        }
      }
    ];
    if (ws.promptId) {
      buttons.push({
        label: "UPDATE THE OPEN PROMPT",
        onClick: function () {
          api.close();
          wsUpdateOpenPrompt();
        }
      });
    }
    buttons.push({ label: "Cancel", kind: "ghost" });
    api = modal({
      title: "Save this result",
      body: [
        para("Saved prompts keep the Workshop mode, the creation date and the source prompt id. Metadata is optional - it is only a hint for later.", "hint"),
        preview
      ],
      buttons: buttons
    });
  }

  // ---------------------------------------------------------------- templates

  function wsTemplateList() {
    var builtins = (cfg.workshopTemplates || []).map(function (tpl) {
      return Object.assign({}, tpl, { builtin: true });
    });
    var mine = (wsSettings().templates || []).map(function (tpl) {
      return Object.assign({}, tpl, { builtin: false });
    });
    return builtins.concat(mine);
  }

  function wsUseTemplate(tpl) {
    if (!tpl) return;
    var ws = state.ws;
    wsPushHistory("template: " + tpl.label);
    wsSetMode(tpl.mode || "general");
    Object.keys(tpl.fields || {}).forEach(function (key) {
      state.ws.fields[key] = tpl.fields[key];
    });
    Object.keys(tpl.toggles || {}).forEach(function (key) {
      state.ws.toggles[key] = !!tpl.toggles[key];
    });
    ws.source = "build";
    ws.tab = "prompt";
    wsSetAdvanced(true);
    wsPersist();
    wsRender();
    var blurbs = Object.keys(tpl.fields || {}).filter(function (key) {
      var value = String(tpl.fields[key] || "");
      return value && value !== "...";
    });
    toast("Loaded " + tpl.label + (blurbs.length ? " - " + blurbs.length + " field(s) pre-filled" : ""), { type: "ok" });
  }

  function wsTemplateEditor(tpl) {
    var isNew = !tpl;
    var draft = {
      key: tpl && tpl.key ? tpl.key : uid("t"),
      label: tpl ? tpl.label || "" : "",
      mode: tpl ? tpl.mode || state.ws.mode : state.ws.mode,
      hint: tpl ? tpl.hint || "" : "",
      fields: Object.assign({}, (tpl && tpl.fields) || {}),
      toggles: Object.assign({}, (tpl && tpl.toggles) || {})
    };
    var lib = WS();
    var body = node("div", "ws-editor");
    function textField(labelText, value, placeholder, onInput) {
      var wrap = node("label", "ws-field one");
      wrap.appendChild(node("span", "lbl", labelText));
      var input = node("input", "input");
      input.type = "text";
      input.value = value || "";
      input.placeholder = placeholder || "";
      input.addEventListener("input", function () {
        onInput(input.value);
      });
      wrap.appendChild(input);
      return wrap;
    }
    body.appendChild(textField("TEMPLATE NAME", draft.label, "e.g. TouchDesigner Animation Prompt", function (value) {
      draft.label = value;
    }));
    var modeWrap = node("label", "ws-field one");
    modeWrap.appendChild(node("span", "lbl", "MODE"));
    var modeSelect = node("select", "input");
    (lib ? lib.modeList() : []).forEach(function (mode) {
      var option = document.createElement("option");
      option.value = mode.key;
      option.textContent = mode.label;
      modeSelect.appendChild(option);
    });
    modeSelect.value = draft.mode;
    modeWrap.appendChild(modeSelect);
    body.appendChild(modeWrap);
    body.appendChild(textField("SHORT DESCRIPTION", draft.hint, "What is this template for?", function (value) {
      draft.hint = value;
    }));
    body.appendChild(node("div", "ai-group-title", "DEFAULT FIELD VALUES (ALL OPTIONAL)"));
    var fieldsWrap = node("div", "ws-fields");
    body.appendChild(fieldsWrap);
    body.appendChild(node("div", "ai-group-title", "BEHAVIOUR"));
    var toggleWrap = node("div", "ws-toggles");
    body.appendChild(toggleWrap);
    function paint() {
      fieldsWrap.innerHTML = "";
      toggleWrap.innerHTML = "";
      var fields = lib ? lib.fieldsFor(draft.mode) : [];
      if (!fields.length) {
        fieldsWrap.appendChild(para("This mode has no fixed fields. The template just selects the mode.", "hint"));
      }
      fields.forEach(function (field) {
        var label = node("label", "ws-field" + (field.one ? " one" : ""));
        label.appendChild(node("span", "lbl", field.label));
        var input = field.one ? node("input", "input") : node("textarea", "input ws-field-area");
        input.rows = 2;
        input.placeholder = field.hint || "";
        input.value = draft.fields[field.key] || "";
        input.addEventListener("input", function () {
          draft.fields[field.key] = input.value;
        });
        label.appendChild(input);
        fieldsWrap.appendChild(label);
      });
      var toggles = lib ? lib.togglesFor(draft.mode) : [];
      toggles.forEach(function (toggle) {
        var row = node("label", "ws-toggle");
        var box = node("input");
        box.type = "checkbox";
        box.checked = draft.toggles[toggle.key] === true;
        box.addEventListener("change", function () {
          draft.toggles[toggle.key] = box.checked;
        });
        row.appendChild(box);
        var text = node("span", "ws-toggle-text");
        text.appendChild(node("span", "ws-toggle-label", toggle.label));
        if (toggle.hint) text.appendChild(node("span", "ws-toggle-hint", toggle.hint));
        row.appendChild(text);
        toggleWrap.appendChild(row);
      });
      if (!toggles.length) toggleWrap.appendChild(para("No behaviour switches for this mode.", "hint"));
    }
    modeSelect.addEventListener("change", function () {
      draft.mode = modeSelect.value;
      paint();
    });
    paint();
    function save() {
      var label = String(draft.label || "").trim();
      if (!label) {
        toast("Give the template a name first", { type: "warn" });
        return false;
      }
      var store = wsSettings();
      var entry = {
        key: draft.key,
        label: label.slice(0, 60),
        mode: draft.mode,
        hint: String(draft.hint || "").slice(0, 200),
        fields: draft.fields,
        toggles: draft.toggles
      };
      var found = false;
      store.templates = (store.templates || []).map(function (existing) {
        if (existing.key === entry.key) {
          found = true;
          return entry;
        }
        return existing;
      });
      if (!found) store.templates.push(entry);
      wsPersistNow();
      toast("Saved template " + entry.label, { type: "ok" });
      wsTemplatesModal();
      return true;
    }
    modal({
      title: isNew ? "Create a template" : "Edit template",
      body: [body],
      wide: true,
      bodyClass: "ws-editor-body",
      focus: body.querySelector("input"),
      buttons: [
        { label: "SAVE TEMPLATE", kind: "primary", onClick: save },
        { label: "Cancel", kind: "ghost" }
      ]
    });
  }

  function wsDuplicateTemplate(tpl) {
    var copy = {
      key: uid("t"),
      label: (tpl.label || "Template") + " COPY",
      mode: tpl.mode,
      hint: tpl.hint || "",
      fields: Object.assign({}, tpl.fields || {}),
      toggles: Object.assign({}, tpl.toggles || {})
    };
    var store = wsSettings();
    store.templates = store.templates || [];
    store.templates.push(copy);
    wsPersistNow();
    toast("Duplicated as \"" + copy.label + "\" - edit it to make it yours", { type: "ok" });
    wsTemplatesModal();
  }

  function wsDeleteTemplate(tpl) {
    confirmDialog({
      title: "Delete template",
      message: "Delete the template \"" + tpl.label + "\"? Built-in templates are never removed.",
      confirmLabel: "Delete template",
      danger: true,
      onConfirm: function () {
        var store = wsSettings();
        store.templates = (store.templates || []).filter(function (existing) {
          return existing.key !== tpl.key;
        });
        wsPersistNow();
        toast("Template deleted", { type: "ok" });
        wsTemplatesModal();
      }
    });
  }

  function wsTemplatesModal() {
    var body = node("div", "ws-tpl-body");
    body.appendChild(
      para("Templates fill the mode and its optional fields. Use one as-is, duplicate it, or create your own - they are stored on this device only.", "hint")
    );
    var list = node("div", "ws-tpl-list");
    wsTemplateList().forEach(function (tpl) {
      var card = node("div", "ws-tpl");
      var top = node("div", "ws-tpl-top");
      top.appendChild(node("span", "ws-tpl-title", tpl.label));
      top.appendChild(node("span", "pill" + (tpl.builtin ? "" : " ok"), tpl.builtin ? "BUILT-IN" : "MINE"));
      card.appendChild(top);
      card.appendChild(node("div", "ws-tpl-hint", modeLabel(tpl.mode) + " mode \u00b7 " + (tpl.hint || "no description")));
      var row = node("div", "ai-result-actions");
      var entries = [
        { label: "USE TEMPLATE", kind: "primary", fn: function () { api.close(); wsUseTemplate(tpl); } },
        { label: "DUPLICATE", kind: "", fn: function () { api.close(); wsDuplicateTemplate(tpl); } }
      ];
      if (!tpl.builtin) {
        entries.push({ label: "EDIT", kind: "", fn: function () { api.close(); wsTemplateEditor(tpl); } });
        entries.push({ label: "DELETE", kind: "danger", fn: function () { api.close(); wsDeleteTemplate(tpl); } });
      }
      entries.forEach(function (entry) {
        var button = node("button", "btn sm" + (entry.kind ? " " + entry.kind : ""), entry.label);
        button.addEventListener("click", entry.fn);
        row.appendChild(button);
      });
      card.appendChild(row);
      list.appendChild(card);
    });
    body.appendChild(list);
    var api = modal({
      title: "Templates",
      body: [body],
      wide: true,
      bodyClass: "ws-editor-body",
      buttons: [
        { label: "CREATE TEMPLATE", kind: "primary", onClick: function () { wsTemplateEditor(null); } },
        { label: "SAVE CURRENT SETUP AS TEMPLATE", onClick: function () { wsCreateTemplateFromWorkshop(); } },
        { label: "Close", kind: "ghost" }
      ]
    });
  }

  function wsCreateTemplateFromWorkshop() {
    var ws = state.ws;
    wsTemplateEditor({
      key: uid("t"),
      label: (modeLabel(ws.mode) + " setup"),
      mode: ws.mode,
      hint: "Saved from the Workshop on " + new Date().toLocaleDateString(),
      fields: Object.assign({}, ws.fields || {}),
      toggles: Object.assign({}, ws.toggles || {})
    });
  }

  // ---------------------------------------------------------------- custom modes

  function wsCustomModesModal() {
    var store = wsSettings();
    var body = node("div", "ws-tpl-body");
    body.appendChild(
      para("A custom mode is your own prompt-building workflow: a name, a system instruction the AI always follows, your own questions, and the output structure you want. Custom modes are stored with the rest of your settings on this device.", "hint")
    );
    var list = node("div", "ws-tpl-list");
    var modes = store.customModes || [];
    if (!modes.length) list.appendChild(para("No custom modes yet.", "hint"));
    modes.forEach(function (mode) {
      var card = node("div", "ws-tpl");
      var top = node("div", "ws-tpl-top");
      top.appendChild(node("span", "ws-tpl-title", mode.label));
      top.appendChild(node("span", "pill ok", (mode.fields || []).length + " FIELDS"));
      card.appendChild(top);
      card.appendChild(node("div", "ws-tpl-hint", mode.hint || "Your own workflow"));
      var row = node("div", "ai-result-actions");
      [
        { label: "EDIT", kind: "primary", fn: function () { api.close(); wsCustomModeEditor(mode); } },
        {
          label: "DUPLICATE",
          kind: "",
          fn: function () {
            api.close();
            var copy = JSON.parse(JSON.stringify(mode));
            copy.key = uid("cm");
            copy.label = (mode.label || "MODE") + " COPY";
            store.customModes.push(copy);
            wsPersistNow();
            wsCustomModesModal();
            toast("Duplicated " + copy.label, { type: "ok" });
          }
        },
        {
          label: "DELETE",
          kind: "danger",
          fn: function () {
            api.close();
            confirmDialog({
              title: "Delete custom mode",
              message: "Delete the custom mode \"" + mode.label + "\"?",
              confirmLabel: "Delete mode",
              danger: true,
              onConfirm: function () {
                store.customModes = (store.customModes || []).filter(function (existing) {
                  return existing.key !== mode.key;
                });
                if (state.ws.mode === mode.key) wsSetMode("general");
                wsPersistNow();
                toast("Custom mode deleted", { type: "ok" });
                if (state.ws.open) wsRender();
              }
            });
          }
        }
      ].forEach(function (entry) {
        var button = node("button", "btn sm" + (entry.kind ? " " + entry.kind : ""), entry.label);
        button.addEventListener("click", entry.fn);
        row.appendChild(button);
      });
      card.appendChild(row);
      list.appendChild(card);
    });
    body.appendChild(list);
    var api = modal({
      title: "Custom modes",
      body: [body],
      wide: true,
      bodyClass: "ws-editor-body",
      buttons: [
        {
          label: "CREATE CUSTOM MODE",
          kind: "primary",
          onClick: function () {
            wsCustomModeEditor(null);
          }
        },
        { label: "Close", kind: "ghost" }
      ]
    });
  }

  function wsCustomModeEditor(mode) {
    var isNew = !mode;
    var draft = {
      key: mode && mode.key ? mode.key : uid("cm"),
      label: (mode && mode.label) || "",
      hint: (mode && mode.hint) || "",
      system: (mode && mode.system) || "",
      output: (mode && mode.output) || "",
      fields: ((mode && mode.fields) || []).map(function (field) {
        return { key: field.key, label: field.label, hint: field.hint || "" };
      }),
      actions: (mode && mode.actions ? mode.actions.slice() : ["buildCustom", "improve", "review", "copypaste"])
    };
    var body = node("div", "ws-editor");
    function namedField(labelText, placeholder, value, onInput, one) {
      var wrap = node("label", "ws-field one");
      wrap.appendChild(node("span", "lbl", labelText));
      var input = one ? node("input", "input") : node("textarea", "input ws-field-area");
      if (one) input.type = "text";
      else input.rows = 2;
      input.value = value || "";
      input.placeholder = placeholder || "";
      input.addEventListener("input", function () {
        onInput(input.value);
      });
      wrap.appendChild(input);
      return wrap;
    }
    body.appendChild(namedField("MODE NAME", "e.g. TouchDesigner Animation Prompt", draft.label, function (value) {
      draft.label = value;
    }, true));
    body.appendChild(namedField("SHORT DESCRIPTION", "What is this workflow for?", draft.hint, function (value) {
      draft.hint = value;
    }, true));
    body.appendChild(
      namedField(
        "SYSTEM INSTRUCTION (ALWAYS FOLLOWED)",
        "You are an expert TouchDesigner artist. Work only in terms of networks, operators and parameters...",
        draft.system,
        function (value) {
          draft.system = value;
        }
      )
    );
    body.appendChild(node("div", "ai-group-title", "QUESTIONS / FIELDS"));
    body.appendChild(para("One per line, as LABEL | optional hint. These become the optional fields in the Workshop.", "hint"));
    var fieldsArea = node("textarea", "input ws-field-area ws-lines");
    fieldsArea.rows = 4;
    fieldsArea.placeholder = "CONCEPT | what the animation shows\nDURATION | how long it runs\nOUTPUT | what must be delivered";
    fieldsArea.value = draft.fields
      .map(function (field) {
        return field.label + (field.hint ? " | " + field.hint : "");
      })
      .join("\n");
    body.appendChild(fieldsArea);
    body.appendChild(namedField("DEFAULT OUTPUT STRUCTURE", "Reply with the prompt only, in labelled sections...", draft.output, function (value) {
      draft.output = value;
    }));
    body.appendChild(node("div", "ai-group-title", "ACTIONS AVAILABLE IN THIS MODE"));
    var actionWrap = node("div", "ws-checks");
    var lib = WS();
    ["buildCustom", "improve", "expand", "review", "rewrite", "simplify", "detailed", "structure", "variations", "missing", "copypaste", "clean"].forEach(function (key) {
      var spec = lib ? lib.actionSpec(key) : { label: key.toUpperCase() };
      var row = node("label", "ws-toggle");
      var box = node("input");
      box.type = "checkbox";
      box.checked = draft.actions.indexOf(key) !== -1;
      box.addEventListener("change", function () {
        if (box.checked) {
          if (draft.actions.indexOf(key) === -1) draft.actions.push(key);
        } else {
          draft.actions = draft.actions.filter(function (k) {
            return k !== key;
          });
        }
      });
      row.appendChild(box);
      var text = node("span", "ws-toggle-text");
      text.appendChild(node("span", "ws-toggle-label", spec.label));
      row.appendChild(text);
      actionWrap.appendChild(row);
    });
    body.appendChild(actionWrap);
    function save() {
      var label = String(draft.label || "").trim();
      if (!label) {
        toast("Give the mode a name first", { type: "warn" });
        return false;
      }
      var seenFieldKey = {};
      var parsed = String(fieldsArea.value || "")
        .split("\n")
        .map(function (line, index) {
          var parts = line.split("|");
          var name = String(parts[0] || "").trim();
          var hint = String(parts.slice(1).join("|") || "").trim();
          if (!name) return null;
          var slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 26) || "field";
          return { key: "f_" + slug + "_" + index, label: name.toUpperCase().slice(0, 40), hint: hint.slice(0, 160) };
        })
        .filter(Boolean);
      var fields = parsed.map(function (field, index) {
        var key = field.key;
        if (seenFieldKey[key]) key = key + "_" + index;
        seenFieldKey[key] = true;
        field.key = key;
        return field;
      });
      var system = String(draft.system || "").trim();
      var output = String(draft.output || "").trim();
      var combined = system;
      if (output) combined += (combined ? "\n\n" : "") + "DEFAULT OUTPUT STRUCTURE:\n" + output;
      var store = wsSettings();
      store.customModes = store.customModes || [];
      var entry = {
        key: draft.key,
        label: label.toUpperCase().slice(0, 40),
        hint: String(draft.hint || "").slice(0, 200),
        system: combined,
        output: output,
        fields: fields,
        actions: draft.actions.length ? draft.actions : ["buildCustom", "improve", "review"],
        toggles: []
      };
      var found = false;
      store.customModes = store.customModes.map(function (existing) {
        if (existing.key === entry.key) {
          found = true;
          return entry;
        }
        return existing;
      });
      if (!found) store.customModes.push(entry);
      if (!store.fields[entry.key]) store.fields[entry.key] = {};
      if (!store.toggles[entry.key]) store.toggles[entry.key] = {};
      wsPersistNow();
      toast("Saved custom mode " + entry.label, { type: "ok" });
      wsSetMode(entry.key);
      wsCustomModesModal();
      return true;
    }
    modal({
      title: isNew ? "Create a custom mode" : "Edit custom mode",
      body: [body],
      wide: true,
      bodyClass: "ws-editor-body",
      focus: body.querySelector("input"),
      buttons: [
        { label: "SAVE MODE", kind: "primary", onClick: save },
        { label: "Cancel", kind: "ghost" }
      ]
    });
  }

  // ---------------------------------------------------------------- assembler

  function wsAssemblerModal() {
    var ws = state.ws;
    if (!Array.isArray(ws.blocks)) ws.blocks = [];
    var body = node("div", "ws-asm");
    var list = node("div", "ws-asm-list");
    var preview = node("textarea", "input textarea-mono ws-asm-preview");
    preview.readOnly = true;
    var lib = WS();
    function types() {
      return (cfg.workshopBlocks || []).slice();
    }
    function paint() {
      list.innerHTML = "";
      if (!ws.blocks.length) {
        list.appendChild(
          para("No blocks yet. Add one below, or press SPLIT FROM PROMPT to turn the prompt on the left into labelled blocks.", "hint")
        );
      }
      ws.blocks.forEach(function (block, index) {
        var card = node("div", "ws-asm-block");
        var top = node("div", "ws-asm-top");
        var select = node("select", "input ws-tiny");
        types().forEach(function (type) {
          var option = document.createElement("option");
          option.value = type;
          option.textContent = type;
          select.appendChild(option);
        });
        select.value = block.type || "CUSTOM";
        select.addEventListener("change", function () {
          block.type = select.value;
          if (block.type !== "CUSTOM") block.label = block.type;
          paint();
        });
        top.appendChild(select);
        if (block.type === "CUSTOM") {
          var labelInput = node("input", "input ws-tiny ws-asm-label");
          labelInput.type = "text";
          labelInput.value = block.label || "";
          labelInput.placeholder = "BLOCK NAME";
          labelInput.addEventListener("input", function () {
            block.label = labelInput.value;
            updatePreview();
          });
          top.appendChild(labelInput);
        }
        top.appendChild(node("span", "spacer"));
        var up = node("button", "btn tiny", "\u2191");
        up.title = "Move up";
        up.disabled = index === 0;
        up.addEventListener("click", function () {
          ws.blocks.splice(index - 1, 0, ws.blocks.splice(index, 1)[0]);
          paint();
        });
        var down = node("button", "btn tiny", "\u2193");
        down.title = "Move down";
        down.disabled = index === ws.blocks.length - 1;
        down.addEventListener("click", function () {
          ws.blocks.splice(index + 1, 0, ws.blocks.splice(index, 1)[0]);
          paint();
        });
        var remove = node("button", "btn tiny danger", "Remove");
        remove.addEventListener("click", function () {
          ws.blocks.splice(index, 1);
          paint();
        });
        top.appendChild(up);
        top.appendChild(down);
        top.appendChild(remove);
        card.appendChild(top);
        var area = node("textarea", "input ws-field-area");
        area.rows = 3;
        area.spellcheck = false;
        area.value = block.text || "";
        area.placeholder = "What goes in this block?";
        area.addEventListener("input", function () {
          block.text = area.value;
          updatePreview();
        });
        card.appendChild(area);
        list.appendChild(card);
      });
      updatePreview();
    }
    function assemble() {
      if (!lib) return "";
      return lib.assemble(ws.blocks);
    }
    function updatePreview() {
      preview.value = assemble();
      wsPersist();
    }
    function addBlock(type, text) {
      var kind = type || "OBJECTIVE";
      ws.blocks.push({ type: kind, label: kind === "CUSTOM" ? "" : kind, text: text || "" });
      paint();
    }
    var addRow = node("div", "ws-asm-add");
    var addSelect = node("select", "input ws-tiny");
    types().forEach(function (type) {
      var option = document.createElement("option");
      option.value = type;
      option.textContent = type;
      addSelect.appendChild(option);
    });
    addRow.appendChild(addSelect);
    var addButton = node("button", "btn sm primary", "+ ADD BLOCK");
    addButton.addEventListener("click", function () {
      addBlock(addSelect.value, "");
    });
    addRow.appendChild(addButton);
    var splitButton = node("button", "btn sm", "SPLIT FROM PROMPT");
    splitButton.addEventListener("click", function () {
      var parsed = lib ? lib.blocksFromText(ws.text || "") : [];
      if (!parsed.length) {
        toast("The prompt has nothing to split into blocks", { type: "warn" });
        return;
      }
      if (!ws.blocks.length) ws.blocks = parsed;
      else ws.blocks = ws.blocks.concat(parsed);
      paint();
      toast("Added " + parsed.length + " block(s) from the prompt", { type: "ok" });
    });
    addRow.appendChild(splitButton);
    var clearButton = node("button", "btn sm ghost", "Clear blocks");
    clearButton.addEventListener("click", function () {
      ws.blocks = [];
      paint();
    });
    addRow.appendChild(clearButton);
    body.appendChild(addRow);
    body.appendChild(list);
    body.appendChild(node("div", "ai-group-title", "ASSEMBLED PROMPT (PLAIN TEXT)"));
    body.appendChild(preview);
    body.appendChild(
      para("The assembled prompt is ordinary plain text - no private format, nothing to convert. Blocks are reordered by dragging with the arrow buttons or by cutting and pasting in the preview.", "hint")
    );
    var api = modal({
      title: "Prompt assembler",
      body: [body],
      wide: true,
      bodyClass: "ws-editor-body",
      buttons: [
        {
          label: "ASSEMBLE PROMPT",
          kind: "primary",
          onClick: function () {
            var text = assemble();
            if (!text.trim()) {
              toast("Add some block text first", { type: "warn" });
              return false;
            }
            wsAdopt(text, "assembler");
            ws.source = "build";
            toast("Assembled into the Workshop prompt", { type: "ok" });
            return true;
          }
        },
        {
          label: "COPY",
          onClick: function () {
            copyText(assemble(), "Assembled prompt");
          }
        },
        {
          label: "SAVE TO LIBRARY",
          onClick: function () {
            var text = assemble();
            if (!text.trim()) {
              toast("Add some block text first", { type: "warn" });
              return;
            }
            wsSaveTo(wsCurrentFolderId(), wsSuggestTitle(), text);
          }
        },
        { label: "Close", kind: "ghost" }
      ]
    });
    paint();
    if (!ws.blocksReady) {
      ws.blocksReady = true;
      if (!ws.blocks.length && String(ws.text || "").trim()) {
        var split = lib ? lib.blocksFromText(ws.text) : [];
        if (split.length > 1) {
          ws.blocks = split;
          paint();
        }
      }
    }
    return api;
  }

  // ---------------------------------------------------------------- events

  function wsBindWorkshop() {
    var overlay = $("wsOverlay");
    if (!overlay || overlay.dataset.bound) return;
    overlay.dataset.bound = "1";

    $("wsCloseBtn").addEventListener("click", wsClose);
    $("wsHelpBtn").addEventListener("click", wsHelpModal);

    $("wsModes").addEventListener("click", function (event) {
      var add = event.target.closest("button[data-mode-add]");
      if (add) {
        wsCustomModesModal();
        return;
      }
      var button = event.target.closest("button[data-mode]");
      if (!button) return;
      wsSetMode(button.dataset.mode);
    });

    $("wsSource").addEventListener("click", function (event) {
      var button = event.target.closest("button[data-source]");
      if (!button) return;
      wsStart(button.dataset.source);
    });

    var prompt = $("wsPrompt");
    var suggestTimer = null;
    prompt.addEventListener("input", function () {
      state.ws.text = prompt.value;
      wsPersist();
      clearTimeout(suggestTimer);
      suggestTimer = setTimeout(function () {
        wsRenderScore();
        wsRenderOriginal();
        wsMaybeSuggest();
      }, WS_SUGGEST_DELAY);
    });
    prompt.addEventListener("blur", function () {
      wsPersistNow();
    });

    $("wsActions").addEventListener("click", function (event) {
      var button = event.target.closest("button[data-ws-action]");
      if (!button) return;
      wsRun(button.dataset.wsAction);
    });

    $("wsAdvBtn").addEventListener("click", function () {
      wsSetAdvanced(!state.ws.adv);
    });

    $("wsAdvBody").addEventListener("input", function (event) {
      var el = event.target;
      if (!el || !el.dataset) return;
      if (el.dataset.wsField) {
        state.ws.fields[el.dataset.wsField] = el.value;
        wsPersist();
      } else if (el.dataset.wsFocus) {
        state.ws.focus = el.value;
        wsPersist();
      }
    });
    $("wsAdvBody").addEventListener("change", function (event) {
      var el = event.target;
      if (!el || !el.dataset) return;
      if (el.dataset.wsToggle) {
        state.ws.toggles[el.dataset.wsToggle] = !!el.checked;
        wsPersist();
      } else if (el.dataset.wsCount) {
        state.ws.count = Math.max(2, Math.min(10, parseInt(el.value, 10) || 3));
        el.value = String(state.ws.count);
        wsPersist();
      } else if (el.dataset.wsStyle) {
        state.ws.style = el.value;
        wsPersist();
      }
    });
    $("wsAdvBody").addEventListener("click", function (event) {
      var button = event.target.closest("button[data-ws-rating]");
      if (!button) return;
      state.ws.rating = button.dataset.wsRating;
      wsPersist();
      wsRenderAdvanced();
    });

    $("wsTabs").addEventListener("click", function (event) {
      var button = event.target.closest("button[data-tab]");
      if (!button) return;
      state.ws.tab = button.dataset.tab;
      wsRenderTabs();
    });

    $("wsResultActions").addEventListener("click", function (event) {
      var button = event.target.closest("button[data-ws-result]");
      if (!button) return;
      wsApply(button.dataset.wsResult);
    });

    $("wsResultText").addEventListener("input", function () {
      state.ws.result = $("wsResultText").value;
      wsUpdateProgress(state.ws.result.length + " chars");
    });

    $("wsManualCopyBtn").addEventListener("click", function () {
      copyText(state.ws.manual || "", "AI request");
    });
    $("wsManualRunBtn").addEventListener("click", function () {
      if (wsStatusReady()) wsRun(state.ws.actionKey);
      else toast("Still no AI provider connected - copy the request instead", { type: "warn" });
    });
    $("wsManualCloseBtn").addEventListener("click", function () {
      wsDiscard();
    });
    $("wsManualUseBtn").addEventListener("click", wsManualUse);

    var workspace = $("wsOpenWorkshopBtn");
    if (workspace) {
      workspace.addEventListener("click", function () {
        wsOpen({ prompt: state.current });
      });
    }
    var pasteEntry = $("wsOpenPasteBtn");
    if (pasteEntry) {
      pasteEntry.addEventListener("click", function () {
        wsOpen({ resume: false, source: "paste" });
      });
    }
    var buildEntry = $("wsOpenBuildBtn");
    if (buildEntry) {
      buildEntry.addEventListener("click", function () {
        wsOpen({ resume: false, source: "build" });
      });
    }
    var emptyEntry = $("emptyWorkshopBtn");
    if (emptyEntry) {
      emptyEntry.addEventListener("click", function () {
        wsOpen({ resume: false, source: "build" });
      });
    }
    var footButton = $("workshopBtn");
    if (footButton) {
      footButton.addEventListener("click", function () {
        if (!state.current) {
          toast("Open a prompt first", { type: "warn" });
          return;
        }
        wsOpen({ prompt: state.current });
      });
    }

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      if (!state.ws.open) return;
      if (modalStack.length) return;
      event.preventDefault();
      wsClose();
    });
  }

  function wsStart(kind) {
    var ws = state.ws;
    ws.source = kind;
    if (kind === "build") {
      wsSetAdvanced(true);
      var lib = WS();
      var fields = lib ? lib.fieldsFor(ws.mode) : [];
      var target = fields.length ? document.querySelector("#wsAdvBody [data-ws-field]") : $("wsPrompt");
      if (target) {
        try {
          target.focus();
        } catch (err) {}
      }
      toast("Fill in whatever you know - every field is optional", { type: "ok", timeout: 4000 });
    } else {
      var area = $("wsPrompt");
      if (area) area.focus();
      toast("Paste or write the prompt you want to work on", { type: "ok", timeout: 4000 });
    }
    wsRenderSource();
    if (kind === "build") wsRenderActions();
  }

  function wsHelpModal() {
    var body = node("div", "ws-help");
    [
      ["1. Pick a mode", "The mode changes how the AI works on your prompt: general, coding, debugging, image, creative, agent, writing or your own custom mode."],
      ["2. Bring a prompt", "PASTE EXISTING PROMPT to work on something you already have, or BUILD NEW PROMPT to construct one. Optional fields under ADVANCED OPTIONS make the result much stronger - none of them are required."],
      ["3. Use an action", "Each action builds a complete, carefully worded request. Nothing touches your prompt until you press REPLACE ORIGINAL, and UNDO stays available for the session."],
      ["4. Nothing is automatic", "The workshop never chains actions on its own. Use CONTINUE FROM RESULT to feed a result into the next step when you decide to."],
      ["5. No AI connected?", "Every action still works: the workshop writes the request locally and you paste it into any AI tool, then paste the answer back."],
      ["6. Everything is local", "Templates, custom modes, checklist results and your draft live in this browser only. No account, no analytics, no server."]
    ].forEach(function (entry) {
      var block = node("div", "ws-analysis-block");
      block.appendChild(node("div", "ws-analysis-title", entry[0]));
      block.appendChild(node("p", null, entry[1]));
      body.appendChild(block);
    });
    modal({
      title: "How the Prompt Workshop works",
      body: [body],
      wide: true,
      bodyClass: "ws-editor-body",
      buttons: [{ label: "Close", kind: "ghost" }]
    });
  }

  function wsInit() {
    var saved = wsSettings();
    state.ws.count = saved.count || 3;
    state.ws.style = saved.style || "balanced";
    state.ws.mode = saved.mode || "general";
    state.ws.fields = wsGrab("fields", state.ws.mode);
    state.ws.toggles = wsGrab("toggles", state.ws.mode);
    var lib = WS();
    if (lib && !Object.keys(state.ws.toggles).length) {
      var defaults = lib.defaultToggles(state.ws.mode);
      Object.keys(defaults).forEach(function (key) {
        state.ws.toggles[key] = defaults[key];
      });
    }
    wsBindWorkshop();
    window.addEventListener("resize", function () {
      var ov = $("wsOverlay");
      if (ov && !ov.hidden) wsRenderTabs();
    });
  }

  var deferredInstall = null;
  var dragPayload = null;

  async function init() {
    await Store.init();
    if (Store.getMode() === "memory") setStatus("error", "In memory only");
    var rawLibrary = null;
    var rawSettings = null;
    try {
      rawLibrary = await Store.get(cfg.storageKeyLibrary);
      rawSettings = await Store.get(cfg.storageKeySettings);
    } catch (err) {
      console.warn("Could not read saved data:", err);
    }
    state.settings = mergeSettings(rawSettings);
    state.ui.sort = state.settings.sort || "recent";
    state.ui.filter = "all";
    state.ui.aiOpen = window.innerWidth <= 860 ? false : state.settings.aiOpen !== false;
    var usable = rawLibrary && Array.isArray(rawLibrary.folders) && Array.isArray(rawLibrary.prompts);
    if (usable && (rawLibrary.folders.length || rawLibrary.prompts.length)) {
      state.library = normalizeLibrary(rawLibrary);
      var dropped = state.library.meta && state.library.meta.dropped;
      if (dropped) {
        toast("Repaired saved data - " + dropped + " unreadable entr" + (dropped === 1 ? "y was" : "ies were") + " skipped.", { type: "warn", timeout: 9000 });
        state.dirty = true;
        await flushSave();
      }
    } else if (rawLibrary && !usable) {
      try {
        await Store.set(cfg.storageKeyLibrary + "-recovery", rawLibrary);
      } catch (err) {}
      seedLibrary();
      state.dirty = true;
      await flushSave();
      toast("Your saved library could not be read, so a fresh one was started. A copy of the unreadable data was kept under the '" + cfg.storageKeyLibrary + "-recovery' key.", { type: "err", timeout: 12000 });
    } else {
      seedLibrary();
      state.dirty = true;
      await flushSave();
    }
    if (state.settings.lastFolderId && (state.settings.lastFolderId === cfg.allFolderId || folderById(state.settings.lastFolderId))) {
      state.ui.selectedFolderId = state.settings.lastFolderId;
    }
    applyTheme();
    buildAIActions();
    wsInit();
    bindEvents();
    renderChips();
    renderSortSelect();
    if (state.settings.lastPromptId) {
      var last = promptById(state.settings.lastPromptId);
      if (last) state.current = last;
    }
    renderAll();
    applyAIPanelState();
    renderAIStatus();
    handleSharedHash();
    setupPwa();
    document.body.setAttribute("data-pp-ready", "1");
  }

  window.PP = {
    state: state,
    config: cfg,
    ai: AI,
    zip: Zip,
    store: Store,
    newPrompt: newPrompt,
    openPrompt: openPrompt,
    saveNow: saveNow,
    flushSave: flushSave,
    commitDraft: commitDraft,
    createFolder: addFolder,
    deleteFolder: deleteFolder,
    moveFolder: moveFolder,
    movePrompt: movePrompt,
    renameFolder: function (folderId, name) {
      var folder = folderById(folderId);
      if (!folder) return false;
      folder.name = String(name).slice(0, 60);
      markDirty();
      renderAll();
      return true;
    },
    toggleFavourite: toggleFavourite,
    duplicatePrompt: duplicatePrompt,
    deletePrompt: deletePrompt,
    selectFolder: selectFolder,
    setFilter: function (filter) {
      state.ui.filter = filter;
      renderChips();
      renderList();
    },
    setSearch: function (query) {
      state.ui.search = String(query || "");
      var input = $("searchInput");
      if (input) input.value = state.ui.search;
      renderList();
    },
    visiblePrompts: visiblePrompts,
    importTxtFiles: importTxtFiles,
    importBackupFile: importBackupFile,
    exportBackup: exportBackup,
    exportAllZip: exportAllZip,
    exportFolderZip: exportFolderZip,
    exportAllTxt: exportAllTxt,
    exportPromptTxt: exportPromptTxt,
    buildZipFiles: zipAll,
    backupObject: backupObject,
    shareLinkFor: shareLinkFor,
    handleSharedHash: handleSharedHash,
    addSharedPrompt: addSharedPrompt,
    snapshotLibrary: snapshotLibrary,
    txtForPrompt: txtForPrompt,
    copyText: copyText,
    toast: toast,
    modal: modal,
    folderPickerDialog: folderPickerDialog,
    confirmDialog: confirmDialog,
    pathOf: pathOf,
    ensureFolderPath: ensureFolderPath,
    findFolderByPath: findFolderByPath,
    runAIAction: runAIAction,
    applyAIResult: applyAIResult,
    runOrganise: runOrganise,
    openExportModal: openExportModal,
    openSettingsModal: openSettingsModal,
    showManualMode: showManualMode,
    toggleAIPanel: toggleAIPanel,
    renderAll: renderAll,
    renderAIStatus: renderAIStatus,
    applyTheme: applyTheme,
    promptCounts: promptCounts,
    openWorkshop: wsOpen,
    closeWorkshop: wsClose,
    workshop: WS(),
    wsRun: wsRun,
    wsApply: wsApply,
    wsUndo: wsUndo,
    wsCtx: wsCtx,
    wsSetMode: wsSetMode,
    wsSaveTo: wsSaveTo,
    wsSaveMenu: wsSaveMenu,
    wsTemplates: wsTemplateList,
    wsTemplatesModal: wsTemplatesModal,
    wsUseTemplate: wsUseTemplate,
    wsCustomModeEditor: wsCustomModeEditor,
    wsAssemblerModal: wsAssemblerModal,
    wsCustomModesModal: wsCustomModesModal,
    wsActions: function () {
      return wsRenderActions();
    },
    wsScorecard: function (text) {
      var lib = WS();
      return lib ? lib.scorecard(text == null ? state.ws.text : text) : null;
    },
    wsBuild: function (actionKey, ctx) {
      var lib = WS();
      return lib ? lib.build(actionKey, ctx || wsCtx()) : null;
    },
    wsRender: wsRender
  };

  Object.defineProperty(window.PP, "settings", {
    get: function () {
      return state.settings;
    },
    configurable: true
  });

  Object.defineProperty(window.PP, "library", {
    get: function () {
      return state.library;
    },
    configurable: true
  });

  function boot(tries) {
    if (!window.PP_CONFIG || !window.PPStore || !window.PPZip || !window.PP_AI) {
      if ((tries || 0) < 250) {
        setTimeout(function () { boot((tries || 0) + 1); }, 40);
      } else {
        console.error("Prompt Packer: dependency scripts did not load (config/storage/ziplite/ai).");
      }
      return;
    }
    cfg = window.PP_CONFIG;
    Store = window.PPStore;
    Zip = window.PPZip;
    AI = window.PP_AI;
    if (!window.PP_WORKSHOP) console.warn("Prompt Packer: workshop.js did not load, so the Prompt Workshop is unavailable.");
    window.PP.config = cfg;
    window.PP.store = Store;
    window.PP.zip = Zip;
    window.PP.ai = AI;
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }

  try {
    boot();
  } catch (err) {
    console.error("Prompt Packer failed to start:", err);
  }
})();
