const VERSION = "neis-pwa-v4";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Intentionally no aggressive fetch caching.
// NEIS Circle depends on live Supabase/realtime data and should always prefer
// the newest production assets instead of serving a stale application shell.

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const route = event.notification?.data?.route || "/";
  const target = new URL(route, self.location.origin).href;
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
    badge: "/assets/notification-badge.svg",
    data: { route: data.route || "/" },
    tag: data.notification_id ? "neis-" + data.notification_id : undefined,
    renotify: false,
    silent: data.silent === true
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
