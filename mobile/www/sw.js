// Minimal service worker: precache the app shell + demo so an installed Reel
// opens instantly (and the demo works offline). HTML is network-first so a
// redeploy lands on next open; everything else is cache-first.
// Bump the version when shipped assets change.
const CACHE = "reel-v2";

const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/reel.css",
  "js/core/classify.js",
  "js/core/normalize.js",
  "js/core/settings.js",
  "js/core/gate.js",
  "js/core/format.js",
  "js/core/feed.js",
  "js/data/demo.js",
  "js/data/reddit.js",
  "js/ui/slides.js",
  "js/ui/pager.js",
  "js/ui/chrome.js",
  "js/ui/app.js",
  "demo/feed.json",
  "demo/media/dog-snow.webm",
  "demo/media/espresso-loop.webm",
  "demo/media/refinery.webm",
  "demo/media/dolomites.jpg",
  "demo/media/finale.jpg",
  "demo/media/leica-1.jpg",
  "demo/media/leica-2.jpg",
  "demo/media/leica-3.jpg",
  "demo/media/tech-thumb.jpg",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  // Live Reddit reads are never cached here — the host proxy owns caching.
  if (url.pathname.includes("/reddit/")) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(event.request).then((resp) => {
          if (resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return resp;
        })
    )
  );
});
