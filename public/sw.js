/* Zenvio service worker.
   Privacy rule: only public, immutable assets are cached. Pages, API responses,
   client records, payments and signing documents always go to the network and
   are never written to a cache. Offline navigations get a static offline page. */
const VERSION = "zenvio-static-v3";
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
  // Live streams must reach the network; never intercept EventSource.
  if (request.headers.get("accept")?.includes("text/event-stream")) return;
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

/* Platform alert Web Push — show a device notification and open the deep link. */
self.addEventListener("push", (event) => {
  let data = { title: "Zenvio", body: "", url: "/admin", tag: "zenvio-platform", icon: "/brand/icon-192.png" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    try {
      if (event.data) data.body = event.data.text();
    } catch {}
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Zenvio", {
      body: data.body || "",
      icon: data.icon || "/brand/icon-192.png",
      badge: "/brand/favicon-32.png",
      tag: data.tag || "zenvio-platform",
      data: { url: data.url || "/admin" },
      renotify: true,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/admin";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate?.(target);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    }),
  );
});
