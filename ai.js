const PP_AI = (function () {
  const PROVIDER = { PERCHANCE: "perchance", ENDPOINT: "endpoint", MANUAL: "manual" };

  const PROVIDER_LABELS = {
    perchance: "Perchance AI (free)",
    endpoint: "Local / self-hosted endpoint",
    manual: "Manual mode (paste from any AI)"
  };

  const PREAMBLE =
    "You are an expert prompt engineer. You work directly on the user's prompt text and reply with ONLY the text requested - no explanations, no preamble, no commentary, no markdown code fences, no surrounding quotes.\n\n" +
    "<prompt>\n";
  const MIDDLE = "\n</prompt>\n\nTASK: ";

  const ACTIONS = {
    expand: {
      label: "EXPAND",
      group: "Improve",
      kind: "prompt",
      tip: "Add missing detail so the prompt does more",
      task: "Expand the prompt above so it is substantially more complete and capable of producing stronger results. Keep the original intent intact, add the specifics a model would need, and do not drop anything important."
    },
    improve: {
      label: "IMPROVE",
      group: "Improve",
      kind: "prompt",
      tip: "Tighten wording, remove ambiguity",
      task: "Improve the prompt above: remove ambiguity, tighten the wording, make constraints and requirements explicit, and maximise the chance of a strong result. Preserve the intent and any deliberate style."
    },
    rewrite: {
      label: "REWRITE",
      group: "Improve",
      kind: "prompt",
      tip: "Same goal, stronger language",
      task: "Rewrite the prompt above from scratch with the same goal, in clearer and stronger language. Keep every essential requirement and the original intent."
    },
    simplify: {
      label: "SIMPLIFY",
      group: "Improve",
      kind: "prompt",
      tip: "Shorter, clearer, no redundancy",
      task: "Simplify the prompt above so it is shorter, clearer and free of redundancy, while keeping the same intent and all essential constraints."
    },
    detailed: {
      label: "MAKE MORE DETAILED",
      group: "Improve",
      kind: "prompt",
      tip: "Add specifics and quality criteria",
      task: "Make the prompt above significantly more detailed and concrete: add specifics, examples, edge cases and quality criteria where they genuinely help. Keep the intent."
    },
    structure: {
      label: "FIX STRUCTURE",
      group: "Improve",
      kind: "prompt",
      tip: "Reorganise into labelled sections",
      task: "Reorganise the prompt above into a clearly structured form, using labelled sections where they help (for example TASK, CONTEXT, REQUIREMENTS, CONSTRAINTS, OUTPUT FORMAT). Keep all existing content and intent, plain text only."
    },
    copypaste: {
      label: "MAKE COPY-PASTE READY",
      group: "Improve",
      kind: "prompt",
      tip: "Plain text, nothing around it",
      task: "Prepare the prompt above for immediate copy-paste into an AI chat box: plain text only, no markdown code fences, no quotes around it, no commentary before or after. Fix any formatting that would break when pasted."
    },
    coding: {
      label: "CODING OPTIMISE",
      group: "Specialise",
      kind: "prompt",
      tip: "Turn it into a coding-agent task",
      task: "Rewrite the prompt above as a precise task for an expert coding AI agent. Include the goal, the tech stack and constraints, required behaviour and edge cases, deliverables, and how the result will be verified. Keep the user's intent and any technology already mentioned. Plain text only."
    },
    image: {
      label: "IMAGE PROMPT OPTIMISE",
      group: "Specialise",
      kind: "prompt",
      tip: "Shape it for text-to-image models",
      task: "Rewrite the prompt above as a strong text-to-image generation prompt. Include subject, action, setting, composition and camera, lighting, colour, style or medium, mood, and quality or detail keywords. Front-load the most important elements and use compact comma-separated clauses. Preserve the subject and intent exactly, including any adult subject matter, which is a normal creative brief."
    },
    creative: {
      label: "CREATIVE EXPAND",
      group: "Specialise",
      kind: "prompt",
      tip: "Vivid sensory detail",
      task: "Expand the prompt above with vivid, concrete creative detail - sensory specifics, imagery, voice and texture - while preserving the original idea and tone."
    },
    variations: {
      label: "GENERATE VARIATIONS",
      group: "Specialise",
      kind: "variations",
      tip: "Three different angles",
      task: "Produce 3 clearly different variations of the prompt above, each exploring a distinct angle. Number them 1) 2) 3), separate them with a blank line, and output nothing else."
    },
    review: {
      label: "REVIEW",
      group: "Critique",
      kind: "notes",
      tip: "Critique, not a rewrite",
      task: "Review the prompt above as a demanding prompt engineer. Start with a one-sentence verdict, then list the specific weaknesses and ambiguities, then give a numbered list of concrete improvements with example wording where useful. Do NOT rewrite the whole prompt."
    },
    autotag: {
      label: "AUTO TAG",
      group: "Library",
      kind: "tags",
      tip: "Suggest tags and a content label",
      task:
        "Suggest tags for the prompt above, reusing the existing tags listed below when they fit.\n" +
        "Reply with ONLY a JSON object in this exact shape: {\"tags\": [\"tag one\", \"tag two\"], \"rating\": \"sfw\" or \"nsfw\"}\n" +
        "Rules: 4 to 8 tags, each 1-3 words, lowercase, no punctuation and no # symbol. Tags should describe topic, medium, style and purpose. Set rating to \"nsfw\" only when the prompt is clearly adult material."
    },
    autotitle: {
      label: "AUTO TITLE",
      group: "Library",
      kind: "title",
      tip: "Short descriptive title",
      task:
        "Write a title for the prompt above.\n" +
        "Reply with ONLY a JSON object in this exact shape: {\"title\": \"...\"}\n" +
        "Rules: 3 to 8 words, plain text, no quotes inside, no trailing full stop, descriptive of what the prompt actually does."
    },
    autosort: {
      label: "AUTO SORT THIS PROMPT",
      group: "Library",
      kind: "sort",
      tip: "Where does this prompt belong?",
      task:
        "Decide where the prompt above belongs in the folder tree listed below.\n" +
        "Reply with ONLY a JSON object in this exact shape: {\"folderPath\": \"PARENT > CHILD\", \"title\": \"...\", \"tags\": [\"...\"], \"rating\": \"sfw\" or \"nsfw\"}\n" +
        "Rules: reuse an existing folder path whenever it fits. Only invent a new path when nothing existing fits, using at most 4 levels and the same style as the tree (upper-case top level, short names). If the prompt is adult material, place it in the adult branch of the tree (for example IMAGES > NSFW) and set rating to \"nsfw\". Keep the title unchanged unless it is empty or useless."
    },
    organise: {
      label: "AUTO ORGANISE LIBRARY",
      group: "Library",
      kind: "organise",
      tip: "Review screen, nothing moves until you accept",
      task: ""
    },
    custom: {
      label: "CUSTOM INSTRUCTION",
      group: "Custom",
      kind: "prompt",
      tip: "Write your own instruction",
      task: ""
    }
  };

  const ACTION_ORDER = [
    "expand", "improve", "rewrite", "simplify", "detailed", "structure", "copypaste",
    "coding", "image", "creative", "variations",
    "review",
    "autotag", "autotitle", "autosort", "organise",
    "custom"
  ];

  function settings() {
    const s = (window.PP && window.PP.settings && window.PP.settings.ai) || null;
    if (s) return s;
    return { provider: "auto", endpoint: "", model: "", temperature: 0.7 };
  }

  function perchanceReady() {
    try {
      return !!(window.root && typeof window.root.generateText === "function");
    } catch (err) {
      return false;
    }
  }

  function endpointReady() {
    const s = settings();
    return !!(s && typeof s.endpoint === "string" && s.endpoint.trim());
  }

  function activeProvider() {
    const pref = (settings().provider || "auto").trim();
    if (pref === PROVIDER.MANUAL) return PROVIDER.MANUAL;
    if (pref === PROVIDER.PERCHANCE) return perchanceReady() ? PROVIDER.PERCHANCE : endpointReady() ? PROVIDER.ENDPOINT : PROVIDER.MANUAL;
    if (pref === PROVIDER.ENDPOINT) return endpointReady() ? PROVIDER.ENDPOINT : PROVIDER.MANUAL;
    if (perchanceReady()) return PROVIDER.PERCHANCE;
    if (endpointReady()) return PROVIDER.ENDPOINT;
    return PROVIDER.MANUAL;
  }

  function status() {
    const provider = activeProvider();
    const online = typeof navigator === "undefined" || navigator.onLine !== false;
    const needsConnection = provider !== PROVIDER.MANUAL;
    return {
      provider: provider,
      label: PROVIDER_LABELS[provider],
      online: online,
      ready: needsConnection && online,
      note:
        provider === PROVIDER.MANUAL
          ? online
            ? "No AI provider connected - prompts are prepared for you to paste into any AI."
            : "AI requires a connection."
          : online
            ? ""
            : "No connection - AI actions fall back to the copy-and-paste request."
    };
  }

  function closePending(value) {
    let text = value && value.text !== undefined ? value.text : value;
    return String(text || "").trim();
  }

  function runPerchance(text, options) {
    return new Promise(function (resolve, reject) {
      let pending;
      try {
        pending = window.root.generateText({
          instruction: text,
          startWith: options.startWith || undefined,
          stopSequences: options.stopSequences || undefined,
          onChunk: function (data) {
            if (options.onChunk) options.onChunk(data && data.textChunk ? data.textChunk : "", data && data.fullTextSoFar ? data.fullTextSoFar : "");
          }
        });
      } catch (err) {
        reject(err);
        return;
      }
      function abortNow() {
        try {
          if (pending && typeof pending.stop === "function") pending.stop();
        } catch (err) {}
      }
      if (options.signal) {
        if (options.signal.aborted) {
          abortNow();
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        options.signal.addEventListener("abort", abortNow, { once: true });
      }
      Promise.resolve(pending).then(
        function (value) {
          resolve(closePending(value));
        },
        function (err) {
          if (options.signal && options.signal.aborted) {
            resolve("");
            return;
          }
          reject(err);
        }
      );
    });
  }

  async function runEndpoint(text, options) {
    const s = settings();
    const base = String(s.endpoint || "").trim().replace(/\/+$/, "");
    if (!base) throw new Error("No AI endpoint configured.");
    const url = /\/chat\/completions$/.test(base) ? base : base + "/chat/completions";
    const wantStream = typeof options.onChunk === "function";
    const payload = {
      model: s.model && String(s.model).trim() ? String(s.model).trim() : "llama3.1",
      messages: [{ role: "user", content: text }],
      stream: wantStream,
      temperature: typeof s.temperature === "number" ? s.temperature : 0.7
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: options.signal
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 300);
      } catch (err) {}
      throw new Error("AI endpoint returned " + res.status + ". " + detail);
    }
    const contentType = res.headers.get("content-type") || "";
    if (wantStream && res.body && contentType.indexOf("text/event-stream") !== -1) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let full = "";
      while (true) {
        const step = await reader.read();
        if (step.done) break;
        buffer += decoder.decode(step.value, { stream: true });
        let index;
        while ((index = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (!line || line.charAt(0) === ":") continue;
          const data = line.indexOf("data:") === 0 ? line.slice(5).trim() : line;
          if (data === "[DONE]") {
            try {
              reader.cancel();
            } catch (err) {}
            return full.trim();
          }
          try {
            const json = JSON.parse(data);
            const choice = json.choices && json.choices[0];
            const delta = choice && (choice.delta || choice.message);
            const chunk = delta && (delta.content || delta.reasoning_content);
            if (chunk) {
              full += chunk;
              options.onChunk(chunk, full);
            }
          } catch (err) {}
        }
      }
      return full.trim();
    }
    const json = await res.json().catch(function () {
      return null;
    });
    const choice = json && json.choices && json.choices[0];
    const out = choice && (choice.message ? choice.message.content : choice.text);
    if (typeof out === "string") {
      if (typeof options.onChunk === "function") options.onChunk(out, out);
      return out.trim();
    }
    if (json && typeof json.response === "string") {
      if (typeof options.onChunk === "function") options.onChunk(json.response, json.response);
      return json.response.trim();
    }
    throw new Error("Unexpected AI response. Expected an OpenAI-compatible /chat/completions reply.");
  }

  async function generateWithAI(instruction, options) {
    const opts = typeof options === "string" ? { extra: options } : options || {};
    let text = String(instruction || "");
    if (opts.extra) text += "\n\n" + opts.extra;
    const st = status();
    if (!st.online && st.provider !== PROVIDER.MANUAL) {
      const err = new Error("AI requires a connection.");
      err.code = "offline";
      err.instruction = text;
      err.manualPackage = opts.manualPackage || "";
      throw err;
    }
    if (st.provider === PROVIDER.PERCHANCE) return { text: await runPerchance(text, opts), provider: PROVIDER.PERCHANCE };
    if (st.provider === PROVIDER.ENDPOINT) return { text: await runEndpoint(text, opts), provider: PROVIDER.ENDPOINT };
    const err = new Error("No AI provider is connected.");
    err.code = "no-provider";
    err.instruction = text;
    err.manualPackage = opts.manualPackage || "";
    throw err;
  }

  function folderLines(library) {
    if (!library || !library.folders) return "(no folders yet)";
    const byId = {};
    library.folders.forEach(function (f) {
      byId[f.id] = f;
    });
    const lines = [];
    library.folders.forEach(function (f) {
      const parts = [];
      let node = f;
      let guard = 0;
      while (node && guard++ < 20) {
        parts.unshift(node.name);
        node = node.parentId ? byId[node.parentId] : null;
      }
      lines.push(parts.join(" > "));
    });
    return lines.sort().join("\n") || "(no folders yet)";
  }

  function topTags(library, limit) {
    const counts = {};
    (library && library.prompts ? library.prompts : []).forEach(function (p) {
      (p.tags || []).forEach(function (t) {
        const key = String(t).toLowerCase();
        counts[key] = (counts[key] || 0) + 1;
      });
    });
    return Object.keys(counts)
      .sort(function (a, b) {
        return counts[b] - counts[a] || a.localeCompare(b);
      })
      .slice(0, limit || 40);
  }

  function promptDigest(prompt, library) {
    const tags = (prompt.tags || []).join(", ");
    const snippet = String(prompt.content || "").replace(/\s+/g, " ").slice(0, 240);
    return (
      "id: " + prompt.id +
      "\n  title: " + (prompt.title || "(untitled)") +
      "\n  current folder: " + (window.PP ? window.PP.pathOf(prompt.folderId, library) : "") +
      "\n  type: " + (prompt.type || "other") + " | label: " + (prompt.rating || "none") + " | tags: " + (tags || "none") +
      "\n  text: " + snippet
    );
  }

  function buildManualPackage(actionId, ctx) {
    const action = ACTIONS[actionId] || ACTIONS.custom;
    const library = (ctx && ctx.library) || { folders: [], prompts: [] };
    const promptText = String((ctx && ctx.prompt) || "").trim();
    let task = action.task;
    if (actionId === "custom") {
      const custom = String((ctx && ctx.custom) || "").trim();
      task = custom || "(no custom instruction was typed)";
    }
    let extra = "";
    if (actionId === "autotag") {
      const tags = topTags(library, 40);
      extra = "\n\nEXISTING TAGS IN MY LIBRARY:\n" + (tags.length ? tags.join(", ") : "(none yet)");
    }
    if (actionId === "autosort") {
      extra = "\n\nMY FOLDER TREE:\n" + folderLines(library) + "\n\nEXISTING TAGS:\n" + (topTags(library, 40).join(", ") || "(none yet)");
    }
    return (
      "ACTION:\n" +
      action.label +
      "\n\nCURRENT PROMPT:\n" +
      (promptText || "(the prompt is empty)") +
      "\n\nINSTRUCTION:\n" +
      task +
      extra +
      "\n\nReply with ONLY the requested result."
    );
  }

  function buildInstruction(actionId, ctx) {
    const action = ACTIONS[actionId] || ACTIONS.custom;
    const library = ctx.library || { folders: [], prompts: [] };
    const promptText = String(ctx.prompt || "").trim();
    let task = action.task;
    if (actionId === "custom") {
      const custom = String(ctx.custom || "").trim();
      if (!custom) throw new Error("Type a custom instruction first.");
      task = custom + "\n\nApply this to the prompt above and reply with only the resulting prompt text.";
    }
    let extra = "";
    if (actionId === "autotag") {
      const tags = topTags(library, 40);
      extra = "\n\nEXISTING TAGS IN THIS LIBRARY:\n" + (tags.length ? tags.join(", ") : "(none yet)");
    }
    if (actionId === "autosort") {
      extra = "\n\nFOLDER TREE:\n" + folderLines(library) + "\n\nEXISTING TAGS:\n" + (topTags(library, 40).join(", ") || "(none yet)");
    }
    return PREAMBLE + (promptText || "(the prompt is empty)") + MIDDLE + task + extra;
  }

  function buildOrganiseInstruction(items, library) {
    const blocks = items.map(function (p) {
      return promptDigest(p, library);
    });
    return (
      "You are filing a personal prompt library. Below is the folder tree and a batch of prompts.\n\n" +
      "FOLDER TREE:\n" + folderLines(library) + "\n\n" +
      "EXISTING TAGS:\n" + (topTags(library, 40).join(", ") || "(none yet)") + "\n\n" +
      "PROMPTS:\n" + blocks.join("\n\n") + "\n\n" +
      "TASK: For every prompt above, decide the best folder. Reuse an existing folder path whenever it fits; only invent a new path when nothing fits, using at most 4 levels and the same style as the tree. " +
      "Reply with ONLY a JSON array, one object per prompt, in this exact shape:\n" +
      "[{\"id\": \"<id>\", \"folderPath\": \"PARENT > CHILD\", \"tags\": [\"...\"], \"rating\": \"sfw\" or \"nsfw\"}]\n" +
      "Include every id exactly once and nothing else. Never rename or delete prompts."
    );
  }

  function parseLooseJson(text) {
    let raw = String(text || "").trim();
    raw = raw.replace(/```(?:json)?/gi, "").trim();
    const firstBrace = raw.indexOf("{");
    const firstBracket = raw.indexOf("[");
    let start = -1;
    if (firstBrace === -1) start = firstBracket;
    else if (firstBracket === -1) start = firstBrace;
    else start = Math.min(firstBrace, firstBracket);
    if (start === -1) return null;
    const opener = raw.charAt(start);
    const closer = opener === "{" ? "}" : "]";
    const end = raw.lastIndexOf(closer);
    if (end <= start) return null;
    const slice = raw.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch (err) {
      try {
        return JSON.parse(slice.replace(/,\s*([}\]])/g, "$1").replace(/([{,]\s*)'([^']*)'(\s*[:}])/g, '$1"$2"$3'));
      } catch (err2) {
        return null;
      }
    }
  }

  return {
    PROVIDER: PROVIDER,
    ACTIONS: ACTIONS,
    ACTION_ORDER: ACTION_ORDER,
    generateWithAI: generateWithAI,
    buildInstruction: buildInstruction,
    buildManualPackage: buildManualPackage,
    buildOrganiseInstruction: buildOrganiseInstruction,
    parseLooseJson: parseLooseJson,
    status: status,
    activeProvider: activeProvider,
    perchanceReady: perchanceReady,
    endpointReady: endpointReady,
    folderLines: folderLines,
    promptDigest: promptDigest,
    settings: settings
  };
})();

window.PP_AI = PP_AI;
