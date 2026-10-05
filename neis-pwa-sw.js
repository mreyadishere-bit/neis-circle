const VERSION = "neis-pwa-v10";
const STATIC_CACHE = "neis-static-v10";


const VAPID_PUBLIC_KEY = "BKPTZrkpcjMsJHXVOCnZHW-ht94oEPCIvZ8HMu65tQEnfjhoi5-HdBODDt1iNVBFIgsZoyMwXQxQJLJ62ZQoWYw";
const PUSH_REFRESH_URL = "https://ydieijgynqlckaczalju.supabase.co/functions/v1/refresh-web-push-subscription";
const PUSH_DB = "neis-push-meta";
const PUSH_STORE = "kv";

function base64UrlToUint8Array(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(ch => ch.charCodeAt(0)));
}

function openPushDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PUSH_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PUSH_STORE)) db.createObjectStore(PUSH_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function pushMetaGet(key) {
  const db = await openPushDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PUSH_STORE, "readonly");
    const request = tx.objectStore(PUSH_STORE).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function pushMetaSet(key, value) {
  const db = await openPushDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PUSH_STORE, "readwrite");
    tx.objectStore(PUSH_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function subscriptionJson(subscription) {
  if (!subscription) return null;
  const json = subscription.toJSON ? subscription.toJSON() : subscription;
  return {
    endpoint: subscription.endpoint || json.endpoint || "",
    keys: {
      p256dh: json.keys?.p256dh || "",
      auth: json.keys?.auth || ""
    }
  };
}

async function refreshRotatedSubscription(oldSubscription, newSubscription) {
  const oldProof = subscriptionJson(oldSubscription) || await pushMetaGet("subscription");
  const next = subscriptionJson(newSubscription);
  if (!oldProof?.endpoint || !oldProof?.keys?.p256dh || !oldProof?.keys?.auth || !next?.endpoint) {
    if (next) await pushMetaSet("subscription", next);
    return false;
  }
  const payload = { old_subscription: oldProof, new_subscription: next };
  await pushMetaSet("pending_rotation", payload);
  try {
    const response = await fetch(PUSH_REFRESH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error("push_rotation_failed");
    await pushMetaSet("subscription", next);
    await pushMetaSet("pending_rotation", null);
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    windows.forEach(client => client.postMessage({ type: "NEIS_PUSH_ROTATED" }));
    return true;
  } catch (_) {
    try { await self.registration.sync?.register?.("neis-push-rotation"); } catch (_) {}
    return false;
  }
}

async function retryPendingPushRotation() {
  const pending = await pushMetaGet("pending_rotation");
  if (!pending?.old_subscription || !pending?.new_subscription) return;
  await refreshRotatedSubscription(pending.old_subscription, pending.new_subscription);
}

self.addEventListener("message", (event) => {
  if (event.data?.type !== "NEIS_PUSH_SUBSCRIPTION") return;
  const subscription = event.data.subscription;
  if (subscription?.endpoint) event.waitUntil(pushMetaSet("subscription", subscription));
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    const next = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(VAPID_PUBLIC_KEY)
    });
    await refreshRotatedSubscription(event.oldSubscription || null, next);
  })());
});

self.addEventListener("sync", (event) => {
  if (event.tag === "neis-push-rotation") event.waitUntil(retryPendingPushRotation());
});

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
    icon: "/assets/email-logo.png",
    badge: "/assets/notification-badge.png?v=2",
    data: { route: normalizeRoute(data.route || "") },
    tag: data.notification_id ? "neis-" + data.notification_id : undefined,
    timestamp: Date.now(),
    renotify: false,
    silent: data.silent === true
  };
  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const payload = {
      type: "NEIS_PUSH_NOTIFICATION",
      notification: {
        id: data.notification_id || "",
        type: data.type || "",
        title,
        body: options.body,
        route: data.route || "",
        silent: data.silent === true,
        created_at: new Date().toISOString()
      }
    };
    windows.forEach(client => client.postMessage(payload));
  })());
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
