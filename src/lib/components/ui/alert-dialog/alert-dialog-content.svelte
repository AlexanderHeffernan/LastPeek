<script lang="ts">
  import { AlertDialog as AlertDialogPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";
  import AlertDialogOverlay from "./alert-dialog-overlay.svelte";
  import AlertDialogPortal from "./alert-dialog-portal.svelte";
  import type { ComponentProps } from "svelte";

  let {
    ref = $bindable(null),
    class: className,
    size = "default",
    portalProps,
    ...restProps
  }: Omit<AlertDialogPrimitive.ContentProps, "child"> & {
    size?: "default" | "sm";
    portalProps?: Omit<
      ComponentProps<typeof AlertDialogPortal>,
      "children" | "child"
    >;
  } = $props();
</script>

<AlertDialogPortal {...portalProps}>
  <AlertDialogOverlay />
  <AlertDialogPrimitive.Content
    bind:ref
    data-slot="alert-dialog-content"
    data-size={size}
    class={cn(
      "data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 bg-card text-card-foreground border border-border gap-6 rounded-[20px] p-6 sm:p-7 shadow-[0_24px_80px_#0009] duration-100 max-w-[440px] data-[size=sm]:max-w-xs max-h-[calc(100dvh-2rem)] overflow-y-auto group/alert-dialog-content fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 outline-none",
      className,
    )}
    {...restProps}
  />
</AlertDialogPortal>
