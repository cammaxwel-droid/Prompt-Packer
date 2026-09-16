PROMPT PACKER v1.0
==================

A local-first prompt library with a full PROMPT WORKSHOP: paste or write prompts, improve,
analyse and organise them with AI (or entirely manually), keep them in nestable folders,
search, star, import and export .txt files, back everything up as JSON, share prompts, and
use the whole app offline. No account, no server, no database, no paid API, no build step.

The version number is shown at the bottom of the Settings dialog.


WHAT IS IN THIS FOLDER
----------------------
index.html                the app (this is the page you open)
styles.css                all styling (dark by default)
app.js                    UI, library logic, import/export, search, folders
ai.js                     the AI layer - all AI actions and the provider seam
workshop.js               the PROMPT WORKSHOP engine - modes, fields, instructions
storage.js                local persistence (IndexedDB, with localStorage fallback)
config.js                 low-level config: prompt types, content labels, starter folders
ziplite.js                tiny dependency-free ZIP writer for TXT/ZIP exports
sw.js                     service worker (offline caching)
manifest.webmanifest      PWA manifest
icons/                    app icons
README.txt                this file

index.html must stay in the root of the folder, next to these files. Nothing is built,
bundled or compiled: the browser runs these files exactly as they are.


RUN LOCALLY
-----------
Double-click index.html. Everything works that way except installing it as an app and
offline caching (service workers need http/https, not file://).

To preview it exactly as it behaves once deployed, serve the folder over http from a
terminal in this folder:

    python3 -m http.server 8080        then open http://localhost:8080
    npx serve .                        if you have Node installed

No npm install, no Node server and no environment setup are needed.


DEPLOY (NETLIFY DROP)
---------------------
1. Open Netlify Drop: https://app.netlify.com/drop
2. Upload the finished PROMPT_PACKER_DEPLOY folder - drag the folder itself, or ZIP it and
   drop the ZIP. (ZIPs are extracted, so the folder inside the ZIP is fine as long as
   index.html is directly inside it. A folder inside a folder is not.)
3. Wait for the deployment to finish (a few seconds for a folder this size).
4. Open the generated site URL. That URL is your app - bookmark it, install it, share it.

To publish an update, drop the folder again. Deploying never touches the prompts already
saved in anybody's browser.


INSTALL (AS AN APP / PWA)
-------------------------
Once the site is open over http/https:
  - Chrome / Edge on desktop: an "Install" icon appears in the address bar, or use the
    browser menu > Install. "Install as app" also appears in Prompt Packer's Settings
    dialog when the browser offers it.
  - Chrome on Android: menu > "Install app" / "Add to Home screen".
  - Safari on iOS: Share > "Add to Home Screen".
Installing adds an icon to your desktop or home screen and caches the app files, so it
opens instantly and keeps working with no connection. Only external AI generation needs
the internet.


BACKUP
------
Use Export / Backup > "Export backup (JSON)" (bottom-left of the sidebar) periodically -
for example after any big reorganising session, and before clearing browser data. The
backup contains every prompt, folder, tag, title, content label and setting. Keep the file
somewhere you will find it again (cloud drive, USB stick, email to yourself).

Import / Restore reads that file back. It offers MERGE (add what is missing, keep what you
have) or REPLACE (asks first, and is the only way to overwrite the library). A file that is
not a Prompt Packer backup, or that is damaged, is refused with a message - it cannot
damage the library. Nothing is ever deleted by an import.


DATA LOCATION
-------------
Your prompts are stored in the browser and on the device you are using - not on a server
and not in an account:
  - Prompts, folders, tags, labels, trash: IndexedDB, database "prompt-packer".
  - Small settings (theme, AI provider, sort order, last opened prompt): localStorage.
  - If IndexedDB is unavailable the app falls back to localStorage and says so in the
    bottom-left corner of the sidebar (it will also tell you if it can only keep things in
    memory, in which case a reload loses them).

Consequences to be aware of:
  - Clearing site data / "cookies and other site data" for this site deletes the library.
    Export a backup regularly.
  - Data is per-browser and per-origin: it does not sync between devices, and a private or
    incognito window starts empty. Use the JSON backup to move between them.
  - If the app is deployed to a new domain, that site starts with an empty library - import
    your backup there.
  - Edits autosave (the status line shows Saved / Saving... / Unsaved changes); Ctrl/Cmd+S
    saves immediately.


AI
--
As deployed to Netlify (or opened from a local file), no AI provider is connected by
default, so the app runs in MANUAL mode. That is not a broken state: every AI action still
builds the complete request locally and shows COPY AI REQUEST, which you paste into any AI
tool you already use (ChatGPT, Claude, Gemini, a local model), then paste the answer back
with USE AS RESULT. The AI panel says so in plain words: "AI provider unavailable. You can
still copy the generated AI request and use it externally."

Optional providers, chosen automatically in this order:
  1. Perchance AI - free and automatic when the page is opened on perchance.org (the
     generator imports the ai-text-plugin). Nothing to configure.
  2. Your own OpenAI-compatible endpoint - a local model, for example Ollama at
     http://localhost:11434/v1, LM Studio at http://127.0.0.1:1234/v1, or llama.cpp.
     Set it in Settings > AI provider and press "Test endpoint". No key is needed for a
     local server, and nothing leaves your machine.
  3. Manual mode, as described above - always available, including offline.

Only the prompt you are working on, the built instruction, and (for AUTO ORGANISE) your
folder names plus a short excerpt of each prompt being filed are ever sent. Nothing else is
uploaded. Provider settings are stored locally on your device.

AI safety: a result always appears in its own box first, with REPLACE ORIGINAL / APPEND /
SAVE AS NEW PROMPT / COPY / DISCARD, and even after REPLACE there is an UNDO button. Auto
sort and auto organise show a review screen and move or tag prompts only - they never
delete anything. If the AI cannot be reached, the app says so instead of pretending it
worked, and your original prompt is left untouched.


THE REST OF THE APP
-------------------
  - Library: nestable folders (as deep as you like), search across titles, text, tags and
    folder paths, filters (ALL / CODING / IMAGE / NSFW / CREATIVE / RECENT / FAVOURITES),
    sorting, favourites, multi-file TXT import or drag-and-drop onto the window.
  - Deleting never destroys: prompts go to Trash (Restore, Delete forever, Restore all,
    Empty trash) and almost every destructive action offers UNDO in a toast for about 12
    seconds. Deleting a folder asks whether to keep the prompts inside it or move them to
    Trash, and prompts are never silently taken with a folder.
  - Export: a single prompt as .txt, a folder as a ZIP of .txt files, the whole library as
    a ZIP (mirrors your folder tree, includes a JSON backup), everything as one readable
    .txt, or the full JSON backup.
  - Share: a link that carries the prompt inside the URL itself - no server behind it.
    The person opening it is asked before anything is added to their library.
  - Adult content: Prompt Packer stores whatever prompt text you give it. The SFW/NSFW
    label is metadata for filtering and AI sorting only - nothing is filtered, hidden or
    refused, and there is no censorship of your own library.
  - Prompt Workshop: General, Coding, Debugging, Image, Creative, Agent, Writing and your
    own Custom modes, each with optional fields, behaviour toggles, a practical checklist,
    ANALYSE, variations, a block assembler, templates, and a manual fallback that works
    with no AI at all. Open it with the WORKSHOP button in the editor - it takes whatever
    prompt you already have open, so you never copy and paste it yourself.


REBUILDING / CHANGING THINGS
----------------------------
  - The action wording sent to the model lives in ai.js in the ACTIONS object (label +
    instruction per action). The single provider seam is
    generateWithAI(instruction, options) -> { text, provider }.
  - Prompt types, content labels, starter folders and the starter example prompts live in
    config.js.
  - The Workshop's modes, fields, toggles and builders live in workshop.js.
  - Bump the version string in config.js and the CACHE name in sw.js whenever you change
    the shipped files, so returning visitors actually receive the new copies.
