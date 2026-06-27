const CACHE_NAME = "paperclip-v2";

self.addEventListener("install", () => {
  self.skipWaiting();
});

// --- Web Push (TON-2312) ---------------------------------------------------

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Paperclip", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Paperclip";
  const options = {
    body: data.body || "",
    icon: "/android-chrome-192x192.png",
    badge: "/favicon-32x32.png",
    // Coalesce repeat notifications for the same entity.
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: { url: data.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rawUrl = (event.notification.data && event.notification.data.url) || "/";
  // Resolve to an absolute, same-origin URL so client.url comparisons are exact.
  const targetUrl = new URL(rawUrl, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      const appClients = clientList.filter(
        (client) => new URL(client.url).origin === self.location.origin,
      );

      // 1) A tab already on the exact target page: just focus it. Never
      //    navigate a *different* tab when the right one is already open
      //    (TON-2674 greptile P1: notificationclick navigated the first window
      //    unconditionally, hijacking an unrelated tab).
      const exact = appClients.find((client) => client.url === targetUrl);
      if (exact && "focus" in exact) {
        return exact.focus();
      }

      // 2) Reuse one of our own app tabs by navigating it to the target.
      const reusable = appClients.find((client) => "focus" in client && "navigate" in client);
      if (reusable) {
        return reusable.focus().then((focused) =>
          (focused || reusable).navigate(targetUrl).catch(() => {}),
        );
      }

      // 3) No suitable tab open: open a new window on the target.
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests and API calls
  if (request.method !== "GET" || url.pathname.startsWith("/api")) {
    return;
  }

  // Network-first for everything — cache is only an offline fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => {
        if (request.mode === "navigate") {
          return caches.match("/") || new Response("Offline", { status: 503 });
        }
        return caches.match(request);
      })
  );
});
