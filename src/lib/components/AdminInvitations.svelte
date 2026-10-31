<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Select } from "$lib/components/ui/select/index.js";
  import Icon from "$lib/components/Icon.svelte";
  import type { AdminData } from "$lib/admin";
  let {
    invitations,
    owner,
    send,
  }: {
    invitations: AdminData["invitations"];
    owner: boolean;
    send: (command: object) => Promise<any>;
  } = $props();
  let dialog = $state<HTMLDialogElement>(),
    email = $state(""),
    plan = $state("free");
  let link = $state(""),
    busy = $state(false),
    failure = $state(""),
    copied = $state(false);
  let revoke = $state<string | null>(null),
    query = $state(""),
    filter = $state("all");
  const status = (invitation: AdminData["invitations"][number]) =>
    invitation.used_at
      ? "Accepted"
      : invitation.revoked_at
        ? "Revoked"
        : new Date(invitation.expires_at) <= new Date()
          ? "Expired"
          : "Pending";
  const date = (value: string) =>
    new Date(value).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  const visible = $derived(
    invitations.filter(
      (invitation) =>
        invitation.email.toLowerCase().includes(query.trim().toLowerCase()) &&
        (filter === "all" || status(invitation).toLowerCase() === filter),
    ),
  );
  async function create(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    failure = "";
    try {
      const result = await send({
        action: "invite",
        email: email.trim().toLowerCase(),
        plan,
      });
      link = result.inviteURL;
    } catch (cause) {
      failure =
        cause instanceof Error ? cause.message : "Couldn’t create invitation.";
    } finally {
      busy = false;
    }
  }
  async function revokeLink() {
    if (!revoke) return;
    busy = true;
    failure = "";
    try {
      await send({ action: "revoke-invitation", id: revoke });
      revoke = null;
      dialog?.close();
    } catch (cause) {
      failure =
        cause instanceof Error ? cause.message : "Couldn’t revoke invitation.";
    } finally {
      busy = false;
    }
  }
</script>

<div class="heading">
  <h2>Invitations</h2>
  {#if owner}<Button
      onclick={() => {
        link = "";
        email = "";
        plan = "free";
        failure = "";
        copied = false;
        revoke = null;
        dialog?.showModal();
      }}><Icon name="plus" size={16} />Invite</Button
    >{/if}
</div>
<div class="filters">
  <Input
    type="search"
    aria-label="Search invitations"
    placeholder="Search by email"
    bind:value={query}
  />
  <Select
    aria-label="Invitation status"
    bind:value={filter}
    options={[
      { value: "all", label: "All statuses" },
      { value: "pending", label: "Pending" },
      { value: "accepted", label: "Accepted" },
      { value: "expired", label: "Expired" },
      { value: "revoked", label: "Revoked" },
    ]}
  />
</div>
<table aria-label="Invitations">
  <thead
    ><tr
      ><th>Email</th><th>Plan</th><th>Status</th><th>Created</th><th>Expires</th
      >{#if owner}<th>Actions</th>{/if}</tr
    ></thead
  >
  <tbody>
    {#each visible as invitation (invitation.id)}
      <tr>
        <th scope="row">{invitation.email}</th>
        <td data-label="Plan">{invitation.plan === "pro" ? "Pro" : "Free"}</td>
        <td data-label="Status"
          ><Badge variant="outline">{status(invitation)}</Badge></td
        >
        <td data-label="Created">{date(invitation.created_at)}</td>
        <td data-label="Expires">{date(invitation.expires_at)}</td>
        {#if owner}<td data-label="Actions">
            {#if status(invitation) === "Pending"}<Button
                variant="outline"
                aria-label={`Revoke invitation for ${invitation.email}`}
                onclick={() => {
                  revoke = invitation.id;
                  email = invitation.email;
                  failure = "";
                  dialog?.showModal();
                }}>Revoke</Button
              >{:else}<span class="muted">—</span>{/if}
          </td>{/if}
      </tr>
    {:else}<tr
        ><td class="empty" colspan={owner ? 6 : 5}
          >{invitations.length
            ? "No invitations match."
            : "No invitations yet."}</td
        ></tr
      >{/each}
  </tbody>
</table>
<dialog
  class="confirm-dialog"
  bind:this={dialog}
  aria-label={revoke ? "Revoke invitation" : "Invite an author"}
>
  <header class="heading">
    <h2>{revoke ? "Revoke invitation?" : "Invite an author"}</h2>
    <Button
      variant="ghost"
      size="icon"
      aria-label="Close invitation"
      disabled={busy}
      onclick={() => dialog?.close()}><Icon name="close" /></Button
    >
  </header>
  {#if revoke}<p>{email}</p>{:else if link}
    <p>{email} · {plan === "pro" ? "Pro" : "Free"} · valid for 7 days</p>
    <label
      >Invitation link<Input
        readonly
        value={link}
        onclick={(event) => event.currentTarget.select()}
      /></label
    >
    <p class="small muted">
      Copy this link before closing. It is only shown once.
    </p>
    <Button
      onclick={async () => {
        try {
          await navigator.clipboard.writeText(link);
          copied = true;
        } catch {
          failure = "Copy the link from the field above.";
        }
      }}>{copied ? "Copied" : "Copy invitation"}</Button
    >
  {:else}
    <form class="stack" onsubmit={create}>
      <label
        >Email<Input
          type="email"
          bind:value={email}
          required
          maxlength={254}
        /></label
      >
      <label
        >Plan<Select
          aria-label="Plan"
          bind:value={plan}
          options={[
            { value: "free", label: "Free" },
            { value: "pro", label: "Pro" },
          ]}
        /></label
      >
      <p class="small muted">
        Single-use · valid for 7 days. Replaces any pending invitation for this
        email.
      </p>
      <Button type="submit" disabled={busy}
        >{busy ? "Creating…" : "Create invitation"}</Button
      >
    </form>
  {/if}
  {#if failure}<p role="alert" class="error">{failure}</p>{/if}
  {#if revoke}<Button variant="destructive" disabled={busy} onclick={revokeLink}
      >Revoke invitation</Button
    >{/if}
</dialog>

<style>
  h2 {
    margin: 0;
    font-size: 24px;
  }
  .heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 20px;
  }
  .filters {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 180px;
    gap: 12px;
    margin-bottom: 20px;
    align-items: center;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  th,
  td {
    text-align: left;
    padding: 14px 10px;
    border-bottom: 1px solid var(--border);
    overflow-wrap: anywhere;
  }
  thead th {
    color: var(--muted-foreground);
    font-weight: 400;
  }
  tbody th {
    font-weight: 400;
  }
  .empty {
    padding: 32px 0;
    color: var(--muted-foreground);
  }
  label {
    display: grid;
    gap: 8px;
  }
  @media (max-width: 700px) {
    .filters {
      grid-template-columns: minmax(0, 1fr);
    }
    table,
    tbody {
      display: block;
    }
    thead {
      display: none;
    }
    tr {
      display: grid;
      gap: 10px;
      padding: 16px 0;
      border-bottom: 1px solid var(--border);
    }
    th,
    td {
      padding: 0;
      border: 0;
    }
    td[data-label] {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    td[data-label]::before {
      content: attr(data-label);
      color: var(--muted-foreground);
    }
  }
</style>
