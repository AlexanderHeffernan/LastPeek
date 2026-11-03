<script lang="ts">
  import { enhance } from "$app/forms";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { untrack } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { Popover } from "bits-ui";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Select } from "$lib/components/ui/select/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import AgentPermissions from "$lib/components/AgentPermissions.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { relativeTime } from "$lib/contracts";
  import {
    agentExpiryOptions,
    agentScopes,
    expandAgentScopes,
    type AgentScope,
  } from "$lib/agents";
  import type {
    PageData,
    ActionData,
  } from "../../routes/(app)/settings/$types";

  let {
    data,
    form,
  }: { data: NonNullable<PageData["agentConnections"]>; form: ActionData } =
    $props();
  const mobile = new MediaQuery("(max-width: 600px)");
  const editId = $derived(page.url.searchParams.get("edit"));
  const editing = $derived(data.agents.find((agent) => agent.id === editId));
  let selected = $state<AgentScope[]>(
    untrack(() =>
      (editing?.requestedScopes ?? editing?.scopes ?? []).filter((scope) =>
        agentScopes.some((item) => item === scope),
      ),
    ),
  );
  const addingPermissions = $derived(
    expandAgentScopes(selected).some(
      (scope) => !editing?.approvedScopes.includes(scope),
    ),
  );
  let openActions = $state<string | null>(null);
  let copied = $state(false);
  let copyError = $state("");
  let saving = $state(false);
  let expiry = $state("keep");
  const awaitingApproval = $derived.by(() => {
    const pending = editing?.requestedScopes;
    const requested = expandAgentScopes(selected);
    return (
      expiry === "keep" &&
      !!pending &&
      requested.length === pending.length &&
      requested.every((scope) => pending.includes(scope))
    );
  });
  let endpointInput = $state<HTMLInputElement | null>(null);
  let confirmation: ConfirmDialog;
  $effect(() => {
    const id = editId;
    expiry = "keep";
    selected = untrack(() => {
      const agent = data.agents.find((agent) => agent.id === id);
      return (agent?.requestedScopes ?? agent?.scopes ?? []).filter((scope) =>
        agentScopes.some((item) => item === scope),
      );
    });
  });
  $effect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => (copied = false), 2500);
    return () => clearTimeout(timeout);
  });
  const date = (value: string) =>
    new Date(value).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  async function copy() {
    try {
      await navigator.clipboard.writeText(data.endpoint);
      copied = true;
      copyError = "";
    } catch {
      copyError = "Select the address and copy it manually.";
    }
  }
</script>

