<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import FriendControl from "$lib/components/FriendControl.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import Brand from "$lib/components/Brand.svelte";
  import { avatarURL } from "$lib/contracts";
  let { data } = $props();
  let email = $state(""),
    message = $state(""),
    busy = $state(false);
  const friends = $derived(data.connections.filter((c) => c.accepted));
  const incoming = $derived(
    data.connections.filter((c) => !c.accepted && c.incoming),
  );
  const outgoing = $derived(
    data.connections.filter((c) => !c.accepted && !c.incoming),
  );
  async function requestFriend(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    message = "";
    try {
      const response = await fetch("/api/friends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "email", email: email.trim() }),
      });
      if (!response.ok)
        throw new Error(
          (await response.json()).message || "Couldn’t send this request.",
        );
      email = "";
      await invalidateAll();
    } catch (cause) {
      message = (cause as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Friends · LastPeek</title></svelte:head>
<main class="friends-page" aria-label="Friends">
  <section class="friends-main" aria-label="Your friends">
    <header>
      <h1>Friends</h1>
      <span class="muted">{friends.length}</span>
    </header>
    {#each friends as person (person.id)}{@render personRow(person)}{:else}<div
        class="friends-empty"
      >
        <div class="empty-mascot"><Brand markOnly decorative /></div>
        <h2>A little quiet here.</h2>
        <p>Add a friend to send them private reviews.</p>
      </div>{/each}
  </section>
  <aside aria-label="Friend invitations">
    <details class="requests" open>
      <summary
        ><span
          ><Icon name="users" size={18} />Requests
          <span class="count">{incoming.length}</span></span
        ><Icon name="down" size={16} /></summary
      >
      <section aria-label="Friend requests">
        {#each incoming as person (person.id)}{@render personRow(
            person,
          )}{:else}<p class="small muted">No pending requests.</p>{/each}
      </section>
      {#if outgoing.length}<section aria-label="Sent requests">
          <h2>Sent requests <span class="muted">{outgoing.length}</span></h2>
          {#each outgoing as person (person.id)}{@render personRow(
              person,
            )}{/each}
        </section>{/if}
    </details>
    <form onsubmit={requestFriend} class="add-friend">
      <h2><label for="friend-email">Add by email</label></h2>
      <Input
        id="friend-email"
        type="email"
        bind:value={email}
        required
        maxlength={254}
        placeholder="friend@example.com"
        autocomplete="off"
      />
      <Button type="submit" disabled={busy}
        >{busy ? "Sending…" : "Send request"}</Button
      >
      {#if message}<p class="action-error" role="alert">{message}</p>{/if}
    </form>
  </aside>
</main>
{#snippet personRow(person: (typeof data.connections)[number])}
  <div class="person-row">
    <span class="avatar" aria-hidden="true"
      >{#if person.avatar_id}<img
          src={avatarURL(person.avatar_id)}
          alt=""
        />{:else}{person.name.slice(0, 1).toUpperCase()}{/if}
      {#if person.accepted && person.active}<span
          class="activity"
          title="Active recently"
        ></span>{/if}
    </span>
    <div class="person-name">
      <strong title={person.name}>{person.name}</strong>{#if person.handle}<span
          class="small muted"
          >{person.handle.startsWith("@")
            ? person.handle
            : `@${person.handle}`}</span
        >{/if}{#if person.accepted && person.active}<span class="sr-only"
          >Active recently</span
        >{/if}
    </div>
    <FriendControl userId={person.user_id} name={person.name} manage compact />
  </div>
{/snippet}

<style>
  .friends-page {
    display: grid;
    grid-template-columns: minmax(0, 600px) minmax(0, 1fr);
    gap: 24px;
    min-height: 100dvh;
  }
  .friends-main {
    min-width: 0;
    border-inline: 1px solid var(--line);
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 60px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--line);
  }
  h1 {
    font-size: 20px;
    margin: 0;
  }
  h2 {
    font-size: 15px;
    margin: 0;
  }
  aside {
    min-width: 0;
    padding: 18px 16px 40px 0;
  }
  summary,
  summary > span {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  summary {
    justify-content: space-between;
    min-height: 44px;
    cursor: pointer;
    font-weight: 600;
    list-style: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 4px;
    border-radius: 6px;
  }
  summary :global(> svg) {
    transition: transform 0.15s;
  }
  details[open] summary :global(> svg) {
    transform: rotate(180deg);
  }
  .count {
    background: var(--accent);
    color: var(--foreground);
    font-size: 12px;
    border-radius: 20px;
    min-width: 22px;
    text-align: center;
    padding: 2px 6px;
  }
  .person-row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 72px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--line);
  }
  .avatar {
    position: relative;
    flex-shrink: 0;
    overflow: visible;
  }
  .avatar img {
    border-radius: 50%;
  }
  .activity {
    position: absolute;
    bottom: 0;
    right: 0;
    width: 9px;
    height: 9px;
    border: 2px solid var(--background);
    border-radius: 50%;
    background: var(--primary);
  }
  .person-name {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
  }
  .person-name strong {
    font-size: 15px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .person-name > span:not(.sr-only) {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  aside .person-row {
    padding: 10px 0;
    gap: 8px;
  }
  aside section:last-child .person-row:last-child {
    border-bottom: 0;
  }
  aside .person-name .muted {
    display: none;
  }
  aside section h2 {
    margin-top: 24px;
    color: var(--muted-foreground);
    font-size: 13px;
  }
  .add-friend {
    display: grid;
    gap: 12px;
    margin-top: 28px;
    padding-top: 24px;
    border-top: 1px solid var(--line);
  }
  .add-friend :global(button) {
    justify-self: start;
  }
  .friends-empty {
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
  .friends-empty h2 {
    margin: 0;
    font-size: 24px;
    letter-spacing: -0.6px;
  }
  .friends-empty p {
    max-width: 300px;
    margin: 12px auto 0;
    color: var(--muted-foreground);
    font-size: 15px;
  }
  @media (max-width: 1000px) {
    .friends-page {
      grid-template-columns: minmax(0, 1fr);
      gap: 0;
      align-content: start;
    }
    aside {
      grid-row: 1;
      padding: 8px 16px 20px;
      border-bottom: 1px solid var(--line);
    }
    .add-friend {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      margin-top: 16px;
      padding-top: 16px;
    }
    .add-friend h2,
    .add-friend .action-error {
      grid-column: 1/-1;
    }
    .friends-main {
      border: 0;
    }
  }
  @media (max-width: 360px) {
    .person-name .muted {
      display: none;
    }
    .add-friend {
      grid-template-columns: minmax(0, 1fr);
    }
    .add-friend :global(button) {
      width: 100%;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    summary :global(> svg) {
      transition: none;
    }
  }
</style>
