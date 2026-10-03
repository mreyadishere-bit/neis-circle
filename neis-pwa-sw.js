const VERSION = "neis-pwa-v8";
const STATIC_CACHE = "neis-static-v8";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith("neis-static-") && name !== STATIC_CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

function normalizeRoute(route) {
  const origin = self.location.origin;
  const raw = String(route || "").trim();
  if (!raw) return origin + "/#/";
  if (raw.startsWith(origin + "/#/")) return raw;
  if (raw.startsWith("/#/")) return origin + raw;
  if (raw.startsWith("#/")) return origin + "/" + raw;
  try {
    const absolute = new URL(raw, origin);
    if (absolute.origin !== origin) return origin + "/#/";
    if (absolute.hash && absolute.hash.startsWith("#/")) return absolute.href;
    const path = absolute.pathname.replace(/^\/+/, "");
    return origin + "/#/" + path + absolute.search;
  } catch (_) {
    return origin + "/#/" + raw.replace(/^\/+/, "").replace(/^#\/?/, "");
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = normalizeRoute(event.notification?.data?.route || "");
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clientsList) {
      if ("navigate" in client) {
        try { await client.navigate(target); } catch (_) {}
      }
      if ("focus" in client) return client.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  const title = data.title || "NEIS Circle";
  const options = {
    body: data.body || "You have a new notification.",
    badge: "/assets/notification-badge.png?v=2",
    data: { route: normalizeRoute(data.route || "") },
    tag: data.notification_id ? "neis-" + data.notification_id : undefined,
    renotify: false,
    silent: data.silent === true
  };
  event.waitUntil(self.registration.showNotification(title, options));
});


/* App code must never be served cache-first after a deployment.
   JS/CSS are network-first with cache fallback; images/fonts stay cache-first. */
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try { url = new URL(request.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate" || request.destination === "document") return;

  const isCode = /\.(?:css|js)$/i.test(url.pathname);
  const isAsset = /\.(?:png|jpe?g|webp|svg|woff2?)$/i.test(url.pathname);
  if (!isCode && !isAsset) return;

  event.respondWith((async () => {
    const cache = await caches.open(STATIC_CACHE);

    if (isCode) {
      try {
        const response = await fetch(request, { cache: "no-store" });
        if (response && response.ok) cache.put(request, response.clone()).catch(() => {});
        return response;
      } catch (_) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw _;
      }
    }

    const cached = await cache.match(request);
    if (cached) {
      event.waitUntil(fetch(request).then(response => {
        if (response && response.ok) return cache.put(request, response.clone());
      }).catch(() => {}));
      return cached;
    }

    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  })());
});
