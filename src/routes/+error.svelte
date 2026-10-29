<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { page } from "$app/state";
  import Brand from "$lib/components/Brand.svelte";
  import Icon from "$lib/components/Icon.svelte";
</script>

<header class="topbar"><Brand href="/login" /></header>
<main class="error-page">
  <div class="empty-icon"><Icon name="eye" size={26} /></div>
  <span class="eyebrow">{page.status}</span>
  <h1 style="margin-top:15px">
    {page.status === 404 ? "Nothing to peek at here." : "A little hiccup."}
  </h1>
  <p class="muted">{page.error?.message}</p>
  <Button variant="outline" href="/">Back to LastPeek</Button>
</main>
