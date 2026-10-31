import { version } from "$app/env";

export function registerServiceWorker() {
  // An edge cache may retain the unversioned script even during browser update checks.
  return navigator.serviceWorker.register(
    `/service-worker.js?v=${encodeURIComponent(version)}`,
    { scope: "/", type: "module", updateViaCache: "none" },
  );
}
