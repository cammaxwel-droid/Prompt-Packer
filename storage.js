const PPStore = (function () {
  const DB_NAME = "prompt-packer";
  const DB_VERSION = 1;
  const STORE = "kv";
  const PREFIX = "promptpacker:";

  let mode = "memory";
  let dbPromise = null;
  let lastError = "";
  const memory = new Map();

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (typeof indexedDB === "undefined" || !indexedDB) {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        reject(err);
        return;
      }
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function () {
        const db = req.result;
        db.onversionchange = function () {
          try {
            db.close();
          } catch (err) {}
        };
        resolve(db);
      };
      req.onerror = function () {
        reject(req.error || new Error("IndexedDB open failed"));
      };
      req.onblocked = function () {
        reject(new Error("IndexedDB blocked"));
      };
    }).catch(function (err) {
      dbPromise = null;
      throw err;
    });
    return dbPromise;
  }

  function rawRequest(method, key, value) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        let tx;
        try {
          tx = db.transaction(STORE, method === "get" ? "readonly" : "readwrite");
        } catch (err) {
          reject(err);
          return;
        }
        const store = tx.objectStore(STORE);
        let req;
        try {
          req = method === "get" ? store.get(key) : method === "set" ? store.put(value, key) : store.delete(key);
        } catch (err) {
          reject(err);
          return;
        }
        req.onsuccess = function () {
          resolve(req.result);
        };
        req.onerror = function () {
          reject(req.error || new Error("IndexedDB " + method + " failed"));
        };
        tx.onabort = function () {
          reject(tx.error || new Error("IndexedDB transaction aborted"));
        };
      });
    });
  }

  function idbRequest(method, key, value) {
    return rawRequest(method, key, value).catch(function (err) {
      // A cached connection can be stale (closed by a version change, or by a
      // previous page instance in the same document). Reopen once and retry.
      dbPromise = null;
      return rawRequest(method, key, value);
    });
  }

  function localGet(key) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? undefined : JSON.parse(raw);
    } catch (err) {
      return undefined;
    }
  }

  function localSet(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch (err) {
      lastError = "Browser storage write failed (" + (err && err.name ? err.name : "unknown") + "). This browser may be in private mode or out of space.";
      return false;
    }
  }

  function localDel(key) {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch (err) {}
  }

  async function get(key) {
    if (mode === "idb") {
      try {
        const value = await idbRequest("get", key);
        if (value !== undefined) return value;
        return localGet(key);
      } catch (err) {
        lastError = String(err && err.message ? err.message : err);
        mode = "local";
      }
    }
    if (mode === "local") return localGet(key);
    return memory.get(key);
  }

  async function set(key, value) {
    if (mode === "idb") {
      try {
        await idbRequest("set", key, value);
        return true;
      } catch (err) {
        lastError = String(err && err.message ? err.message : err);
        mode = "local";
      }
    }
    if (mode === "local") return localSet(key, value);
    memory.set(key, value);
    return true;
  }

  async function del(key) {
    if (mode === "idb") {
      try {
        await idbRequest("del", key);
      } catch (err) {
        lastError = String(err && err.message ? err.message : err);
        mode = "local";
      }
    }
    if (mode === "local") localDel(key);
    memory.delete(key);
    return true;
  }

  async function init() {
    try {
      await openDb();
      mode = "idb";
      // If a previous session fell back to localStorage, carry that data forward
      // so a later IndexedDB session does not look empty.
      try {
        const stale = [];
        for (let i = 0; i < localStorage.length; i++) {
          const rawKey = localStorage.key(i);
          if (!rawKey || rawKey.indexOf(PREFIX) !== 0) continue;
          const key = rawKey.slice(PREFIX.length);
          if (key !== "probe") stale.push(key);
        }
        for (let j = 0; j < stale.length; j++) {
          const existing = await idbRequest("get", stale[j]);
          if (existing === undefined) {
            const migrated = localGet(stale[j]);
            if (migrated !== undefined) await idbRequest("set", stale[j], migrated);
          }
        }
      } catch (err3) {}
    } catch (err) {
      lastError = String(err && err.message ? err.message : err);
      try {
        localStorage.setItem(PREFIX + "probe", "1");
        localStorage.removeItem(PREFIX + "probe");
        mode = "local";
      } catch (err2) {
        mode = "memory";
      }
    }
    return mode;
  }

  async function usage() {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        return { usage: est.usage || 0, quota: est.quota || 0 };
      }
    } catch (err) {}
    try {
      let bytes = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const rawKey = localStorage.key(i);
        if (rawKey && rawKey.indexOf(PREFIX) === 0) {
          bytes += (rawKey.length + (localStorage.getItem(rawKey) || "").length) * 2;
        }
      }
      return { usage: bytes, quota: 0 };
    } catch (err) {}
    return null;
  }

  return {
    init: init,
    get: get,
    set: set,
    del: del,
    usage: usage,
    getMode: function () {
      return mode;
    },
    getLastError: function () {
      return lastError;
    }
  };
})();

window.PPStore = PPStore;
