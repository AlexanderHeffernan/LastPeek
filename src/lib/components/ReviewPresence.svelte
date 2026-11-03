<script lang="ts">
  import { getContext, untrack } from "svelte";
  import type { Writable } from "svelte/store";
  import { invalidateAll } from "$app/navigation";
  import { fade, scale } from "svelte/transition";
  import UserIdentity from "./UserIdentity.svelte";
  let { draftId, token }: { draftId?: string; token?: string } = $props();
  const name = getContext<Writable<string>>("guest-name");
  let viewers = $state<
    { id: string; name: string; avatar_id: string | null; guest: boolean }[]
  >([]);
  $effect(() => {
    const target = token ? { token } : { draftId };
    const connection = crypto.randomUUID();
    let disposed = false,
      busy = false,
      activity: string | undefined;
    async function refresh() {
      if (busy || disposed || document.visibilityState !== "visible") return;
      busy = true;
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch("/api/review-presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...target,
            connection,
            name: untrack(() => $name),
          }),
          signal: controller.signal,
          keepalive: true,
        });
        if (disposed) return;
        if (!response.ok) {
          viewers = [];
          return;
        }
        const next = await response.json();
        if (disposed) return;
        viewers = next.viewers;
        if (activity && activity !== next.activity) await invalidateAll();
        activity = next.activity;
      } catch {
        if (!disposed) viewers = [];
      } finally {
        clearTimeout(deadline);
        busy = false;
        // A heartbeat already in flight must finish before the final leave.
        if (disposed) leave();
      }
    }
    function leave() {
      void fetch("/api/review-presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...target, connection, leave: true }),
        keepalive: true,
      }).catch(() => {});
    }
    function visibility() {
      if (document.visibilityState === "visible") void refresh();
      else leave();
    }
    void refresh();
    const timer = setInterval(refresh, 5000);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", leave);
    return () => {
      disposed = true;
      // Bounded keepalive requests finish across navigation without WebKit errors.
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  });
  const duration = () =>
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : 160;
</script>

{#if viewers.length}<div
    class="review-viewers"
    role="group"
    aria-label="Also viewing this draft"
    transition:fade={{ duration: duration() }}
  >
    {#each viewers.slice(0, 4) as viewer (viewer.id)}<span
        class="viewer"
        role="img"
        aria-label={`${viewer.name}${viewer.guest ? " · Guest" : ""} is viewing`}
        title={`${viewer.name}${viewer.guest ? " · Guest" : ""}`}
        transition:scale={{ duration: duration(), start: 0.8 }}
      >
        <UserIdentity
          name={viewer.name}
          avatarId={viewer.avatar_id}
          guest={viewer.guest}
          {token}
          avatarOnly
          showPresence={false}
        />
      </span>{/each}
    {#if viewers.length > 4}<span
        class="more-viewers"
        title={viewers
          .slice(4)
          .map((v) => v.name)
          .join(", ")}>+{viewers.length - 4}</span
      >{/if}
  </div>{/if}

<style>
  .review-viewers {
    display: flex;
    align-items: center;
    padding-left: 6px;
    flex-shrink: 0;
  }
  .viewer {
    margin-left: -6px;
    border: 2px solid var(--background);
    border-radius: 999px;
  }
  .viewer :global(.avatar) {
    width: 28px;
    height: 28px;
    font-size: 12px;
  }
  .viewer :global(svg) {
    width: 24px;
    height: 24px;
  }
  .more-viewers {
    color: var(--muted-foreground);
    font-size: 11px;
    margin-left: 3px;
  }
</style>
