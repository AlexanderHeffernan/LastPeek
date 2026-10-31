<script lang="ts">
  import { enhance } from "$app/forms";
  import { Button } from "$lib/components/ui/button/index.js";
  import Icon from "$lib/components/Icon.svelte";
  import Brand from "$lib/components/Brand.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import { notificationMessage } from "$lib/notifications";
  import { relativeTime } from "$lib/contracts";
  import type { SubmitFunction } from "$app/forms";
  let { data } = $props();
  let confirmation: ConfirmDialog;
  let deleteAllForm: HTMLFormElement;
  let busy = $state(false),
    actionError = $state("");
  const manage: SubmitFunction = () => {
    busy = true;
    actionError = "";
    return async ({ result, update }) => {
      try {
        if (result.type === "error" || result.type === "failure") {
          actionError = "Couldn’t update notifications. Try again.";
        } else {
          await update();
        }
      } finally {
        busy = false;
      }
    };
  };
  async function deleteAll() {
    if (
      await confirmation.ask({
        title: "Delete all notifications?",
        description:
          "This clears your notification history. Friend requests, drafts and feedback are kept.",
        confirmLabel: "Delete all notifications",
        cancelLabel: "Keep notifications",
      })
    )
      deleteAllForm.requestSubmit();
  }
</script>

<svelte:head><title>Notifications · LastPeek</title></svelte:head>
<main class="notifications-page" aria-label="Notifications">
  <header>
    <h1>Notifications</h1>
    <Button
      variant="ghost"
      href="/settings?tab=notifications"
      aria-label="Notification settings"><Icon name="settings" /></Button
    >
  </header>
  {#if data.notifications.length}<div class="notification-actions">
      {#if data.unreadNotifications}<form
          method="POST"
          action="?/read"
          use:enhance={manage}
        >
          <Button variant="ghost" type="submit" disabled={busy}
            >Mark all as read</Button
          >
        </form>{/if}
      <Button variant="ghost" disabled={busy} onclick={deleteAll}
        >Delete all</Button
      >
    </div>{/if}
  {#if actionError}<p class="action-error" role="alert">{actionError}</p>{/if}
  {#each data.notifications as item (item.id)}
    <div class="notification-row" class:unread={!item.read_at}>
      <form method="POST" action="?/open" use:enhance class="notification-open">
        <input type="hidden" name="id" value={item.id} />
        <Button variant="ghost" type="submit" class="notification-item">
          <Icon
            name={item.kind === "feedback"
              ? "comment"
              : item.kind === "shared_draft"
                ? "drafts"
                : "users"}
          />
          <div class="notification-copy">
            {#if item.name}<strong>{item.name}</strong>{/if}
            <p>{notificationMessage(item.kind)}</p>
            <small class="muted"
              >{relativeTime(item.created_at)}{!item.read_at
                ? " · Unread"
                : ""}</small
            >
          </div>
          <Icon name="arrow" size={18} />
        </Button>
      </form>
      <form
        method="POST"
        action="?/delete"
        use:enhance={manage}
        class="notification-delete"
      >
        <input type="hidden" name="id" value={item.id} />
        <Button
          variant="ghost"
          size="icon"
          type="submit"
          disabled={busy}
          aria-label={`Delete notification from ${item.name || "LastPeek"}`}
          title="Delete notification"><Icon name="trash" size={18} /></Button
        >
      </form>
    </div>
  {:else}<div class="notification-empty">
      <div class="empty-mascot"><Brand markOnly decorative /></div>
      <h2>Not a peep.</h2>
      <p>Requests, shared drafts and feedback will appear here.</p>
    </div>{/each}
</main>

<ConfirmDialog bind:this={confirmation} />
<form
  hidden
  bind:this={deleteAllForm}
  method="POST"
  action="?/deleteAll"
  use:enhance={manage}
></form>

<style>
  .notifications-page {
    max-width: 600px;
    min-height: 100dvh;
    border-inline: 1px solid var(--line);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
  }
  h1 {
    font-size: 20px;
    margin: 0;
  }
  .notification-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 0 8px 8px;
  }
  .notification-row {
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--line);
    border-left: 2px solid transparent;
  }
  .notification-row.unread {
    border-left-color: var(--primary);
  }
  .notification-row:focus-within {
    background: var(--secondary);
  }
  @media (hover: hover) {
    .notification-row:hover {
      background: var(--secondary);
    }
  }
  .notification-open {
    flex: 1;
    min-width: 0;
  }
  .notification-delete {
    padding-right: 8px;
  }
  .action-error {
    margin: 8px 16px;
  }
  :global(.notification-item[data-slot="button"]) {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 18px 16px;
    color: inherit;
    background: transparent;
    border: 0;
    width: 100%;
    text-align: left;
    font: inherit;
    cursor: pointer;
    height: auto;
    white-space: normal;
    border-radius: 0;
  }
  .notification-copy {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  p {
    margin: 4px 0;
    font-size: 14px;
  }
  .notification-empty {
    padding: 72px 24px;
    text-align: center;
  }
  .empty-mascot {
    margin: 0 auto 24px;
    width: 88px;
  }
  .empty-mascot :global(svg) {
    width: 88px;
    height: auto;
  }
  .notification-empty h2 {
    margin: 0;
    font-size: 24px;
    letter-spacing: -0.6px;
  }
  .notification-empty p {
    max-width: 300px;
    margin: 12px auto 0;
    color: var(--muted-foreground);
    font-size: 15px;
  }
</style>
