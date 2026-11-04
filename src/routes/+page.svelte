<script lang="ts">
  import DraftWorkspace from "$lib/components/DraftWorkspace.svelte";
  import Landing from "$lib/components/landing/Landing.svelte";
  let { data, form } = $props();
</script>

{#if data.landing}
  <Landing {...data} />
{:else}
  <DraftWorkspace {data} {form} />
{/if}
