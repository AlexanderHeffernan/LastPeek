import { version } from "$app/env";
import { self as worker } from "$app/service-worker";

const cacheName = `lastpeek-offline-${version}`;
const offlinePage = "/offline.html";

worker.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(cacheName).then((cache) => cache.add(offlinePage)),
  );
  // Do not take over an open composer. Updates activate after existing app windows close.
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith("lastpeek-offline-") && key !== cacheName,
            )
            .map((key) => caches.delete(key)),
        ),
      ),
  );
});

worker.addEventListener("fetch", (event) => {
  // Never cache authenticated pages, capability URLs, API responses or private media.
  // Failed writes stay with the existing autosave error handling; no background replay.
  if (
    event.request.mode !== "navigate" ||
    event.request.method !== "GET" ||
    new URL(event.request.url).origin !== worker.location.origin
  )
    return;
  event.respondWith(
    fetch(event.request).catch(async () => {
      const cache = await caches.open(cacheName);
      return (await cache.match(offlinePage)) ?? Response.error();
    }),
  );
});

worker.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let payload;
      try {
        payload = event.data?.json();
      } catch {
        return;
      }
      if (
        !payload ||
        typeof payload.id !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(payload.id)
      )
        return;
      await worker.registration.showNotification("LastPeek", {
        body:
          typeof payload.body === "string"
            ? payload.body.slice(0, 160)
            : "You have a new notification.",
        icon: "/pwa/icon-192.png",
        badge: "/pwa/icon-192.png",
        tag: `lastpeek-${payload.id}`,
        data: { id: payload.id },
      });
    })(),
  );
});

worker.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const id = event.notification.data?.id;
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return;
  const target = new URL(`/notifications/${id}`, worker.location.origin).href;
  event.waitUntil(
    (async () => {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      }).catch(() => {});
      const clients = await worker.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const existing = clients.find(
        (client) => new URL(client.url).origin === worker.location.origin,
      );
      if (existing) {
        await existing.navigate(target);
        await existing.focus();
      } else await worker.clients.openWindow(target);
    })(),
  );
});
