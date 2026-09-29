const VERSION = "neis-pwa-v5";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Intentionally no aggressive fetch caching.
// NEIS Circle depends on live Supabase/realtime data and should always prefer
// the newest production assets instead of serving a stale application shell.

function neisNotificationTarget(route) {
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
  const route = event.notification?.data?.route || "";
  const target = neisNotificationTarget(route);
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clientsList) {
      if ("focus" in client) {
        if ("navigate" in client) await client.navigate(target);
        return client.focus();
      }
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
    badge: "/assets/notification-badge.png",
    data: { route: data.route || "/" },
    tag: data.notification_id ? "neis-" + data.notification_id : undefined,
    renotify: false,
    silent: data.silent === true
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
