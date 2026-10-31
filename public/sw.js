/* Zenvio service worker.
   Privacy rule: only public, immutable assets are cached. Pages, API responses,
   client records, payments and signing documents always go to the network and
   are never written to a cache. Offline navigations get a static offline page. */
const VERSION = "zenvio-static-v2";
// Self-contained HTML (inline styles, no app bundles) so it renders with no network.
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/brand/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function cacheable(url) {
  return url.origin === self.location.origin && (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/brand/"));
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Page navigations: always network. Offline fallback is a static public page.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // Content-hashed build assets and brand images: cache first.
  if (cacheable(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok && response.type === "basic") {
              const copy = response.clone();
              caches.open(VERSION).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
  // Everything else (APIs, data, documents) is left to the browser untouched.
});
