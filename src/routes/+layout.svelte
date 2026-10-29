<script lang="ts">
  import "../app.css";
  let { children } = $props();
</script>

<svelte:head
  ><title>LastPeek — A second pair of eyes</title><meta
    name="description"
    content="A little space for a second opinion before you post. Private drafts, thoughtful feedback."
  /><meta property="og:title" content="Take a peek on LastPeek" /><meta
    property="og:description"
    content="A friend has something they’d like your thoughts on. Open their private review link."
  /><meta name="robots" content="noindex,nofollow,noarchive" /></svelte:head
>
<div class="app-content">{@render children()}</div>
<footer class="footer-note">
  LastPeek · <a href="https://github.com/AlexanderHeffernan/LastPeek"
    >Source code</a
  > · AGPLv3
</footer>
