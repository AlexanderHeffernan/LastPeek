<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { page } from "$app/state";
  import Brand from "$lib/components/Brand.svelte";
  import { avatarURL } from "$lib/contracts";
  let { data, children } = $props();
</script>

<header class="topbar">
  <Brand />
  <nav class="row" aria-label="Account">
    <Button
      variant="ghost"
      class="icon-button account-link"
      href="/settings"
      aria-current={page.url.pathname === "/settings" ? "page" : undefined}
      aria-label="Account settings"
      ><span class="avatar" aria-hidden="true"
        >{#if data.user.avatar_id}<img
            src={avatarURL(data.user.avatar_id)}
            alt=""
          />{:else}{data.user.name.slice(0, 1).toUpperCase()}{/if}</span
      ></Button
    >
  </nav>
</header>
{#key page.url.pathname}{@render children()}{/key}
