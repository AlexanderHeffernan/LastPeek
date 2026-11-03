<script lang="ts">
  import { getContext, onMount, tick } from "svelte";
  import type { Writable } from "svelte/store";
  import { beforeNavigate, invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import Icon from "./Icon.svelte";
  import Brand from "./Brand.svelte";

  const name = getContext<Writable<string>>("guest-name");
  let open = $state(false);
  let view = $state<"welcome" | "access" | "request">("welcome");
  let email = $state("");
  let error = $state("");
  let busy = $state(false);
  let requested = $state(false);
  let signingIn = $state(false);
  let pending: (() => void) | undefined;

  export function show(oncontinue?: () => void) {
    pending = oncontinue;
    view = oncontinue || !$name.trim() ? "welcome" : "access";
    error = "";
    open = true;
  }
  onMount(() => {
    try {
      $name = sessionStorage.getItem("reviewer-name") || "";
    } catch {
      /* A name can still be used without browser storage. */
    }
    if (!$name.trim()) open = true;
  });
  beforeNavigate((navigation) => {
    if (
      navigation.willUnload ||
      navigation.to?.url.pathname === page.url.pathname
    )
      return;
    navigation.cancel();
    show();
  });
  async function continueGuest(event: SubmitEvent) {
    event.preventDefault();
    $name = $name.trim();
    try {
      sessionStorage.setItem("reviewer-name", $name);
    } catch {
      /* Keep the in-memory name. */
    }
    const action = pending;
    pending = undefined;
    open = false;
    await tick();
    action?.();
  }
  async function requestAccount(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = "";
    try {
      const response = await fetch("/api/account-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: $name, email }),
      });
      if (!response.ok)
        throw new Error(
          (await response.json()).message || "Couldn’t send your request.",
        );
      requested = true;
    } catch (cause) {
      error = (cause as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:window
  onfocus={() => {
    if (signingIn) void invalidateAll();
  }}
/>
<svelte:document
  onvisibilitychange={() => {
    if (signingIn && document.visibilityState === "visible")
      void invalidateAll();
  }}
/>
<Dialog.Root
  bind:open
  onOpenChange={(value) => {
    if (!value) pending = undefined;
  }}
>
  <Dialog.Content class="guest-access gap-5 sm:max-w-[400px]">
    <Brand decorative />
    <Dialog.Header class="text-left">
      <Dialog.Title class="text-xl"
        >{view === "request"
          ? "Request an account"
          : view === "access"
            ? "Get a second pair of eyes before you post."
            : "Welcome to LastPeek"}</Dialog.Title
      >
      <Dialog.Description>
        {#if view === "welcome"}You’re viewing {page.data.content?.author
            .name ?? "a friend"}’s draft as a guest. Leave your name so they
          know who’s helping.
        {:else if view === "access"}Create an account to share your drafts and
          get feedback from friends.
        {:else}LastPeek is invite-only. Send a request to the site owner to
          start drafting and getting feedback of your own.{/if}
      </Dialog.Description>
    </Dialog.Header>
    {#if view === "welcome"}
      <form class="grid gap-3" onsubmit={continueGuest}>
        <label class="grid gap-2 text-sm"
          >Your name<Input
            bind:value={$name}
            required
            maxlength={80}
            autocomplete="nickname"
            placeholder="Name or username"
          /></label
        >
        <Button type="submit" class="w-full">Continue as guest</Button>
      </form>
    {:else if view === "request"}
      <form class="grid gap-3" onsubmit={requestAccount}>
        <label class="grid gap-2 text-sm"
          >Your name<Input
            bind:value={$name}
            required
            maxlength={80}
            autocomplete="name"
            disabled={requested}
          /></label
        >
        <label class="grid gap-2 text-sm"
          >Email<Input
            type="email"
            bind:value={email}
            required
            maxlength={254}
            autocomplete="email"
            disabled={requested}
          /></label
        >
        <Button type="submit" disabled={busy || requested}
          >{busy
            ? "Sending…"
            : requested
              ? "Request received"
              : "Request account"}{#if requested}<Icon
              name="check"
              size={16}
            />{/if}</Button
        >
        {#if requested}<p class="small muted m-0">
            Your request is with the site owner. You can keep reviewing as a
            guest.
          </p>{/if}
      </form>
    {/if}
    {#if view !== "request"}
      <div class="guest-signin">
        <Button
          variant="outline"
          class="w-full"
          href="/login"
          target="_blank"
          rel="noopener noreferrer"
          onclick={() => (signingIn = true)}
          >Sign in<Icon name="arrow" size={16} /></Button
        >
        <Button
          variant="ghost"
          class="w-full"
          onclick={() => {
            view = "request";
            error = "";
          }}>Request an account</Button
        >
      </div>
    {/if}
    {#if error}<p class="action-error m-0" role="alert">{error}</p>{/if}
  </Dialog.Content>
</Dialog.Root>

<style>
  .guest-signin {
    display: grid;
    gap: 8px;
    border-top: 1px solid var(--border);
    padding-top: 16px;
  }
</style>
