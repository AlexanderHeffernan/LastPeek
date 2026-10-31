<script lang="ts">
  import { Checkbox as CheckboxPrimitive } from "bits-ui";
  import Icon from "$lib/components/Icon.svelte";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    checked = $bindable(false),
    indeterminate = $bindable(false),
    value = "on",
    class: className,
    ...restProps
  }: Omit<CheckboxPrimitive.RootProps, "children" | "child"> = $props();
</script>

<CheckboxPrimitive.Root
  bind:ref
  bind:checked
  bind:indeterminate
  {value}
  data-slot="checkbox"
  class={cn(
    "border-input bg-input/30 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground data-[state=indeterminate]:border-primary aria-invalid:border-destructive focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 flex size-5 shrink-0 items-center justify-center rounded-[4px] border shadow-xs transition-shadow focus-visible:ring-3 aria-invalid:ring-3 relative outline-none after:absolute after:-inset-2 disabled:cursor-not-allowed disabled:opacity-50",
    className,
  )}
  {...restProps}
>
  {#snippet children({ checked, indeterminate })}
    <span
      data-slot="checkbox-indicator"
      class="grid place-content-center text-current"
    >
      {#if indeterminate}<Icon name="minus" size={14} />{:else if checked}<Icon
          name="check"
          size={14}
        />{/if}
    </span>
  {/snippet}
</CheckboxPrimitive.Root>
