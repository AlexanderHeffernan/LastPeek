<script lang="ts">
  import { Select as SelectPrimitive } from "bits-ui";
  import Icon from "$lib/components/Icon.svelte";
  import { cn } from "$lib/utils.js";

  // Shadcn Vega's Select, composed for the app's single-value fields.
  let {
    value = $bindable(""),
    options,
    disabled = false,
    name,
    id,
    "aria-label": ariaLabel,
    class: className,
  }: {
    value?: string;
    options: { value: string; label: string }[];
    disabled?: boolean;
    name?: string;
    id?: string;
    "aria-label"?: string;
    class?: string;
  } = $props();
</script>

<SelectPrimitive.Root
  type="single"
  bind:value
  allowDeselect={false}
  {disabled}
  {name}
  items={options}
>
  <SelectPrimitive.Trigger
    {id}
    aria-label={ariaLabel}
    data-slot="select-trigger"
    class={cn(
      "border-input bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 flex min-h-11 w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
  >
    <span data-slot="select-value"
      >{options.find((option) => option.value === value)?.label ?? value}</span
    >
    <Icon name="down" size={16} />
  </SelectPrimitive.Trigger>
  <!-- Keep the menu in its dialog's top layer instead of portalling behind it. -->
  <!-- Option clicks must not reactivate a wrapping label's trigger. -->
  <SelectPrimitive.Content
    onclick={(event) => event.preventDefault()}
    sideOffset={4}
    align="start"
    data-slot="select-content"
    class="bg-popover text-popover-foreground border-border relative z-50 max-h-(--bits-select-content-available-height) min-w-(--bits-select-anchor-width) overflow-y-auto rounded-md border p-1 shadow-lg"
  >
    <SelectPrimitive.Viewport>
      {#each options as option (option.value)}
        <SelectPrimitive.Item
          value={option.value}
          label={option.label}
          data-slot="select-item"
          class="data-highlighted:bg-accent data-highlighted:text-accent-foreground relative flex min-h-11 w-full cursor-default items-center justify-between gap-4 rounded-sm px-3 py-2 text-sm outline-none select-none"
        >
          {#snippet children({ selected })}
            <span>{option.label}</span>
            {#if selected}<Icon name="check" size={16} />{/if}
          {/snippet}
        </SelectPrimitive.Item>
      {/each}
    </SelectPrimitive.Viewport>
  </SelectPrimitive.Content>
</SelectPrimitive.Root>
