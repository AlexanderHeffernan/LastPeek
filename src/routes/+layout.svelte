<script lang="ts">
  import "../app.css";
  import { page } from "$app/state";
  import { setContext } from "svelte";
  import SiteAdmin from "$lib/components/SiteAdmin.svelte";
  import PortraitOrientation from "$lib/components/PortraitOrientation.svelte";
  import AppShell from "$lib/components/AppShell.svelte";
  import { appleLaunchImages } from "$lib/pwa";
  import { referrerPolicy } from "$lib/referrer-policy";
  let { children } = $props();
  const shellUser = $derived(
    page.route.id?.startsWith("/(app)")
      ? page.data.user
      : page.route.id === "/r/[token]"
        ? page.data.reviewer
        : null,
  );
  let adminDialog = $state<HTMLDialogElement>();
  let adminOpened = $state(false),
    adminVisible = $state(false);

  function closeAdmin() {
    for (const dialog of adminDialog?.querySelectorAll<HTMLDialogElement>(
      "dialog[open]",
    ) || [])
      dialog.close();
    adminDialog?.close();
  }

  function toggleAdmin() {
    if (!page.data.canViewAdmin || !adminDialog) return;
    if (adminDialog.open) closeAdmin();
    else {
      adminOpened = true;
      adminVisible = true;
      adminDialog.showModal();
    }
  }
  setContext("open-siteadmin", toggleAdmin);

  function openAdmin(event: KeyboardEvent) {
    if (
      !page.data.canViewAdmin ||
      event.key !== "~" ||
      event.repeat ||
      event.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.defaultPrevented
    )
      return;
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
      )
    )
      return;
    event.preventDefault();
    toggleAdmin();
  }
</script>

<svelte:window onkeydown={openAdmin} />

<svelte:head
  ><title>LastPeek — A second pair of eyes</title>
  <!-- Response headers alone cannot update the document after client-side navigation. -->
  <meta name="referrer" content={referrerPolicy(page.route.id)} />
  {#if page.route.id !== "/r/[token]"}<meta
      name="description"
      content="A little space for a second opinion before you post. Private drafts, thoughtful feedback."
    /><meta property="og:title" content="Take a peek on LastPeek" /><meta
      property="og:description"
      content="A friend has something they’d like your thoughts on. Open their private review link."
    />{/if}<meta name="robots" content="noindex,nofollow,noarchive" />
  {#each appleLaunchImages as image}
    <link
      rel="apple-touch-startup-image"
      href={image.href}
      media={image.media}
    />
  {/each}
</svelte:head>
<div class="app-content" class:signed-in={!!shellUser}>
  {#if shellUser}
    <AppShell user={shellUser} canViewAdmin={page.data.canViewAdmin}>
      {@render children()}
    </AppShell>
  {:else}
    {@render children()}
  {/if}
</div>
<PortraitOrientation />
{#if page.data.canViewAdmin}
  <dialog
    bind:this={adminDialog}
    class="siteadmin-overlay"
    aria-label="Site admin overlay"
    onpointerdown={(event) => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
      )
        closeAdmin();
    }}
    onclose={() => {
      adminVisible = false;
    }}
  >
    <div class="admin-overlay-scroll">
      {#if adminOpened}<SiteAdmin
          active={adminVisible}
          onclose={closeAdmin}
        />{/if}
    </div>
  </dialog>
{/if}
{#if !shellUser}
  <footer class="footer-note">
    LastPeek · <a href="https://github.com/AlexanderHeffernan/LastPeek"
      >Source code</a
    > · AGPLv3
  </footer>
{/if}

<style>
  .siteadmin-overlay {
    inset: env(safe-area-inset-top) env(safe-area-inset-right)
      env(safe-area-inset-bottom) env(safe-area-inset-left);
    width: min(
      1100px,
      calc(100% - 32px - env(safe-area-inset-left) - env(safe-area-inset-right))
    );
    max-width: none;
    height: min(92dvh, 1000px);
    max-height: calc(
      100dvh - 32px - env(safe-area-inset-top) - env(safe-area-inset-bottom)
    );
    padding: 0;
    margin: auto;
    border: 1px solid var(--line);
    border-radius: 18px;
    background: var(--background);
    color: var(--foreground);
  }
  .siteadmin-overlay[open] {
    display: flex;
    flex-direction: column;
  }
  .siteadmin-overlay::backdrop {
    background: #0009;
    backdrop-filter: blur(3px);
  }
  .admin-overlay-scroll {
    overflow: hidden;
    min-height: 0;
    flex: 1;
  }
  :global(body:has(.siteadmin-overlay[open])) {
    overflow: hidden;
  }
  @media (max-width: 650px) {
    .siteadmin-overlay {
      width: calc(
        100% - 16px - env(safe-area-inset-left) - env(safe-area-inset-right)
      );
      height: calc(
        100dvh - 16px - env(safe-area-inset-top) - env(safe-area-inset-bottom)
      );
      max-height: calc(
        100dvh - 16px - env(safe-area-inset-top) - env(safe-area-inset-bottom)
      );
      border-radius: 12px;
    }
  }
</style>
