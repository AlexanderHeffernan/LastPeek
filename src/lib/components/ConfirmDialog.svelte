<script lang="ts">
  import { onDestroy } from "svelte";
  import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";

  type Confirmation = {
    title: string;
    description: string;
    confirmLabel: string;
    cancelLabel?: string;
    destructive?: boolean;
  };
  let open = $state(false);
  let confirmation = $state<Confirmation>({
    title: "",
    description: "",
    confirmLabel: "Continue",
  });
  let resolve: ((accepted: boolean) => void) | undefined;
  function answer(accepted: boolean) {
    const pending = resolve;
    resolve = undefined;
    open = false;
    pending?.(accepted);
  }
  export function ask(value: Confirmation): Promise<boolean> {
    answer(false);
    confirmation = value;
    open = true;
    return new Promise((done) => {
      resolve = done;
    });
  }
  onDestroy(() => answer(false));
</script>

<AlertDialog.Root
  bind:open
  onOpenChange={(value) => {
    if (!value) answer(false);
  }}
>
  <AlertDialog.Content>
    <AlertDialog.Header class="text-left place-items-start">
      <AlertDialog.Title class="text-xl font-semibold tracking-tight"
        >{confirmation.title}</AlertDialog.Title
      >
      <AlertDialog.Description class="text-sm leading-relaxed"
        >{confirmation.description}</AlertDialog.Description
      >
    </AlertDialog.Header>
    <AlertDialog.Footer
      class="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end"
    >
      <AlertDialog.Cancel onclick={() => answer(false)}
        >{confirmation.cancelLabel || "Cancel"}</AlertDialog.Cancel
      >
      <AlertDialog.Action
        variant={confirmation.destructive === false ? "default" : "destructive"}
        onclick={() => answer(true)}
        >{confirmation.confirmLabel}</AlertDialog.Action
      >
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
