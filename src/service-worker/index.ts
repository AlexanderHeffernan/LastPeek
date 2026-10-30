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
