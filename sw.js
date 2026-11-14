// Service worker: lets the app be installed and open without a connection. The app's own files
// are served from the cache and refreshed in the background (so an update shows on the next
// visit); Quran text, tafsir and recitations are kept once fetched, so a surah used before
// can be made into a video again offline.
const VERSION = "v3";
const SHELL = `shell-${VERSION}`;
const DATA = "quran-data-v1";
const FILES = [
  "./", "index.html", "css/style.css", "js/app.js", "js/data.js", "js/i18n.js", "js/quran.js", "js/render.js",
  "fonts/AmiriQuran-Regular.ttf", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png",
];
const DATA_HOSTS = ["api.alquran.cloud", "everyayah.com", "cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("shell-") && k !== SHELL).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // stale-while-revalidate for the app itself
    e.respondWith(caches.open(SHELL).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: true });
      const fresh = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || fresh;
    }));
  } else if (DATA_HOSTS.includes(url.hostname)) {
    // cache-first for Quran text, tafsir, recitations and fonts (they never change)
    e.respondWith(caches.open(DATA).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok || r.type === "opaque") c.put(req, r.clone()).catch(() => {});
      return r;
    }));
  }
  // anything else (the visitor counter) goes to the network as usual
});
