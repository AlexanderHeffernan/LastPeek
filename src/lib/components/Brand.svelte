<script lang="ts">
  import Icon from "./Icon.svelte";
  let { href = "/" }: { href?: string } = $props();
</script>

<a class="brand" {href} aria-label="LastPeek home"
  ><span class="brand-mark"><Icon name="eye" size={23} /></span>LastPeek<span
    class="beta">EARLY ACCESS</span
  ></a
>
