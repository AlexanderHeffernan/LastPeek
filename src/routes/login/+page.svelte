<script lang="ts">
  import Landing from "$lib/components/landing/Landing.svelte";
  let { data, form } = $props();
</script>

<Landing
  {...data}
  auth={{
    kind: "signin",
    xCancelled: data.xCancelled,
    xUnlinked: data.xUnlinked,
    linkedinCancelled: data.linkedinCancelled,
    linkedinUnlinked: data.linkedinUnlinked,
  }}
  {form}
/>
