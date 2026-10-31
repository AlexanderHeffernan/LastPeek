<script lang="ts">
  import SiteAdmin from "$lib/components/SiteAdmin.svelte";
  import type { PageData } from "./$types";
  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Site admin · LastPeek</title></svelte:head>
<SiteAdmin initialData={data} />
