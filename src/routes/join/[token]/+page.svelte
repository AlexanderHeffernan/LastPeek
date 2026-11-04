<script lang="ts">
  import Landing from "$lib/components/landing/Landing.svelte";
  let { data, form } = $props();
</script>

<Landing
  {...data}
  auth={{
    kind: "join",
    invite: data.invite,
    email: data.email,
    inviter: data.inviter,
  }}
  {form}
/>