<div class="agents-page" class:show-permissions={!!editing}>
  <section class="connect-card" aria-label="Connect your agent">
    <h2>Connect your agent</h2>
    <p>
      Add this MCP address in your agent app, then sign in to LastPeek to choose
      its permissions.
    </p>
    <div class="endpoint">
      <Input
        bind:ref={endpointInput}
        aria-label="MCP server address"
        readonly
        value={data.endpoint}
        title={data.endpoint}
        onclick={(event) => event.currentTarget.select()}
      />
      <Button
        variant="ghost"
        size="icon"
        class="copy-address"
        onclick={copy}
        aria-label={copied ? "Copied MCP address" : "Copy MCP address"}
        title={copied ? "Copied" : "Copy address"}
        ><Icon name={copied ? "check" : "copy"} /></Button
      >
    </div>
    {#if copyError}<p class="action-error" role="alert">{copyError}</p>{/if}
  </section>
  <section class="agents-main" aria-label="Your connections">
    <header>
      <h2>Your connections</h2>
      <span class="muted">{data.agents.length}</span>
    </header>
    {#each data.agents as agent (agent.id)}
      <article class="connection-row" aria-label={`${agent.name} connection`}>
        <div class="connection-info">
          <h2 title={agent.name}>{agent.name}</h2>
          <p class="muted">
            {#if agent.expired}Expired{:else if agent.requestedScopes}Awaiting
              permission approval{:else if !agent.scopes.length}No permissions
              enabled{:else if agent.lastUsedAt}<span
                title={date(agent.lastUsedAt)}
                >Last used {relativeTime(agent.lastUsedAt)}</span
              >{:else}Not used yet{/if}
          </p>
        </div>
        <div class="row-actions">
          <Popover.Root
            open={openActions === agent.id}
            onOpenChange={(open) => (openActions = open ? agent.id : null)}
          >
            <Popover.Trigger>
              {#snippet child({ props })}<Button
                  {...props}
                  variant="ghost"
                  size="icon"
                  aria-label={`${agent.name} actions`}
                  title={`${agent.name} actions`}
                  ><Icon name="more" size={22} /></Button
                >{/snippet}
            </Popover.Trigger>
            <Popover.Content
              class="share-menu"
              align="end"
              sideOffset={8}
              aria-label={`${agent.name} actions`}
            >
              {#if !agent.expired}<Button
                  variant="ghost"
                  href={`/settings?tab=agents&edit=${agent.id}`}
                  onclick={() => (openActions = null)}
                  ><Icon name="lock" />Edit permissions</Button
                >{/if}
              <form
                method="POST"
                action="/settings?tab=agents&/agent"
                use:enhance={async ({ cancel }) => {
                  openActions = null;
                  if (
                    !(await confirmation.ask({
                      title: `Disconnect ${agent.name}?`,
                      description:
                        "This agent will lose access to LastPeek. Its drafts and feedback will stay.",
                      confirmLabel: "Disconnect",
                    }))
                  )
                    cancel();
                }}
              >
                <input type="hidden" name="id" value={agent.id} />
                <Button
                  type="submit"
                  name="intent"
                  value="disconnect"
                  variant="ghost"
                  class="danger"><Icon name="close" />Disconnect</Button
                >
              </form>
            </Popover.Content>
          </Popover.Root>
        </div>
      </article>
    {:else}
      <div class="agents-empty">
        <h2>No agents connected</h2>
        <p>Add the MCP address above in your agent app to get started.</p>
      </div>
    {/each}
  </section>
  {#if editing && mobile.current}
    <section class="permission-page" aria-label={`${editing.name} permissions`}>
      <h2>{editing.name}</h2>
      {@render permissionForm()}
    </section>
  {/if}
</div>
{#if editing && !mobile.current}
  <Dialog.Root
    open={true}
    onOpenChange={(open) => {
      if (!open) void goto("/settings?tab=agents", { reset: false });
    }}
  >
    <Dialog.Content
      class="max-h-[calc(100dvh-3rem)] overflow-y-auto sm:max-w-lg"
    >
      <Dialog.Header>
        <Dialog.Title class="pr-8 [overflow-wrap:anywhere]"
          >{editing.name} permissions</Dialog.Title
        >
        <Dialog.Description
          >Choose what this connection can do.</Dialog.Description
        >
      </Dialog.Header>
      {@render permissionForm()}
    </Dialog.Content>
  </Dialog.Root>
{/if}
<ConfirmDialog bind:this={confirmation} />

{#snippet permissionForm()}
  {#if editing}
    <form
      class="permission-form"
      method="POST"
      action={`/settings?tab=agents&edit=${editing.id}&/agent`}
      use:enhance={() => {
        saving = true;
        return async ({ result, update }) => {
          try {
            await update({ reset: false, navigate: false });
            if (result.type === "success" && !result.data?.approvalPending)
              await goto("/settings?tab=agents", { reset: mobile.current });
          } finally {
            saving = false;
          }
        };
      }}
    >
      <input type="hidden" name="id" value={editing.id} />
      {#if editing.expired}<p>
          This connection has expired. Connect again from your agent app.
        </p>{:else}
        <AgentPermissions bind:selected prefix={editing.id} />
        {#if editing.requestedScopes}
          <p class="permission-note muted">
            Return to {editing.name} to finish approving access. If it doesn’t ask,
            use its reauthorize action. You don’t need to remove this connection.
          </p>
          <Button
            type="submit"
            name="intent"
            value="cancel-permissions"
            variant="outline"
            disabled={saving}>Cancel added permissions</Button
          >
        {:else if addingPermissions}
          <p class="permission-note muted">
            Your agent will ask you to approve the added access. Your existing
            connection stays.
          </p>
        {/if}
        <label class="expiry"
          >Connection expiry
          <Select
            name="expiry"
            aria-label="Connection expiry"
            class="mt-2"
            bind:value={expiry}
            options={[
              { value: "keep", label: "Keep current expiry" },
              ...agentExpiryOptions,
            ]}
          />
        </label>
      {/if}
      {#if form?.id === editing.id && form?.message}<p
          class="action-error"
          role="alert"
        >
          {form.message}
        </p>{/if}
      <p class="connection-dates muted">
        Connected {date(editing.createdAt)}<br />{editing.expiresAt
          ? `Expires ${date(editing.expiresAt)}`
          : "Until disconnected"}
      </p>
      <div class="edit-actions">
        <Button variant="outline" href="/settings?tab=agents">Cancel</Button>
        {#if !editing.expired}<Button
            type="submit"
            disabled={saving || awaitingApproval}
            >{saving
              ? "Saving…"
              : awaitingApproval
                ? "Awaiting approval"
                : addingPermissions
                  ? "Add permissions"
                  : "Save changes"}</Button
          >{/if}
      </div>
    </form>
  {/if}
{/snippet}

<style>
  .permission-form {
    display: block;
  }
  .agents-page {
    display: grid;
    gap: 24px;
    min-width: 0;
  }
  .agents-main {
    min-width: 0;
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--line);
  }
  h2 {
    font-size: 15px;
    margin: 0;
    font-weight: 600;
  }
  .muted {
    color: var(--muted-foreground);
  }
  .connection-row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 72px;
    padding: 12px 0;
    border-bottom: 1px solid var(--line);
  }
  .connection-info {
    flex: 1;
    min-width: 0;
  }
  .connection-info h2 {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .connection-info p {
    font-size: 13px;
    margin: 3px 0 0;
  }
  .row-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .connect-card {
    min-width: 0;
    padding: 16px;
    border: 1px solid var(--line);
    border-radius: 12px;
  }
  .connect-card p {
    color: var(--muted-foreground);
    font-size: 13px;
    line-height: 1.6;
    margin: 12px 0 16px;
  }
  .endpoint {
    position: relative;
  }
  .endpoint :global(input) {
    display: block;
    height: 44px;
    padding-right: 44px;
    font-family: monospace;
    font-size: 12px;
  }
  .endpoint :global(.copy-address) {
    position: absolute;
    top: 0;
    right: 0;
    width: 44px;
    height: 44px;
    border-radius: 6px;
  }
  .agents-empty {
    padding: 32px 16px;
    text-align: center;
  }
  .agents-empty h2 {
    font-size: 18px;
  }
  .agents-empty p {
    color: var(--muted-foreground);
    font-size: 13px;
    margin: 8px auto 0;
  }
  .permission-page {
    display: none;
  }
  .permission-note,
  .connection-dates {
    font-size: 12px;
    line-height: 1.6;
    margin-top: 20px;
  }
  .expiry {
    margin-top: 24px;
  }
  .edit-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 24px;
  }
  @media (max-width: 600px) {
    .show-permissions .connect-card,
    .show-permissions .agents-main {
      display: none;
    }
    .show-permissions .permission-page {
      display: block;
    }
    .permission-page h2 {
      font-size: 20px;
      margin-bottom: 24px;
      overflow-wrap: anywhere;
    }
  }
</style>
