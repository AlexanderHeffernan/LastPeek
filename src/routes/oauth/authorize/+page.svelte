<script lang="ts">
  import Brand from "$lib/components/Brand.svelte";
  import AgentPermissions from "$lib/components/AgentPermissions.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Select } from "$lib/components/ui/select/index.js";
  import { avatarURL } from "$lib/contracts";
  import { agentExpiryOptions } from "$lib/agents";
  import { untrack } from "svelte";
  import type { PageProps } from "./$types";
  let { data, form }: PageProps = $props();
  let expiry = $state("90");
  let selected = $state(
    untrack(() =>
      data.authorization.scopes.filter((scope) => scope.endsWith(":read")),
    ),
  );
</script>

<svelte:head><title>Connect an agent · LastPeek</title></svelte:head>
<main class="consent" aria-label="Agent authorization">
  <Brand />
  <h1>Connect {data.authorization.name}?</h1>
  <p>This app is asking to use LastPeek on your behalf.</p>
  <div class="identity">
    Connection destination: <strong>{data.authorization.callbackHost}</strong>
  </div>
  {#if data.account}
    <form method="POST">
      <section class="account" aria-label="Connecting as">
        <span class="avatar" aria-hidden="true">
          {#if data.account.avatar}<img
              src={avatarURL(data.account.avatar)}
              alt=""
            />{:else}{data.account.name.slice(0, 1).toUpperCase()}{/if}
        </span>
        <div class="account-details">
          <span class="account-label">Connecting as</span>
          <strong>{data.account.name}</strong>
          {#if data.account.handle}<span class="account-handle"
              >{data.account.handle.startsWith("@")
                ? data.account.handle
                : `@${data.account.handle}`}</span
            >{/if}
        </div>
      </section>
      <AgentPermissions bind:selected available={data.authorization.scopes} />
      <label class="expiry"
        >Connection expiry
        <Select
          name="expiry"
          aria-label="Connection expiry"
          class="mt-2"
          bind:value={expiry}
          options={[...agentExpiryOptions]}
        />
      </label>
      <p class="terms">
        Change access or disconnect at any time in Settings → Agents. This does
        not allow deletion, account changes or posting to X.
      </p>
      {#if form?.message}<p class="error" role="alert">{form.message}</p>{/if}
      <div class="actions">
        <Button type="submit" name="intent" value="deny" variant="outline"
          >Cancel</Button
        ><Button
          type="submit"
          name="intent"
          value="approve"
          disabled={!selected.length}>Allow connection</Button
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
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 24px 0;
    padding: 16px;
    border: 1px solid var(--line);
    border-radius: 12px;
  }
  .account .avatar {
    flex-shrink: 0;
  }
  .account-details {
    min-width: 0;
    display: grid;
    gap: 3px;
    overflow-wrap: anywhere;
  }
  .account-label,
  .account-handle {
    color: var(--muted-foreground);
    font-size: 13px;
  }
  .account .avatar img {
    border-radius: 50%;
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
