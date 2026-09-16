const CACHE = "prompt-packer-app-v6";
const BASE = new URL("./", self.location).href;
const INDEX_URL = new URL("./index.html", BASE).href;
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./config.js",
  "./storage.js",
  "./ziplite.js",
  "./ai.js",
  "./workshop.js",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/favicon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

const OFFLINE_HTML =
  "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
  "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
  "<title>PROMPT PACKER</title></head><body style=\"margin:0;background:#0e1014;color:#e7ecf3;" +
  "font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;text-align:center\">" +
  "<div style=\"max-width:34rem;padding:2rem\"><h1 style=\"font-size:1.1rem;letter-spacing:.08em\">PROMPT PACKER</h1>" +
  "<p>The app files could not be loaded from this device's cache.</p>" +
  "<p style=\"opacity:.75\">Reconnect to the internet once so it can finish installing, then it will work offline.</p>" +
  "<p><button style=\"padding:.6rem 1.1rem;border-radius:8px;border:1px solid #313a49;background:#1b202a;color:#e7ecf3;font:inherit\" " +
  "onclick=\"location.reload()\">Retry</button></p></div></body></html>";

function precacheUrls() {
  return ASSETS.map(function (path) {
    return new URL(path, BASE).href;
  });
}

function offlinePage() {
  return new Response(OFFLINE_HTML, {
    status: 200,
    statusText: "OK",
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
  });
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(function (cache) {
        return Promise.all(
          precacheUrls().map(function (url) {
            return cache.add(new Request(url, { cache: "reload" })).catch(function () {
              return null;
            });
          })
        );
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys.map(function (key) {
            if (key === CACHE) return null;
            if (key.indexOf("prompt-packer-") !== 0) return null;
            return caches.delete(key);
          })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

function store(request, response) {
  if (!request || request.method !== "GET") return Promise.resolve();
  if (!response || !response.ok || response.status !== 200) return Promise.resolve();
  const type = response.type;
  if (type && type !== "basic" && type !== "cors") return Promise.resolve();
  return caches
    .open(CACHE)
    .then(function (cache) {
      return cache.put(request, response);
    })
    .catch(function () {
      return null;
    });
}

self.addEventListener("fetch", function (event) {
  const request = event.request;
  if (request.method !== "GET") return;
  let url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    let saved = Promise.resolve();
    const network = fetch(request)
      .then(function (response) {
        saved = store(request, response.clone());
        return response;
      })
      .catch(function () {
        return caches
          .match(request)
          .then(function (hit) {
            return hit || caches.match(INDEX_URL);
          })
          .then(function (hit) {
            return hit || caches.match(BASE);
          })
          .then(function (hit) {
            return hit || offlinePage();
          });
      });
    event.respondWith(network);
    event.waitUntil(
      network
        .then(function () {
          return saved;
        })
        .catch(function () {})
    );
    return;
  }

  let saved = Promise.resolve();
  const response = caches.match(request).then(function (hit) {
    const network = fetch(request)
      .then(function (fresh) {
        saved = store(request, fresh.clone());
        return fresh;
      })
      .catch(function () {
        return null;
      });
    if (hit) return hit;
    return network.then(function (fresh) {
      return fresh || new Response("", { status: 504, statusText: "Offline" });
    });
  });
  event.respondWith(response);
  event.waitUntil(
    response
      .then(function () {
        return saved;
      })
      .catch(function () {})
  );
});
