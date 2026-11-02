<script lang="ts">
  import { page } from "$app/state";
  import { invalidateAll } from "$app/navigation";
  import { Button } from "$lib/components/ui/button/index.js";
  import Icon from "$lib/components/Icon.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  let confirmation: ConfirmDialog;
  let {
    userId,
    name,
    draftId,
    token,
    manage = false,
    compact = false,
    inline = false,
  }: {
    userId: string;
    name: string;
    draftId?: string;
    token?: string;
    manage?: boolean;
    compact?: boolean;
    inline?: boolean;
  } = $props();
  let busy = $state(false),
    message = $state("");
  const connection = $derived(
    page.data.connections?.find((c) => c.user_id === userId),
  );
  async function act(action: "request" | "accept" | "remove") {
    if (
      action === "remove" &&
      connection?.accepted &&
      !(await confirmation.ask({
        title: `Remove ${name} as a friend?`,
        description:
          "You will both lose access to friend-only reviews shared with each other. Feedback will stay.",
        confirmLabel: "Remove friend",
        cancelLabel: "Keep friend",
      }))
    )
      return;
    busy = true;
    message = "";
    try {
      const response = await fetch("/api/friends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          id: connection?.id,
          userId,
          draftId,
          token,
        }),
      });
      if (!response.ok)
        throw new Error(
          (await response.json()).message || "Couldn’t update this request.",
        );
      await invalidateAll();
    } catch (e) {
      message = (e as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<ConfirmDialog bind:this={confirmation} />
{#if page.data.viewerId && page.data.viewerId !== userId && (!inline || !connection?.accepted)}
  <span class="friend-control" class:inline>
    {#if connection?.accepted}
      {#if manage}<Button
          variant="ghost"
          disabled={busy}
          onclick={() => act("remove")}
          aria-label={`Remove ${name} as a friend`}
          >{#if compact}<Icon name="close" size={20} />{:else}Remove friend{/if}</Button
        >
      {:else}<Button variant="ghost" href="/friends"
          ><Icon name="users" size={16} />Friends</Button
        >{/if}
    {:else if connection?.incoming}
      <Button
        variant={inline ? "link" : "secondary"}
        class={inline ? "h-11 -my-3 px-0 text-xs" : undefined}
        disabled={busy}
        onclick={() => act("accept")}
        aria-label={`Accept ${name}’s friend request`}
        >{inline ? "Accept request" : "Accept"}</Button
      >
      {#if !inline}<Button
          variant="ghost"
          disabled={busy}
          onclick={() => act("remove")}
          aria-label={`Decline ${name}’s friend request`}
          >{#if compact}<Icon
              name="close"
              size={18}
            />{:else}Decline{/if}</Button
        >{/if}
    {:else if connection}
      <Button
        variant={inline ? "link" : "ghost"}
        class={inline
          ? "h-11 -my-3 px-0 text-xs text-muted-foreground"
          : undefined}
        disabled={busy}
        onclick={() => act("remove")}
        aria-label={`Cancel friend request to ${name}`}
        title={inline ? "Cancel friend request" : undefined}
        >{inline
          ? busy
            ? "Cancelling…"
            : "Request sent"
          : compact
            ? "Cancel"
            : "Cancel request"}</Button
      >
    {:else}
      <Button
        variant={inline ? "link" : "ghost"}
        class={inline ? "h-11 -my-3 px-0 text-xs" : undefined}
        disabled={busy}
        onclick={() => act("request")}
        aria-label={`Add ${name} as a friend`}
        >{#if !inline}<Icon name="users" size={16} />{/if}{busy
          ? "Sending…"
          : "Add friend"}</Button
      >
    {/if}
    {#if message}<span class="action-error" role="alert">{message}</span>{/if}
  </span>
{/if}

<style>
  .friend-control {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
  }
  .inline {
    position: relative;
    z-index: 1;
    column-gap: 6px;
    min-height: 20px;
  }
  .inline::before {
    content: "·";
    color: var(--muted-foreground);
  }
  .action-error {
    flex-basis: 100%;
    margin: 0;
  }
</style>
