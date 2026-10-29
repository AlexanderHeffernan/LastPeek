<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { page } from "$app/state";
  import Brand from "$lib/components/Brand.svelte";
  import Icon from "$lib/components/Icon.svelte";
  let { data, children } = $props();
</script>

<header class="topbar">
  <Brand />
  <nav class="row" aria-label="Account">
    <a
      href="/"
      class="nav-link"
      aria-current={page.url.pathname === "/" ? "page" : undefined}
      ><Icon name="drafts" size={18} />Drafts</a
    ><Button
      variant="ghost"
      class="icon-button"
      href="/settings"
      aria-current={page.url.pathname === "/settings" ? "page" : undefined}
      aria-label="Account settings"><Icon name="settings" size={18} /></Button
    ><span
      class="avatar"
      style="width:30px;height:30px;font-size:11px"
      title={data.user.name}>{data.user.name.slice(0, 1).toUpperCase()}</span
    >
  </nav>
</header>
{#key page.url.pathname}{@render children()}{/key}
