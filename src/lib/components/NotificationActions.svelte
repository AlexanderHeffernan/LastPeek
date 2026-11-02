<script lang="ts">
  import { enhance, type SubmitFunction } from "$app/forms";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Popover } from "bits-ui";
  import Icon from "$lib/components/Icon.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";

  let { count, unread }: { count: number; unread: number } = $props();
  let open = $state(false);
  let busy = $state(false);
  let actionError = $state("");
  let confirmation: ConfirmDialog;
  let readForm: HTMLFormElement;
  let deleteForm: HTMLFormElement;
  const manage: SubmitFunction = () => {
    busy = true;
    actionError = "";
    return async ({ result, update }) => {
      try {
        if (result.type === "error" || result.type === "failure") {
          actionError = "Couldn’t update notifications. Try again.";
          open = true;
        } else {
          await update();
        }
      } finally {
        busy = false;
      }
    };
  };
  async function deleteAll() {
    open = false;
    if (
      await confirmation.ask({
        title: "Delete all notifications?",
        description:
          "This clears your notification history. Friend requests, drafts and feedback are kept.",
        confirmLabel: "Delete all notifications",
        cancelLabel: "Keep notifications",
      })
    )
      deleteForm.requestSubmit();
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="ghost"
        size="icon"
        class="mobile-header-action"
        aria-label="Notification actions"
        title="Notification actions"><Icon name="more" size={24} /></Button
      >
    {/snippet}
  </Popover.Trigger>
  <Popover.Content
    class="share-menu"
    align="end"
    sideOffset={8}
    aria-label="Notification actions"
  >
    {#if unread}
      <Button
        variant="ghost"
        disabled={busy}
        onclick={() => {
          open = false;
          readForm.requestSubmit();
        }}><Icon name="check" size={16} />Mark all as read</Button
      >
    {/if}
    {#if count}
      <Button variant="ghost" class="danger" disabled={busy} onclick={deleteAll}
        ><Icon name="trash" size={16} />Delete all</Button
      >
    {/if}
    <Button
      variant="ghost"
      href="/settings?tab=notifications"
      onclick={() => (open = false)}
      ><Icon name="settings" size={16} />Notification settings</Button
    >
    {#if actionError}<p class="action-error" role="alert">{actionError}</p>{/if}
  </Popover.Content>
</Popover.Root>
<ConfirmDialog bind:this={confirmation} />
<form
  hidden
  bind:this={readForm}
  method="POST"
  action="?/read"
  use:enhance={manage}
></form>
<form
  hidden
  bind:this={deleteForm}
  method="POST"
  action="?/deleteAll"
  use:enhance={manage}
></form>
