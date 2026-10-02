/* Service worker: web push + offline fallback.
 * Caching policy: ONLY immutable static assets are cached. Pages (HTML), API responses,
 * uploads and anything authenticated — including room credentials — are never cached.
 */
const CACHE = "static-v3";
// The offline page uses the WebP variant (≈21 KB) when the browser supports it.
const OFFLINE_ART = "/art/empty-offline-384.webp";
const OFFLINE_URL = "/offline.html";

/** True only for same-origin GETs of static build assets and icons. */
function shouldCache(url, method) {
  if (method !== "GET") return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.origin !== self.location.origin) return false;
  if (u.search) return false;
  const p = u.pathname;
  if (p.startsWith("/api/")) return false;
  if (p === OFFLINE_URL) return true;
  if (p.startsWith("/_next/static/")) return true;
  if (p.startsWith("/icons/")) return true;
  if (p.startsWith("/art/")) return true; // design artwork (public, static)
  return false;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // The offline artwork is optional (it exists only once delivered), so its absence never fails install.
      .then((c) => Promise.all([c.add(OFFLINE_URL), c.add(OFFLINE_ART).catch(() => undefined)]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.mode === "navigate") {
    // Network only; show the offline page when the network is down. Never store the page.
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
    return;
  }
  if (!shouldCache(req.url, req.method)) return; // default network handling, no caching
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

self.addEventListener("push", (event) => {
  let data = { title: "Capital Esports", body: "", url: "/dashboard" };
  try {
    data = Object.assign(data, event.data ? event.data.json() : {});
  } catch {
    /* ignore malformed payloads */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, { body: data.body, icon: "/icons/192", badge: "/icons/192", data: { url: data.url } }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/dashboard", self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) if (w.url === target.href && "focus" in w) return w.focus();
      return self.clients.openWindow(target.href);
    }),
  );
});
