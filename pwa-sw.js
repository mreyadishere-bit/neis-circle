const VERSION = "neis-pwa-v1";

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
