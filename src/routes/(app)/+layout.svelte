<script lang="ts">
  import { page } from "$app/state";
  import Brand from "$lib/components/Brand.svelte";
  import Icon from "$lib/components/Icon.svelte";
  let { data, children } = $props();
</script>

<header class="topbar">
  <Brand />
  <nav class="row" aria-label="Account">
    <a href="/" class="small muted">Your drafts</a><a
      class="icon-button button quiet"
      href="/settings"
      aria-label="Account settings"><Icon name="settings" size={18} /></a
    ><span
      class="avatar"
      style="width:30px;height:30px;font-size:11px"
      title={data.user.name}>{data.user.name.slice(0, 1).toUpperCase()}</span
    >
  </nav>
</header>
{#key page.url.pathname}{@render children()}{/key}
