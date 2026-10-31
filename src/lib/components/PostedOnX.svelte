<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Popover } from "bits-ui";
  import { invalidateAll } from "$app/navigation";
  import { xPostURLSchema } from "$lib/contracts";
  import Icon from "./Icon.svelte";
  let {
    draftId,
    link,
    confirmedURL = null,
    disabled = false,
  }: {
    draftId: string;
    link: { status: string; url: string | null } | null;
    confirmedURL?: string | null;
    disabled?: boolean;
  } = $props();
  let busy = $state(false),
    open = $state(false),
    enterURL = $state(false),
    url = $state(""),
    error = $state("");
  const linkedURL = $derived(
    confirmedURL || (link?.status === "linked" ? link.url : null),
  );
  async function choose(choice: string, value?: string) {
    busy = true;
    error = "";
    open = false;
    try {
      const response = await fetch(`/api/drafts/${draftId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "posted-link", choice, url: value }),
      });
      if (!response.ok)
        throw new Error(
          (await response.json()).message ||
            "Couldn’t save the link. Try again.",
        );
      await invalidateAll();
      enterURL = false;
    } catch (cause) {
      error = (cause as Error).message;
    } finally {
      busy = false;
    }
  }
  async function paste() {
    error = "";
    try {
      const text = await navigator.clipboard.readText();
      const parsed = xPostURLSchema.safeParse(text);
      if (!parsed.success) {
        enterURL = true;
        error = "Copy an X post link, or paste it below.";
        return;
      }
      await choose("url", parsed.data);
    } catch {
      enterURL = true;
    }
  }
</script>

<div class="posted-link">
  {#if linkedURL}
    <Button
      variant="secondary"
      href={linkedURL}
      aria-label="View on X"
      target="_blank"
      rel="noopener noreferrer">View on <Icon name="x" size={16} /></Button
    >
  {:else if link?.status === "candidate" && link.url}
    <div class="share-actions">
      <Button
        variant="outline"
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Is this your post on X?"
        >Is this it?<Icon name="arrow" size={16} /></Button
      >
      <Popover.Root bind:open>
        <Popover.Trigger
          >{#snippet child({ props })}<Button
              {...props}
              variant="outline"
              class="share-toggle"
              aria-label="Confirm X post"
              disabled={busy || disabled}><Icon name="down" size={15} /></Button
            >{/snippet}</Popover.Trigger
        >
        <Popover.Content
          class="share-menu"
          align="end"
          sideOffset={8}
          aria-label="Confirm X post"
        >
          <Button
            variant="ghost"
            onclick={() => choose("yes")}
            disabled={busy || disabled}
            ><Icon name="check" size={16} />Yes, that’s it</Button
          >
          <Button
            variant="ghost"
            onclick={() => choose("no")}
            disabled={busy || disabled}
            ><Icon name="close" size={16} />No, another post</Button
          >
        </Popover.Content>
      </Popover.Root>
    </div>
  {:else}
    <Button variant="outline" onclick={paste} disabled={busy || disabled}
      ><Icon name="copy" size={16} />{busy
        ? "Linking…"
        : "Paste post link"}</Button
    >
    {#if enterURL}
      <form
        onsubmit={(event) => {
          event.preventDefault();
          void choose("url", url);
        }}
      >
        <Input
          type="url"
          bind:value={url}
          aria-label="Posted X URL"
          placeholder="https://x.com/…/status/…"
          required
          onpaste={(event) => {
            const parsed = xPostURLSchema.safeParse(
              event.clipboardData?.getData("text"),
            );
            if (parsed.success) {
              event.preventDefault();
              url = parsed.data;
              void choose("url", url);
            }
          }}
        />
        <Button
          type="submit"
          variant="secondary"
          aria-label="Save X post link"
          disabled={busy || disabled}><Icon name="arrow" size={16} /></Button
        >
      </form>
    {/if}
  {/if}
  {#if error}<p class="action-error" role="alert">{error}</p>{/if}
</div>

<style>
  .posted-link {
    display: grid;
    gap: 8px;
    min-width: 0;
    max-width: 100%;
  }
  form {
    display: flex;
    gap: 6px;
    min-width: 0;
  }
  form :global(input) {
    min-width: 0;
  }
</style>
