<script lang="ts">
  import DraftWorkspace from "$lib/components/DraftWorkspace.svelte";
  let { data, form } = $props();
</script>

<DraftWorkspace {data} {form} />
