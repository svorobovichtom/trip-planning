// Offline shell: the page and SDK open without network. API calls are never
// cached here - the page keeps its own snapshot and write queue.
const CACHE = "trip-shell-v2";
const SHELL = ["./", "./index.html", "./vendor/pocketbase.umd.js", "./vendor/torph.mjs"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (url.origin !== location.origin && !isFont) return;
  if (url.pathname.includes("/api/") || url.pathname.includes("/_/")) return;
  // The new app at /next/ has its own service worker; never serve it this shell.
  if (url.pathname === "/next" || url.pathname.startsWith("/next/")) return;
  // Network first, so a deploy shows up on the next open; cache as fallback.
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok || res.type === "opaque") {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req.mode === "navigate" ? "./" : req, copy));
      }
      return res;
    }).catch(() => caches.match(req.mode === "navigate" ? "./" : req, { ignoreSearch: true }))
  );
});
