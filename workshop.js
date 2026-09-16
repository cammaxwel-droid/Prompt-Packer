// PROMPT WORKSHOP - the prompt-engineering engine.
//
// This module is pure: it has no DOM access and owns no UI. It turns a workshop mode
// plus a set of optional field values into (a) a full AI instruction and (b) a
// self-contained "manual mode" request package the user can paste into any external AI.
//
// Everything provider-specific stays in ai.js: `run()` is the only place here that
// touches a provider, and it always goes through PP_AI.generateWithAI().
//
// Named templates (the ones other code, and future agents, should reach for):
//   expandPrompt() reviewPrompt() missingPrompt() cleanPrompt() codingPrompt()
//   debugPrompt() imagePrompt() creativePrompt() agentPrompt() writingPrompt()
//   customPrompt() variationsPrompt() analysePrompt() sortPrompt() assemble()
//
// load order: config.js -> storage.js -> ziplite.js -> ai.js -> workshop.js -> app.js

const PP_WORKSHOP = (function () {
  function cfg() {
    return window.PP_CONFIG || {};
  }

  function settings() {
    return (window.PP && window.PP.settings) || {};
  }

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function upper(value) {
    return trim(value).toUpperCase();
  }

  // ---------------------------------------------------------------- modes

  function customModes() {
    var list = settings().workshop && Array.isArray(settings().workshop.customModes) ? settings().workshop.customModes : [];
    return list
      .filter(function (entry) {
        return entry && typeof entry === "object" && trim(entry.key) && trim(entry.label);
      })
      .map(function (entry) {
        return {
          key: trim(entry.key),
          label: upper(entry.label).slice(0, 40),
          hint: trim(entry.hint) || "Your own workflow.",
          actions: Array.isArray(entry.actions) && entry.actions.length ? entry.actions : ["buildCustom", "improve", "review", "copypaste"],
          fields: Array.isArray(entry.fields)
            ? entry.fields
                .filter(function (field) {
                  return field && trim(field.key) && trim(field.label);
                })
                .map(function (field) {
                  return { key: trim(field.key), label: upper(field.label), hint: trim(field.hint), one: !!field.one };
                })
            : [],
          toggles: [],
          custom: true,
          user: true,
          system: trim(entry.system),
          output: trim(entry.output)
        };
      });
  }

  function modeList() {
    var builtin = (cfg().workshopModes || []).slice();
    return builtin.concat(customModes());
  }

  function modeByKey(key) {
    var wanted = trim(key) || "general";
    var found = modeList().filter(function (mode) {
      return mode.key === wanted;
    })[0];
    if (found) return found;
    return (cfg().workshopModes || [])[0] || { key: "general", label: "GENERAL", actions: ["expand", "improve"], fields: [], toggles: [] };
  }

  function actionSpec(key) {
    return (cfg().workshopActions || {})[key] || { label: upper(key), group: "Actions", kind: "prompt", tip: "" };
  }

  function fieldsFor(modeKey) {
    return modeByKey(modeKey).fields || [];
  }

  function togglesFor(modeKey) {
    return modeByKey(modeKey).toggles || [];
  }

  function defaultToggles(modeKey) {
    var out = {};
    togglesFor(modeKey).forEach(function (toggle) {
      out[toggle.key] = !!toggle.default;
    });
    return out;
  }

  // ---------------------------------------------------------------- instruction assembly

  var BASE =
    "You are an expert prompt engineer and prompt editor. You work directly on the user's prompt and you reply with ONLY the text that was asked for: no explanations, no commentary, no preamble, no markdown code fences and no surrounding quotes.\n" +
    "Preservation rules: keep the user's own intent, wording, tone, register and personality. If their instructions are informal, blunt, technical, artistic, strange or highly specific, keep them exactly that way. Improve structure and clarity - never sanitise the text, never turn it into generic corporate language, never add filler phrases, and never soften or omit subject matter the user wrote deliberately (including adult subject matter, which is a normal creative brief).";

  function fieldLines(modeKey, fields) {
    var lines = [];
    fieldsFor(modeKey).forEach(function (field) {
      var value = trim(fields && fields[field.key]);
      if (value) lines.push(field.label + ": " + value);
    });
    return lines;
  }

  function currentBlock(ctx) {
    var text = trim(ctx && ctx.text);
    if (!text) return "";
    return "\n\nCURRENT PROMPT:\n<prompt>\n" + text + "\n</prompt>";
  }

  function fieldsBlock(ctx) {
    var lines = fieldLines(ctx && ctx.mode, ctx && ctx.fields);
    if (!lines.length) return "";
    return "\n\nSTRUCTURED ANSWERS FROM THE USER:\n" + lines.join("\n");
  }

  function extrasBlock(ctx) {
    var bits = [];
    if (trim(ctx && ctx.focus)) bits.push("Extra instruction from the user: " + trim(ctx.focus));
    if (ctx && ctx.rating === "nsfw") {
      bits.push(
        "The user has labelled this NSFW. It is adult material involving adults only; keep it explicit if the prompt calls for it and do not tone it down."
      );
    }
    return bits.length ? "\n\n" + bits.join("\n") : "";
  }

  function foldFields(ctx) {
    if (!fieldLines(ctx && ctx.mode, ctx && ctx.fields).length) return "";
    return " The structured answers above are part of the brief: fold anything they add into the result instead of dropping it.";
  }

  function make(ctx, task) {
    var input = currentBlock(ctx) + fieldsBlock(ctx) + extrasBlock(ctx);
    if (!input) input = "\n\nCURRENT PROMPT:\n(empty - work from the structured answers if there are any, otherwise produce a strong general-purpose version of the request)";
    return BASE + input + "\n\nTASK: " + task;
  }

  function sharedTask(key) {
    var actions = (window.PP_AI && window.PP_AI.ACTIONS) || {};
    return actions[key] && actions[key].task ? actions[key].task : "";
  }

  // ---- generic text actions

  function expandPrompt(ctx) {
    return make(
      ctx,
      "Expand the prompt above so it is substantially more complete and capable of producing stronger results. Keep the original intent intact, add the specifics a model would need, and do not drop anything important." +
        foldFields(ctx)
    );
  }

  function reviewPrompt(ctx) {
    return make(
      ctx,
      "Review the prompt above as a demanding prompt engineer. Start with a one-sentence verdict, then list the specific weaknesses and ambiguities, then give a numbered list of concrete improvements with example wording where useful. Do NOT rewrite the prompt and do NOT output a changed version of it." +
        foldFields(ctx)
    );
  }

  function missingPrompt(ctx) {
    return make(
      ctx,
      "Report only the information a model would still need in order to do exactly what this prompt asks. Answer under three headings: MISSING (absent entirely), AMBIGUOUS (could be read two ways), ASSUMED (would have to be guessed). Start with one line saying whether the prompt is ready to use as it stands. Be concrete and quote the part of the prompt each point refers to. Do NOT rewrite the prompt." +
        foldFields(ctx)
    );
  }

  function cleanPrompt(ctx) {
    return make(
      ctx,
      "Rewrite the prompt above in a clean, neutral, professional register suitable for a workplace tool. Keep every requirement, constraint and piece of information exactly as it is - add nothing and remove nothing. This is the one case where the user's informal or unconventional wording should be regularised."
    );
  }

  // ---- coding

  function codingPrompt(ctx) {
    var toggles = (ctx && ctx.toggles) || {};
    var task =
      "Write ONE finished prompt for a coding AI or a coding agent, using only the information above. Where a field is empty, work from the others and leave that concern out rather than inventing facts. " +
      "Structure the result with labelled sections, skipping any that do not apply: TASK, CONTEXT, TECH STACK, FILES, REQUIREMENTS, CONSTRAINTS, DO NOT CHANGE, TESTING, OUTPUT REQUIRED. " +
      "Be specific and ordered, and keep the user's own wording for anything they wrote themselves." +
      (toggles.preserveKnownGood
        ? " Add an explicit instruction that the agent must read the existing code first and must NOT rewrite, restructure, reformat or 'clean up' components that already work - only what the task requires may change."
        : "") +
      " Reply with ONLY the finished prompt.";
    return make(ctx, task);
  }

  // ---- debugging

  function debugPrompt(ctx) {
    var toggles = (ctx && ctx.toggles) || {};
    var rules = [];
    if (toggles.inspectFirst !== false) rules.push("inspect the relevant code and report what it actually does BEFORE changing anything");
    rules.push("identify and state the root cause rather than patching the symptom");
    if (toggles.preserveKnownGood !== false) rules.push("preserve every behaviour that already works and change nothing outside the faulty area");
    if (toggles.noRepeatTried !== false) rules.push("treat the already-tried list as failed approaches and do not repeat them");
    if (toggles.smallestRepair !== false) rules.push("make the smallest reliable repair that fixes the cause");
    rules.push("verify the repair with a test or a concrete manual check");
    rules.push("finish by reporting what caused the failure and why the repair is correct");
    var task =
      "Write ONE finished prompt that instructs a coding AI to diagnose a problem instead of rewriting code. " +
      "Use labelled sections, skipping any that do not apply: PROBLEM, EXPECTED BEHAVIOUR, ACTUAL BEHAVIOUR, ERROR OUTPUT, RECENT CHANGES, FILES / COMPONENTS INVOLVED, ALREADY TRIED, REQUIRED APPROACH. " +
      "Keep the exact error text in a block of its own so it is unambiguous. " +
      "Under REQUIRED APPROACH write these as explicit numbered instructions: " +
      rules.join("; ") +
      ". Also require the agent to say clearly if the information given is not enough to find the cause. Reply with ONLY the finished prompt.";
    return make(ctx, task);
  }

  // ---- image

  function imagePrompt(ctx) {
    var toggles = (ctx && ctx.toggles) || {};
    var task =
      "Write ONE finished text-to-image generation prompt from the information above. " +
      "Front-load the subject, then action or pose, environment, composition and camera, lens, lighting, colour and palette, style or medium, mood, material and texture, and any specific details, using compact comma-separated clauses in the order image models expect. " +
      "Use only terms that genuinely shape this image - no padding with quality buzzwords that do not apply. " +
      "Put everything that must be excluded into a final 'Negative:' clause" +
      (toggles.noText ? ", including text, lettering, logos and watermarks unless the user asked for them" : "") +
      ". Include the aspect ratio if one was given. " +
      "Keep the subject, and any adult subject matter, exactly as the user described it - it is a normal creative brief and must not be softened, censored or omitted. " +
      "Reply with ONLY the finished prompt.";
    return make(ctx, task);
  }

  function visualPrompt(ctx, focus) {
    return make(
      ctx,
      "Rewrite the prompt above as a stronger text-to-image prompt, working ONLY on " +
        focus +
        ". Keep every other element, the subject and the overall intent exactly as they are, and keep the compact comma-separated clause style typical of image prompts. Output the complete prompt, not just the changed part." +
        foldFields(ctx)
    );
  }

  // ---- creative

  function creativePrompt(ctx) {
    return make(
      ctx,
      "Write ONE finished creative brief from the information above. Use labelled sections, skipping any that are empty: IDEA, GOAL, STYLE, MOOD, THEMES, INFLUENCES, RULES, EXPERIMENTAL ELEMENTS, THINGS TO AVOID. " +
        "The brief must be generative: give a model enough concrete direction to produce something specific and surprising, and leave room for it to invent. Avoid generic description and avoid explaining the idea back to the user. " +
        "Reply with ONLY the finished brief."
    );
  }

  // ---- agent

  var AGENT_RULES = [
    ["planBeforeAction", "State a short plan before taking any action, and revise it when it turns out to be wrong."],
    ["preserveExistingWork", "Preserve all existing work; never discard, overwrite or revert completed work unless told to."],
    ["inspectBeforeModifying", "Inspect and understand the current state of anything before modifying it."],
    ["noRepeatFailed", "Keep track of what has already been attempted and failed, and never retry a failed action unchanged."],
    ["continueUntilComplete", "Continue working until the objective is met; do not stop early to ask whether to continue."],
    ["reportBlockers", "When blocked, say plainly what is blocking progress, what has been tried and what is needed."],
    ["askWhenBlocked", "Ask the user only when genuinely blocked; otherwise decide, act and state the assumption."]
  ];

  function agentPrompt(ctx) {
    var toggles = (ctx && ctx.toggles) || {};
    var rules = [];
    AGENT_RULES.forEach(function (pair) {
      if (toggles[pair[0]]) rules.push("- " + pair[1]);
    });
    var task =
      "Write ONE finished prompt for the agent described above. Use these exact section headings, skipping any that are empty: IDENTITY, OBJECTIVE, CONTEXT, TOOLS, RULES, WORKFLOW, SUCCESS CONDITIONS. " +
      "IDENTITY covers its name and role; OBJECTIVE must be a single measurable outcome; WORKFLOW must be ordered steps that end in a verifiable check; SUCCESS CONDITIONS must say how completion is judged and what to do on failure. " +
      "Under RULES, write each behavioural rule below as its own explicit, testable instruction." +
      (rules.length ? "\nBehavioural rules to include:\n" + rules.join("\n") : "") +
      " Keep the whole thing operational - no persona decoration that does not change behaviour. Reply with ONLY the finished prompt.";
    return make(ctx, task);
  }

  // ---- writing

  function writingPrompt(ctx) {
    return make(
      ctx,
      "Write ONE finished writing brief from the information above. Use labelled sections, skipping any that are empty: PURPOSE, AUDIENCE, TONE, FORMAT, LENGTH, VOICE, KEY INFORMATION, MUST INCLUDE, MUST AVOID. " +
        "Be concrete about register, structure and length, and state any fact or beat that has to appear. " +
        "Preserve the user's own voice preferences and any unconventional choices they made. Reply with ONLY the finished brief."
    );
  }

  // ---- custom (user-defined modes)

  function customPrompt(ctx) {
    var mode = modeByKey(ctx && ctx.mode);
    var lines = [BASE];
    var current = currentBlock(ctx);
    if (current) lines.push(current);
    lines.push("\n\nCUSTOM MODE DEFINITION:");
    lines.push("Mode name: " + (mode.label || "CUSTOM"));
    if (mode.system) lines.push("System instruction: " + mode.system);
    var answers = fieldLines(mode.key, ctx && ctx.fields);
    if (answers.length) lines.push("Field answers:\n" + answers.join("\n"));
    if (mode.output) lines.push("Required output structure:\n" + mode.output);
    var extras = extrasBlock(ctx);
    if (extras) lines.push(extras);
    lines.push(
      "\n\nTASK: Assemble ONE finished prompt from the field answers above, following the system instruction and the required output structure exactly. Skip fields that were left empty. If the mode definition has no field answers at all, write the strongest version of the request you can from whatever is present. Reply with ONLY the finished prompt."
    );
    return lines.join("");
  }

  // ---- variations

  var VARIATION_STYLES = {
    conservative: "Keep close to the original intent and structure; make safe, reliable improvements.",
    balanced: "Keep the same goal but vary structure, emphasis and framing meaningfully.",
    experimental: "Take real risks: different structures, different assumptions, unusual angles - as long as the goal is still met."
  };

  function variationsPrompt(ctx) {
    var count = Math.max(2, Math.min(10, parseInt(ctx && ctx.count, 10) || 3));
    var style = trim(ctx && ctx.style) || "balanced";
    var styleLine = VARIATION_STYLES[style] || VARIATION_STYLES.balanced;
    return make(
      ctx,
      "Produce " +
        count +
        " genuinely different variations of the prompt above. Each must aim at the same goal but approach it from a distinct angle; do not merely swap adjectives or reorder the same sentences, and do not make near-copies of each other. " +
        "Variation style: " +
        upper(style) +
        " - " +
        styleLine +
        " Each variation must be a complete, standalone prompt. " +
        'Reply with ONLY a JSON object in this exact shape: {"variations":[{"approach":"two or three words naming the angle","prompt":"the full prompt text"}]} containing exactly ' +
        count +
        " objects." +
        foldFields(ctx)
    );
  }

  // ---- analysis

  function analysePrompt(ctx) {
    return make(
      ctx,
      'Analyse the prompt above. Reply with ONLY a JSON object in this exact shape: {"purpose":"one sentence","type":"coding|image|creative|agent|writing|debugging|general","clear":["..."],"ambiguous":["..."],"missing":["..."],"contradictions":["..."],"repeated":["..."],"constraints":["..."],"structure":["..."]}. ' +
        "Rules: each array holds between 0 and 5 SHORT plain-text points, most important first, and must be [] when there is genuinely nothing to say. \"structure\" holds concrete structural improvements described in words - do NOT rewrite the prompt and do NOT output the prompt itself. Never invent problems that are not there; say plainly when the prompt is already in good shape."
    );
  }

  // ---- library sort (delegates to the existing provider-agnostic organiser)

  function sortPrompt(items, library) {
    if (window.PP_AI && typeof window.PP_AI.buildOrganiseInstruction === "function") {
      return window.PP_AI.buildOrganiseInstruction(items, library);
    }
    return "";
  }

  // ---------------------------------------------------------------- scorecard

  var SCORECARD_RULES = [
    {
      key: "goal",
      label: "Goal defined",
      test: function (text) {
        return (
          /(^|\n)\s*(task|objective|goal|aim|mission)\s*[:\-]/i.test(text) ||
          /\b(write|create|build|generate|make|fix|debug|refactor|design|draft|explain|analyse|analyze|summari[sz]e|translate|implement|review|plan|compose|produce|improve|convert|rewrite|draw|render)\b/i.test(
            text.slice(0, 160)
          )
        );
      },
      ok: "The opening lines say what to do.",
      bad: "No clear instruction verb or TASK/GOAL section near the start."
    },
    {
      key: "context",
      label: "Context supplied",
      test: function (text) {
        return (
          /(^|\n)\s*(context|background|scenario|project|setting|situation)\s*[:\-]/i.test(text) ||
          /\b(you are|i am|we are|our team|this (project|app|site|story|world|image|repo)|existing|currently|for a)\b/i.test(text)
        );
      },
      ok: "Some background is present.",
      bad: "Nothing says where this fits or who it is for."
    },
    {
      key: "constraints",
      label: "Constraints supplied",
      test: function (text) {
        return /\b(constraint|requirement|must|shall|has to|only|at most|at least|no more than|within \d|limit|exactly)\b/i.test(text);
      },
      ok: "Limits or hard requirements are stated.",
      bad: "No rules, limits or must-do requirements were stated."
    },
    {
      key: "output",
      label: "Output format defined",
      test: function (text) {
        return (
          /\b(output|reply with|respond with|answer with|return (only|a|the|as)|format|json|markdown|bullet|numbered list|table)\b/i.test(text) ||
          /\b\d+\s*(words|characters|paragraphs|sentences|lines|bullets)\b/i.test(text)
        );
      },
      ok: "The expected shape of the answer is described.",
      bad: "The desired shape of the answer is not described."
    },
    {
      key: "exclusions",
      label: "Important exclusions defined",
      test: function (text) {
        return /\b(do not|don't|never|avoid|exclude|omit|without|instead of)\b/i.test(text);
      },
      ok: "Something is explicitly excluded.",
      bad: "Nothing says what to leave out or avoid."
    },
    {
      key: "ambiguity",
      inverse: true,
      label: "Ambiguities detected",
      test: function (text) {
        if (trim(text).length < 80) return true;
        var vague = text.match(/\b(something|stuff|things?|etc\.?|some [a-z]+|various|several|nice|good|better|appropriate|as needed|reasonable|professional|modern|clean)\b/gi) || [];
        return vague.length >= 2;
      },
      ok: "Vague wording was found - it could be read more than one way.",
      bad: "No vague filler spotted - still worth a second read."
    }
  ];

  function scorecard(text) {
    var value = trim(text);
    var items = SCORECARD_RULES.map(function (rule) {
      var hit = false;
      try {
        hit = !!rule.test(value);
      } catch (err) {
        hit = false;
      }
      if (rule.inverse) return { key: rule.key, label: rule.label, state: hit ? "warn" : "ok", detail: hit ? rule.ok : rule.bad };
      return { key: rule.key, label: rule.label, state: hit ? "ok" : "missing", detail: hit ? rule.ok : rule.bad };
    });
    var sections = value.match(/(^|\n)\s*[A-Z][A-Z0-9 /&_-]{2,}:/g) || [];
    return {
      items: items,
      words: value ? value.split(/\s+/).length : 0,
      chars: value.length,
      sections: sections.length,
      ready: items.filter(function (item) {
        return item.state === "ok";
      }).length,
      total: items.length
    };
  }

  // ---------------------------------------------------------------- mode detection

  var MODE_HINTS = {
    debugging: [
      "\\b(error|stack ?trace|exception|crash|traceback|segfault|does not work|doesn't work|not working|broken|failing|fails|bug|fix|repair|why does)\\b",
      "(^|\\n)\\s*(what should happen|what actually happens|steps to reproduce)"
    ],
    coding: [
      "\\b(function|class|component|api|endpoint|refactor|repository|repo|git|npm|pip|python|javascript|typescript|react|vue|node|sql|database|schema|compile|linter|unit test|pull request)\\b",
      "(^|\\n)\\s*(tech stack|files involved|do not change|testing requirements)"
    ],
    agent: [
      "\\b(agent|autonomous|workflow|available tools|success criteria|failure handling|permissions|restrictions|memory|multi-?step)\\b",
      "\\byou are an? (ai|autonomous|agent|assistant)\\b"
    ],
    image: [
      "\\b(photo|photograph|portrait|cinematic|depth of field|bokeh|wide shot|close-?up|lens|lighting|rim light|render|illustration|anime|watercolour|watercolor|8k|octane|unreal|midjourney|dall-?e|stable diffusion|aspect ratio|negative prompt)\\b"
    ],
    writing: [
      "\\b(essay|article|blog|newsletter|screenplay|dialogue|headline|tone|audience|voice|paragraphs?|words|chapter|editorial)\\b"
    ],
    creative: [
      "\\b(story|character|worldbuilding|concept|music|song|lyrics|game design|brainstorm|scene|poem|premise|aesthetic|mood board)\\b"
    ]
  };

  var DETECT_ORDER = ["debugging", "coding", "agent", "image", "writing", "creative"];

  function detectMode(text) {
    var value = trim(text);
    if (value.length < 12) return null;
    var best = null;
    var bestScore = 0;
    DETECT_ORDER.forEach(function (mode) {
      var score = 0;
      MODE_HINTS[mode].forEach(function (pattern) {
        var found = value.match(new RegExp(pattern, "gi"));
        if (found) score += found.length;
      });
      if (score >= 2 && score > bestScore) {
        best = mode;
        bestScore = score;
      }
    });
    return best;
  }

  // ---------------------------------------------------------------- assembler

  function assemble(blocks) {
    var parts = [];
    (blocks || []).forEach(function (block) {
      if (!block) return;
      var body = trim(block.text);
      if (!body) return;
      parts.push(upper(block.label || block.type || "SECTION") + ":\n" + body);
    });
    return parts.join("\n\n");
  }

  function blocksFromText(text) {
    var value = trim(text);
    if (!value) return [];
    var known = (cfg().workshopBlocks || []).filter(function (type) {
      return type !== "CUSTOM";
    });
    var blocks = [];
    var current = null;
    value.split("\n").forEach(function (line) {
      var match = line.match(/^\s*([A-Za-z][A-Za-z0-9 /&_-]{1,30}):\s*(.*)$/);
      var type = match
        ? known.filter(function (t) {
            return t.toLowerCase() === match[1].trim().toLowerCase();
          })[0]
        : null;
      if (type) {
        if (current) blocks.push(current);
        current = { type: type, label: type, text: match[2] || "" };
        return;
      }
      if (!current) {
        current = { type: "CUSTOM", label: "OBJECTIVE", text: line };
        return;
      }
      current.text += (current.text ? "\n" : "") + line;
    });
    if (current) blocks.push(current);
    return blocks.map(function (block) {
      return { type: block.type, label: block.label, text: trim(block.text) };
    });
  }

  // ---------------------------------------------------------------- result parsing

  function parseAnalysis(text) {
    var parsed = window.PP_AI && typeof window.PP_AI.parseLooseJson === "function" ? window.PP_AI.parseLooseJson(text) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    function list(key) {
      var value = parsed[key];
      if (!Array.isArray(value)) return [];
      return value
        .map(function (entry) {
          if (typeof entry === "string") return trim(entry);
          if (entry && typeof entry === "object") return trim(entry.text || entry.point || entry.note || "");
          return "";
        })
        .filter(Boolean);
    }
    var out = {
      purpose: trim(parsed.purpose || parsed.summary || ""),
      type: trim(parsed.type || parsed.promptType || ""),
      clear: list("clear"),
      ambiguous: list("ambiguous"),
      missing: list("missing"),
      contradictions: list("contradictions"),
      repeated: list("repeated"),
      constraints: list("constraints"),
      structure: list("structure")
    };
    var any = out.purpose || out.clear.length || out.ambiguous.length || out.missing.length || out.contradictions.length || out.repeated.length || out.constraints.length || out.structure.length;
    return any ? out : null;
  }

  function parseVariations(text) {
    var parsed = window.PP_AI && typeof window.PP_AI.parseLooseJson === "function" ? window.PP_AI.parseLooseJson(text) : null;
    var out = [];
    function push(entry) {
      if (typeof entry === "string" && trim(entry)) {
        out.push({ approach: "", text: trim(entry) });
        return;
      }
      if (!entry || typeof entry !== "object") return;
      var body = trim(entry.prompt || entry.text || entry.variation || entry.content || entry.value || "");
      if (!body) return;
      out.push({ approach: trim(entry.approach || entry.label || entry.name || entry.angle || ""), text: body });
    }
    var container = parsed;
    if (container && !Array.isArray(container)) container = container.variations || container.results || container.items || container.prompts || null;
    if (Array.isArray(container)) container.forEach(push);
    if (out.length >= 2) return out;
    var numbered = String(text || "")
      .split(/\n(?=\s*\d+[\.\)]\s)/)
      .map(function (part) {
        return part.replace(/^\s*\d+[\.\)]\s*/, "").trim();
      })
      .filter(Boolean);
    return numbered.length >= 2
      ? numbered.map(function (part) {
          return { approach: "", text: part };
        })
      : [];
  }

  // ---------------------------------------------------------------- dispatch

  function build(actionKey, ctx) {
    var key = trim(actionKey) || "expand";
    var context = ctx || {};
    var spec = actionSpec(key);
    if (!context.mode) context.mode = "general";
    var mode = modeByKey(context.mode);
    var text;
    switch (key) {
      case "expand":
        text = expandPrompt(context);
        break;
      case "review":
        text = reviewPrompt(context);
        break;
      case "missing":
        text = missingPrompt(context);
        break;
      case "clean":
        text = cleanPrompt(context);
        break;
      case "variations":
      case "directions":
        text = variationsPrompt(context);
        break;
      case "buildTask":
        text = codingPrompt(context);
        break;
      case "buildDebug":
        text = debugPrompt(context);
        break;
      case "buildImage":
        text = imagePrompt(context);
        break;
      case "buildCreative":
        text = creativePrompt(context);
        break;
      case "buildAgent":
        text = agentPrompt(context);
        break;
      case "buildWriting":
        text = writingPrompt(context);
        break;
      case "buildCustom":
        text = customPrompt(context);
        break;
      case "production":
        text = make(
          context,
          "Turn the idea above into a production-ready brief: say exactly what is being made, the deliverable and its format, length or duration, the constraints, the references or influences to work from, and the acceptance criteria that decide whether it is finished. Everything must be concrete enough for a person or a model to start working from it immediately. Reply with ONLY the brief."
        );
        break;
      case "expandIdea":
        text = make(
          context,
          "Expand the idea above without losing it: add concrete specifics, complications, consequences and texture that make it more real. Do not replace the idea with a different one and do not explain it back to the user. Reply with ONLY the expanded brief." +
            foldFields(context)
        );
        break;
      case "stranger":
        text = make(
          context,
          "Push the idea above somewhere genuinely more unusual while keeping its core. Change at least one structural assumption rather than just adding adjectives, and stay coherent enough to be usable. Reply with ONLY the new version." +
            foldFields(context)
        );
        break;
      case "coherent":
        text = make(
          context,
          "Make the idea above more coherent: resolve anything that contradicts or does not fit, tie the elements together, and make the through-line obvious. Change as little as possible while doing so. Reply with ONLY the revised version." +
            foldFields(context)
        );
        break;
      case "detail":
        text =
          context.mode === "image"
            ? visualPrompt(context, "adding concrete, visible detail (materials, textures, small objects, wear and imperfection)")
            : make(
                context,
                "Add concrete detail to the above: specific, checkable particulars rather than generalities. Keep the original intent, structure and length roughly the same. Reply with ONLY the result." +
                  foldFields(context)
              );
        break;
      case "composition":
        text = visualPrompt(context, "composition - framing, crop, camera distance, foreground and background balance, and where the eye is led");
        break;
      case "lighting":
        text = visualPrompt(context, "lighting - the key light, its direction and quality, time of day, contrast, shadows and the colour of the light");
        break;
      case "camera":
        text = visualPrompt(context, "camera language - camera body or medium, angle, height, lens focal length, depth of field and motion");
        break;
      case "atmosphere":
        text = visualPrompt(context, "atmosphere - air, weather, haze, particles, temperature and depth cues");
        break;
      case "environment":
        text = visualPrompt(context, "environment detail - the setting, its surfaces, props and background specifics");
        break;
      case "photoreal":
        text = visualPrompt(context, "photographic realism - real-world materials and skin, natural imperfection, believable optics, and removing illustration or CGI cues");
        break;
      case "stylised":
        text = visualPrompt(context, "stylisation - committing harder to one specific illustration, painterly or graphic medium");
        break;
      default:
        text = make(context, (sharedTask(key) || spec.tip || "Improve the prompt above while keeping its intent exactly as it is.") + foldFields(context));
        break;
    }
    return {
      key: key,
      mode: context.mode,
      modeLabel: mode.label || upper(context.mode),
      label: spec.label,
      tip: spec.tip || "",
      group: spec.group || "Actions",
      kind: spec.kind || "prompt",
      instruction: text,
      manual:
        "ACTION:\n" +
        (spec.label || "PROMPT WORK") +
        "  [" +
        (mode.label || upper(context.mode)) +
        " mode]\n\n" +
        text +
        "\n\nReply with ONLY the requested result."
    };
  }

  function manual(actionKey, ctx) {
    return build(actionKey, ctx).manual;
  }

  async function run(actionKey, ctx, options) {
    var opts = options || {};
    var spec = build(actionKey, ctx);
    var result = await window.PP_AI.generateWithAI(spec.instruction, {
      signal: opts.signal,
      manualPackage: spec.manual,
      onChunk: opts.onChunk
    });
    return { spec: spec, text: trim(result.text), provider: result.provider };
  }

  return {
    BASE: BASE,
    VARIATION_STYLES: VARIATION_STYLES,
    modeList: modeList,
    customModes: customModes,
    modeByKey: modeByKey,
    actionSpec: actionSpec,
    fieldsFor: fieldsFor,
    togglesFor: togglesFor,
    defaultToggles: defaultToggles,
    scorecard: scorecard,
    detectMode: detectMode,
    assemble: assemble,
    blocksFromText: blocksFromText,
    expandPrompt: expandPrompt,
    reviewPrompt: reviewPrompt,
    missingPrompt: missingPrompt,
    cleanPrompt: cleanPrompt,
    codingPrompt: codingPrompt,
    debugPrompt: debugPrompt,
    imagePrompt: imagePrompt,
    creativePrompt: creativePrompt,
    agentPrompt: agentPrompt,
    writingPrompt: writingPrompt,
    customPrompt: customPrompt,
    variationsPrompt: variationsPrompt,
    analysePrompt: analysePrompt,
    sortPrompt: sortPrompt,
    parseAnalysis: parseAnalysis,
    parseVariations: parseVariations,
    build: build,
    manual: manual,
    run: run
  };
})();

window.PP_WORKSHOP = PP_WORKSHOP;
