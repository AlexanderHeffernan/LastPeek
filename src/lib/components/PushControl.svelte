<script lang="ts">
  import { onMount } from "svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  let supported = $state(false),
    ready = $state(false),
    enabled = $state(false),
    busy = $state(false),
    message = $state("");
  onMount(async () => {
    supported =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    if (supported && Notification.permission === "granted") {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        const response = await fetch("/api/push");
        if (!response.ok) throw new Error();
        enabled = !!subscription && (await response.json()).enabled;
      } catch {
        message =
          "Couldn’t check this device. Try enabling notifications again.";
      }
    }
    ready = true;
  });
  async function toggle() {
    busy = true;
    message = "";
    try {
      if (enabled) {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          const response = await fetch("/api/push", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          });
          if (!response.ok)
            throw new Error("Couldn’t disable notifications. Try again.");
          await subscription.unsubscribe();
        }
        enabled = false;
      } else {
        // Ask only in direct response to this button, including installed iOS PWAs.
        const permission = await Notification.requestPermission();
        if (permission !== "granted")
          throw new Error(
            permission === "denied"
              ? "Notifications are blocked. Allow them in your device or browser settings, then try again."
              : "Permission wasn’t granted. Tap Enable to try again.",
          );
        const response = await fetch("/api/push");
        if (!response.ok)
          throw new Error(
            "Couldn’t enable notifications. Sign in again and retry.",
          );
        const { publicKey } = await response.json();
        const registration =
          await navigator.serviceWorker.register("/service-worker.js");
        await navigator.serviceWorker.ready;
        const subscription =
          (await registration.pushManager.getSubscription()) ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: publicKey,
          }));
        const saved = await fetch("/api/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(subscription.toJSON()),
        });
        if (!saved.ok)
          throw new Error(
            (await saved.json()).message ||
              "Couldn’t save this device. Try again.",
          );
        enabled = true;
      }
    } catch (cause) {
      message =
        cause instanceof Error
          ? cause.message
          : "Couldn’t update this device. Try again.";
    } finally {
      busy = false;
    }
  }
</script>

<div class="push-device">
  <div>
    <h3>This device</h3>
    <p class="small muted">
      {enabled ? "Push notifications enabled" : "Push notifications off"}
    </p>
  </div>
  <Button
    variant="secondary"
    disabled={!ready || !supported || busy}
    onclick={toggle}
    >{busy ? "Updating…" : enabled ? "Disable" : "Enable notifications"}</Button
  >
</div>
{#if ready && !supported}<p class="small muted">
    On iPhone or iPad, add LastPeek to your Home Screen and open it there to
    enable push. Otherwise, use a browser that supports Web Push.
  </p>{/if}
{#if message}<p class="action-error" role="alert">{message}</p>{/if}

<style>
  .push-device {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
    margin: 28px 0 12px;
    padding-top: 20px;
    border-top: 1px solid var(--line);
  }
  h3 {
    font-size: 15px;
    margin: 0;
  }
  p {
    margin: 5px 0;
  }
</style>
