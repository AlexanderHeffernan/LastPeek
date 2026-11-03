<script lang="ts">
  import Brand from "$lib/components/Brand.svelte";
  import AgentPermissions from "$lib/components/AgentPermissions.svelte";
  import UserIdentity from "$lib/components/UserIdentity.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Select } from "$lib/components/ui/select/index.js";
  import {
    agentExpiryOptions,
    agentScopes,
    type AgentScope,
  } from "$lib/agents";
  import { untrack } from "svelte";
  import type { PageProps } from "./$types";
  let { data, form }: PageProps = $props();
  let expiry = $state("90");
  let connection = $state(
    untrack(() => (data.upgrades.length === 1 ? data.upgrades[0].id : "")),
  );
  const upgrade = $derived(
    data.upgrades.find((item) => item.id === connection),
  );
  let selected = $state<AgentScope[]>(untrack(() => initialScopes()));
  $effect(() => {
    connection;
    selected = untrack(() => initialScopes());
  });
  function initialScopes() {
    return (
      upgrade
        ? upgrade.scopes.filter((scope) =>
            data.authorization.scopes.includes(scope),
          )
        : data.authorization.scopes.filter(
            (scope) => scope.endsWith(":read") && scope !== "x:read",
          )
    ).filter((scope) => agentScopes.some((item) => item === scope));
  }
</script>

<svelte:head><title>Connect an agent · LastPeek</title></svelte:head>
<main class="consent" aria-label="Agent authorization">
  <Brand />
  <h1>
    {upgrade ? "Update" : "Connect"}
    {data.authorization.name}{upgrade ? " access?" : "?"}
  </h1>
  <p>
    {upgrade
      ? "Approve access for your existing connection. Its expiry stays the same."
      : "This app is asking to use LastPeek on your behalf."}
  </p>
  <div class="identity">
    Connection destination: <strong>{data.authorization.callbackHost}</strong>
  </div>
  {#if data.account}
    <form method="POST">
      <section class="account" aria-label="Connecting as">
        <span class="account-label">Connecting as</span>
        <UserIdentity
          name={data.account.name}
          avatarId={data.account.avatar}
          handle={data.account.handle}
          showPresence={false}
        />
      </section>
      {#if data.upgrades.length}
        <label class="expiry"
          >Connection
          <Select
            name="connection"
            aria-label="Connection"
            bind:value={connection}
            options={[
              { value: "", label: "New connection" },
              ...data.upgrades.map((item) => ({
                value: item.id,
                label: `Connected ${new Date(item.createdAt).toLocaleString()}`,
              })),
            ]}
          />
        </label>
      {/if}
      <AgentPermissions
        bind:selected
        available={upgrade
          ? upgrade.scopes.filter((scope) =>
              data.authorization.scopes.includes(scope),
            )
          : data.authorization.scopes}
      />
      {#if !upgrade}<label class="expiry"
          >Connection expiry
          <Select
            name="expiry"
            aria-label="Connection expiry"
            class="mt-2"
            bind:value={expiry}
            options={[...agentExpiryOptions]}
          />
        </label>{/if}
      <p class="terms">
        Change access or disconnect at any time in Settings → Agents. This does
        not allow deleting drafts, changing account security or posting to X.
      </p>
      {#if form?.message}<p class="error" role="alert">{form.message}</p>{/if}
      <div class="actions">
        <Button type="submit" name="intent" value="deny" variant="outline"
          >Cancel</Button
        ><Button
          type="submit"
          name="intent"
          value="approve"
          disabled={!selected.length}
          >{upgrade ? "Add permissions" : "Allow connection"}</Button
        >
      </div>
    </form>
  {:else}
    <p>Sign in to LastPeek, then return to this tab to choose permissions.</p>
    <Button href="/login" target="_blank" rel="noopener">Sign in</Button>
    <Button href={undefined} onclick={() => location.reload()} variant="outline"
      >I’ve signed in</Button
    >
  {/if}
</main>

<style>
  .consent {
    max-width: 520px;
    margin: 48px auto;
    padding: 24px;
  }
  h1 {
    font-size: 25px;
    margin-top: 36px;
    overflow-wrap: anywhere;
  }
  p {
    color: var(--muted-foreground);
    line-height: 1.6;
  }
  .identity {
    font-size: 12px;
    color: var(--muted-foreground);
    overflow-wrap: anywhere;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--line);
  }
  .account {
    display: grid;
    gap: 8px;
    margin: 24px 0;
    padding: 16px;
    border: 1px solid var(--line);
    border-radius: 12px;
  }
  .account-label {
    color: var(--muted-foreground);
    font-size: 13px;
  }
  strong {
    color: var(--foreground);
  }
  .terms {
    font-size: 12px;
    margin: 24px 0;
  }
  .expiry {
    margin-top: 24px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
  }
  .error {
    color: var(--destructive);
  }
</style>
