const PP_CONFIG = {
  appName: "PROMPT PACKER",
  tagline: "local prompt library",
  version: "1.0",
  backupFormat: "prompt-packer-backup",
  backupVersion: 1,
  storageKeyLibrary: "library",
  storageKeySettings: "settings",
  allFolderId: "__all__",
  importedFolderName: "IMPORTED",
  unsortedFolderName: "UNSORTED",
  types: [
    { key: "coding", label: "Coding", color: "#79b8ff" },
    { key: "image", label: "Image", color: "#c792ea" },
    { key: "creative", label: "Creative", color: "#ffb86c" },
    { key: "writing", label: "Writing", color: "#7ee787" },
    { key: "agent", label: "Agent", color: "#56d4dd" },
    { key: "other", label: "Other", color: "#9aa4b2" }
  ],
  ratings: [
    { key: "", label: "None", color: "#5b6472" },
    { key: "sfw", label: "SFW", color: "#5aa9e6" },
    { key: "nsfw", label: "NSFW", color: "#e5687f" }
  ],
  filters: [
    { key: "all", label: "ALL" },
    { key: "coding", label: "CODING" },
    { key: "image", label: "IMAGE" },
    { key: "nsfw", label: "NSFW" },
    { key: "creative", label: "CREATIVE" },
    { key: "recent", label: "RECENT" },
    { key: "favourites", label: "FAVOURITES" }
  ],
  workshopBlocks: [
    "OBJECTIVE",
    "CONTEXT",
    "INPUT",
    "REQUIREMENTS",
    "CONSTRAINTS",
    "STYLE",
    "DO NOT",
    "TOOLS",
    "OUTPUT",
    "TESTING",
    "REFERENCES",
    "CUSTOM"
  ],
  workshopModes: [
    {
      key: "general",
      label: "GENERAL",
      hint: "Works with almost any prompt.",
      actions: ["expand", "improve", "review", "rewrite", "simplify", "detailed", "structure", "variations", "missing", "copypaste", "clean"],
      fields: [],
      toggles: []
    },
    {
      key: "coding",
      label: "CODING",
      hint: "Prompts to hand to a coding AI or a coding agent.",
      actions: ["buildTask", "improve", "review", "structure", "variations", "copypaste"],
      fields: [
        { key: "task", label: "TASK", hint: "What must be built, fixed or changed?" },
        { key: "context", label: "PROJECT CONTEXT", hint: "What is this project? What does it do?" },
        { key: "stack", label: "TECH STACK", hint: "Languages, frameworks, versions", one: true },
        { key: "files", label: "FILES INVOLVED", hint: "Paths, modules or components" },
        { key: "problem", label: "CURRENT PROBLEM", hint: "What is wrong, missing or failing" },
        { key: "expected", label: "EXPECTED RESULT", hint: "What correct looks like" },
        { key: "constraints", label: "CONSTRAINTS", hint: "Rules the solution must respect" },
        { key: "dontChange", label: "DO NOT CHANGE", hint: "Files, APIs, behaviour or code to leave alone" },
        { key: "testing", label: "TESTING REQUIREMENTS", hint: "How the work should be verified" },
        { key: "output", label: "OUTPUT REQUIRED", hint: "Exactly what the AI should reply with" }
      ],
      toggles: [
        { key: "preserveKnownGood", label: "PRESERVE KNOWN-GOOD CODE", hint: "Tell the agent not to rewrite components that already work." }
      ]
    },
    {
      key: "debugging",
      label: "DEBUGGING",
      hint: "Diagnose a problem instead of rewriting everything.",
      actions: ["buildDebug", "improve", "review", "structure", "copypaste"],
      fields: [
        { key: "whatShould", label: "WHAT SHOULD HAPPEN?", hint: "The expected behaviour" },
        { key: "whatActually", label: "WHAT ACTUALLY HAPPENS?", hint: "The observed behaviour" },
        { key: "errorMessage", label: "ERROR MESSAGE", hint: "The exact error text or stack trace" },
        { key: "recentChanges", label: "RECENT CHANGES", hint: "What changed just before it broke" },
        { key: "files", label: "FILES / COMPONENTS INVOLVED", hint: "Where the problem lives" },
        { key: "tried", label: "WHAT HAS ALREADY BEEN TRIED?", hint: "Including attempts that failed" }
      ],
      toggles: [
        { key: "inspectFirst", label: "INSPECT BEFORE MODIFYING", hint: "Inspect and report before changing anything.", default: true },
        { key: "preserveKnownGood", label: "PRESERVE KNOWN-GOOD CODE", hint: "Do not rewrite parts that already work.", default: true },
        { key: "noRepeatTried", label: "AVOID REPEATING FAILED ATTEMPTS", hint: "Rule out what has already been tried.", default: true },
        { key: "smallestRepair", label: "SMALLEST RELIABLE REPAIR", hint: "Prefer the smallest fix that actually works.", default: true }
      ]
    },
    {
      key: "image",
      label: "IMAGE",
      hint: "Prompts for image-generation systems.",
      actions: ["buildImage", "detail", "composition", "lighting", "camera", "atmosphere", "environment", "photoreal", "stylised", "variations"],
      fields: [
        { key: "subject", label: "SUBJECT", hint: "Who or what is in the image" },
        { key: "action", label: "ACTION / POSE", hint: "What the subject is doing" },
        { key: "environment", label: "ENVIRONMENT", hint: "Where it takes place" },
        { key: "composition", label: "COMPOSITION", hint: "Framing, crop, camera distance, balance" },
        { key: "camera", label: "CAMERA", hint: "Body, angle, movement", one: true },
        { key: "lens", label: "LENS", hint: "Focal length, depth of field", one: true },
        { key: "lighting", label: "LIGHTING", hint: "Key light, time of day, quality of light" },
        { key: "colour", label: "COLOUR / PALETTE", hint: "Dominant colours and contrast", one: true },
        { key: "style", label: "STYLE", hint: "Medium, artist or era, render style" },
        { key: "mood", label: "MOOD", hint: "Emotional tone of the image", one: true },
        { key: "material", label: "MATERIAL / TEXTURE", hint: "Surfaces, fabric, skin, finish" },
        { key: "details", label: "DETAILS", hint: "Specific things that must appear" },
        { key: "negative", label: "NEGATIVE INSTRUCTIONS", hint: "What to keep out of the image" },
        { key: "aspect", label: "ASPECT RATIO", hint: "e.g. 16:9, 3:2, 1:1", one: true },
        { key: "notes", label: "CUSTOM NOTES", hint: "Anything else" }
      ],
      toggles: [
        { key: "noText", label: "AVOID TEXT AND WATERMARKS", hint: "Add a negative instruction for text, logos and watermarks.", default: true }
      ]
    },
    {
      key: "creative",
      label: "CREATIVE",
      hint: "Concepts, stories, characters, music, video, worlds, experiments.",
      actions: ["buildCreative", "expandIdea", "stranger", "coherent", "detail", "directions", "production", "variations"],
      fields: [
        { key: "idea", label: "IDEA", hint: "The seed of the idea" },
        { key: "goal", label: "GOAL", hint: "What this is for", one: true },
        { key: "style", label: "STYLE", hint: "Medium, genre, references", one: true },
        { key: "mood", label: "MOOD", hint: "Emotional register", one: true },
        { key: "themes", label: "THEMES", hint: "Ideas it explores" },
        { key: "influences", label: "INFLUENCES", hint: "Works, artists or genres to draw on" },
        { key: "rules", label: "RULES", hint: "Hard rules of this world or form" },
        { key: "experimental", label: "EXPERIMENTAL ELEMENTS", hint: "Risks worth taking" },
        { key: "avoid", label: "THINGS TO AVOID", hint: "Clichés and directions to skip" }
      ],
      toggles: []
    },
    {
      key: "agent",
      label: "AGENT",
      hint: "Prompts for autonomous or semi-autonomous AI agents.",
      actions: ["buildAgent", "improve", "review", "structure", "variations", "copypaste"],
      fields: [
        { key: "name", label: "AGENT NAME", hint: "e.g. Site Auditor", one: true },
        { key: "role", label: "ROLE", hint: "What kind of expert it is" },
        { key: "objective", label: "OBJECTIVE", hint: "The single outcome it must achieve" },
        { key: "tools", label: "AVAILABLE TOOLS", hint: "Tools, files, APIs or commands it may use" },
        { key: "inputs", label: "INPUTS", hint: "What it is given to work with" },
        { key: "outputs", label: "OUTPUTS", hint: "What it must produce" },
        { key: "permissions", label: "PERMISSIONS", hint: "What it is allowed to do" },
        { key: "restrictions", label: "RESTRICTIONS", hint: "What it must never do" },
        { key: "workflow", label: "WORKFLOW", hint: "The steps it should follow" },
        { key: "memory", label: "MEMORY / CONTEXT", hint: "What it should remember and track" },
        { key: "success", label: "SUCCESS CRITERIA", hint: "How completion is judged" },
        { key: "failure", label: "FAILURE HANDLING", hint: "What to do when blocked or wrong" }
      ],
      toggles: [
        { key: "planBeforeAction", label: "PLAN BEFORE ACTION", hint: "Plan and state the plan before doing anything.", default: true },
        { key: "preserveExistingWork", label: "PRESERVE EXISTING WORK", hint: "Never discard work that is already in place.", default: true },
        { key: "inspectBeforeModifying", label: "INSPECT BEFORE MODIFYING", hint: "Read and understand before changing anything.", default: true },
        { key: "noRepeatFailed", label: "DO NOT REPEAT FAILED ACTIONS", hint: "Track what failed and never retry it unchanged.", default: true },
        { key: "continueUntilComplete", label: "CONTINUE UNTIL COMPLETE", hint: "Keep working until the objective is met.", default: true },
        { key: "reportBlockers", label: "REPORT BLOCKERS CLEARLY", hint: "Say plainly what is blocking progress.", default: true },
        { key: "askWhenBlocked", label: "ASK ONLY WHEN GENUINELY BLOCKED", hint: "Do not ask questions it can answer itself.", default: true }
      ]
    },
    {
      key: "writing",
      label: "WRITING",
      hint: "Fiction, scripts, essays, articles, marketing, dialogue, editing.",
      actions: ["buildWriting", "improve", "expand", "simplify", "review", "structure", "variations", "copypaste", "clean"],
      fields: [
        { key: "purpose", label: "PURPOSE", hint: "What this text must achieve" },
        { key: "audience", label: "AUDIENCE", hint: "Who reads it", one: true },
        { key: "tone", label: "TONE", hint: "e.g. dry, warm, punchy", one: true },
        { key: "format", label: "FORMAT", hint: "Article, script, scene, email, thread", one: true },
        { key: "length", label: "LENGTH", hint: "e.g. 800 words, three paragraphs", one: true },
        { key: "voice", label: "VOICE", hint: "First person, narrator, character voice" },
        { key: "keyInfo", label: "KEY INFORMATION", hint: "Facts, points or beats that must appear" },
        { key: "include", label: "THINGS TO INCLUDE", hint: "Anything that must be in it" },
        { key: "avoid", label: "THINGS TO AVOID", hint: "Anything that must stay out of it" }
      ],
      toggles: []
    },
    {
      key: "custom",
      label: "CUSTOM",
      hint: "Your own prompt-building workflow, saved on this device.",
      actions: ["buildCustom", "improve", "review", "structure", "variations", "copypaste"],
      fields: [],
      toggles: [],
      custom: true
    }
  ],
  workshopActions: {
    expand: { label: "EXPAND", group: "Work on it", kind: "prompt", tip: "Add the missing detail so the prompt does more" },
    improve: { label: "IMPROVE", group: "Work on it", kind: "prompt", tip: "Tighten wording, remove ambiguity" },
    review: { label: "REVIEW", group: "Work on it", kind: "notes", tip: "Critique only - the prompt itself is not changed" },
    rewrite: { label: "REWRITE", group: "Work on it", kind: "prompt", tip: "Same goal, rebuilt from scratch" },
    simplify: { label: "SIMPLIFY", group: "Work on it", kind: "prompt", tip: "Shorter and clearer, no redundancy" },
    detailed: { label: "MAKE MORE DETAILED", group: "Work on it", kind: "prompt", tip: "Add specifics and quality criteria" },
    structure: { label: "STRUCTURE", group: "Work on it", kind: "prompt", tip: "Reorganise into labelled sections" },
    missing: { label: "FIND MISSING INFORMATION", group: "Work on it", kind: "notes", tip: "What a model would still need to know" },
    variations: { label: "GENERATE VARIATIONS", group: "Work on it", kind: "variations", tip: "Several genuinely different approaches" },
    copypaste: { label: "MAKE COPY-PASTE READY", group: "Work on it", kind: "prompt", tip: "Plain text, nothing wrapped around it" },
    clean: { label: "CLEAN PROFESSIONAL LANGUAGE", group: "Work on it", kind: "prompt", tip: "Only if you want the corporate register" },

    buildTask: { label: "BUILD CODING TASK", group: "Build", kind: "prompt", tip: "Assemble a complete coding task from whatever you filled in" },
    buildDebug: { label: "BUILD DEBUGGING PROMPT", group: "Build", kind: "prompt", tip: "Assemble a diagnose-first debugging request" },
    buildImage: { label: "BUILD IMAGE PROMPT", group: "Build", kind: "prompt", tip: "Assemble a generation prompt from the fields" },
    buildCreative: { label: "BUILD CREATIVE PROMPT", group: "Build", kind: "prompt", tip: "Assemble a creative brief from the fields" },
    buildAgent: { label: "CREATE AGENT PROMPT", group: "Build", kind: "prompt", tip: "Assemble a full agent brief" },
    buildWriting: { label: "BUILD WRITING PROMPT", group: "Build", kind: "prompt", tip: "Assemble a writing brief from the fields" },
    buildCustom: { label: "BUILD CUSTOM PROMPT", group: "Build", kind: "prompt", tip: "Use your own mode definition" },
    production: { label: "TURN INTO PRODUCTION PROMPT", group: "Build", kind: "prompt", tip: "Turn the idea into a brief someone could actually produce" },

    expandIdea: { label: "EXPAND IDEA", group: "Direction", kind: "prompt", tip: "Grow the idea without losing it" },
    stranger: { label: "MAKE STRANGER", group: "Direction", kind: "prompt", tip: "Push it somewhere more unusual" },
    coherent: { label: "MAKE MORE COHERENT", group: "Direction", kind: "prompt", tip: "Make the parts fit together" },
    detail: { label: "ADD DETAIL", group: "Direction", kind: "prompt", tip: "Concrete sensory and technical detail" },
    directions: { label: "GENERATE DIRECTIONS", group: "Direction", kind: "variations", tip: "Distinct directions the idea could go in" },

    composition: { label: "IMPROVE COMPOSITION", group: "Visual", kind: "prompt", tip: "Framing, balance and crop" },
    lighting: { label: "IMPROVE LIGHTING", group: "Visual", kind: "prompt", tip: "Make the light do more work" },
    camera: { label: "IMPROVE CAMERA LANGUAGE", group: "Visual", kind: "prompt", tip: "Camera, lens and depth of field" },
    atmosphere: { label: "ADD ATMOSPHERE", group: "Visual", kind: "prompt", tip: "Air, weather, mood, particles" },
    environment: { label: "ADD ENVIRONMENT DETAIL", group: "Visual", kind: "prompt", tip: "Enrich the setting" },
    photoreal: { label: "MAKE MORE PHOTOREALISTIC", group: "Direction", kind: "prompt", tip: "Move it toward photographic realism" },
    stylised: { label: "MAKE MORE STYLISED", group: "Direction", kind: "prompt", tip: "Move it toward illustration or a distinct style" }
  },
  workshopTemplates: [
    {
      key: "build-web-app",
      label: "BUILD WEB APP",
      mode: "coding",
      hint: "A complete task for building a small web app or a new feature.",
      fields: {
        task: "Build a single-page web app that ...",
        stack: "HTML, CSS and vanilla JavaScript - no build step, no dependencies",
        constraints: "Must work offline, must be usable on a phone, must not break anything that already exists",
        output: "The complete files, then a short summary of what changed and how to run it",
        testing: "Open it in a browser at desktop and phone widths, check the console is clean, and fix anything that fails"
      },
      toggles: { preserveKnownGood: true }
    },
    {
      key: "fix-bug",
      label: "FIX BUG",
      mode: "debugging",
      hint: "Diagnose first: find the cause, repair it, prove the repair.",
      fields: {
        whatShould: "...",
        whatActually: "...",
        errorMessage: "",
        recentChanges: "",
        files: "",
        tried: ""
      },
      toggles: { inspectFirst: true, preserveKnownGood: true, noRepeatTried: true, smallestRepair: true }
    },
    {
      key: "character-image",
      label: "CREATE CHARACTER IMAGE",
      mode: "image",
      hint: "A portrait-style character image prompt with camera and light filled in.",
      fields: {
        subject: "...",
        action: "standing, looking at the viewer",
        composition: "waist-up portrait, centred, subject fills the frame",
        camera: "full-frame",
        lens: "85mm, f/1.8, shallow depth of field",
        lighting: "soft key light from the left, cool rim light behind",
        style: "cinematic photograph, hyper-detailed, subtle film grain",
        details: "visible texture in skin and clothing, realistic imperfections"
      },
      toggles: { noText: true }
    },
    {
      key: "coding-agent",
      label: "CREATE CODING AGENT",
      mode: "agent",
      hint: "A full agent brief with the careful behaviour rules switched on.",
      fields: {
        name: "Repository Engineer",
        role: "a senior software engineer working directly inside this repository",
        objective: "...",
        tools: "read files, search the repository, edit files, run the test suite, run the linter",
        outputs: "a short plan, then the changes, then a summary of what was done and what remains",
        workflow: "1. Inspect the relevant files. 2. State a plan. 3. Make the smallest change that meets the objective. 4. Run the tests. 5. Report.",
        success: "the objective is met with existing tests still passing"
      },
      toggles: {
        planBeforeAction: true,
        preserveExistingWork: true,
        inspectBeforeModifying: true,
        noRepeatFailed: true,
        continueUntilComplete: true,
        reportBlockers: true,
        askWhenBlocked: true
      }
    },
    {
      key: "creative-concept",
      label: "CREATIVE CONCEPT",
      mode: "creative",
      hint: "A generative brief for a new idea, world, character, game or track.",
      fields: {
        idea: "...",
        goal: "a pitch someone could start working from today",
        mood: "",
        rules: "",
        experimental: "",
        avoid: "generic fantasy, anything that has been done to death"
      },
      toggles: {}
    },
    {
      key: "write-story",
      label: "WRITE STORY",
      mode: "writing",
      hint: "A fiction brief with form, length and voice stubbed in.",
      fields: {
        purpose: "...",
        format: "short story",
        length: "about 1200 words",
        voice: "",
        avoid: "purple prose, explaining the themes outright"
      },
      toggles: {}
    },
    {
      key: "general-task",
      label: "GENERAL TASK",
      mode: "general",
      hint: "An empty starting point: paste or write anything and use the actions.",
      fields: {},
      toggles: {}
    }
  ],
  starterFolders: [
    "UNSORTED",
    "IMPORTED",
    "CODING",
    "CODING > Websites",
    "CODING > Apps",
    "CODING > Debugging",
    "CODING > Agents",
    "IMAGES",
    "IMAGES > General",
    "IMAGES > Characters",
    "IMAGES > Photography",
    "IMAGES > Experimental",
    "IMAGES > NSFW",
    "CREATIVE",
    "CREATIVE > Writing",
    "CREATIVE > Music",
    "CREATIVE > Video",
    "CREATIVE > Ideas"
  ],
  starterPrompts: [
    {
      title: "Example: harden a coding agent task",
      folderPath: "CODING > Agents",
      type: "coding",
      rating: "sfw",
      tags: ["example", "agent"],
      content:
        "You are a senior engineer working in this repository.\n\nTASK: Fix the failing tests in the auth module.\n\nREQUIREMENTS:\n- Read the existing code before changing anything.\n- Keep the public API unchanged.\n- Add a regression test for each fix.\n- Do not reformat unrelated code.\n\nOUTPUT: a short summary of the change, then the diff."
    },
    {
      title: "Example: character portrait prompt",
      folderPath: "IMAGES > Characters",
      type: "image",
      rating: "sfw",
      tags: ["portrait", "character"],
      content:
        "portrait of a weathered lighthouse keeper, salt-crusted coat, storm lantern in hand, waist-up, rim light from the storm, cold teal and amber palette, 85mm lens, shallow depth of field, cinematic, hyper-detailed, film grain"
    }
  ]
};

window.PP_CONFIG = PP_CONFIG;
