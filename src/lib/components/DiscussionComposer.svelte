<script lang="ts">
  import type { Snippet } from "svelte";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import Icon from "$lib/components/Icon.svelte";
  import { slide } from "svelte/transition";
  import { mediaURL, type Media } from "$lib/contracts";
  import { mediaTimeLabel } from "$lib/discussions";

  let {
    value = $bindable(""),
    id,
    label,
    name = "body",
    replyName,
    postLabel,
    quote,
    media,
    time,
    token,
    error,
    busy = false,
    disabled = false,
    oninput,
    onclear,
    actions,
  }: {
    value?: string;
    id?: string;
    label: string;
    name?: string;
    replyName?: string;
    postLabel?: string;
    quote?: string;
    media?: Media;
    time?: number | null;
    token?: string;
    error?: string;
    busy?: boolean;
    disabled?: boolean;
    oninput?: () => void;
    onclear?: () => void;
    actions?: Snippet;
  } = $props();
  let focused = $state(false);
  function suggestions(node: Element) {
    const layout = slide(node, {
      duration: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : 220,
    });
    return {
      ...layout,
      css: (t: number) => `${layout.css!(t, 1 - t)};opacity:${t}`,
    };
  }
</script>

<div
  class="discussion-composer"
  onfocusin={() => (focused = true)}
  onfocusout={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null))
      focused = false;
  }}
>
  <div class="composer-content">
    {#if postLabel || quote || media}<div class="composer-context">
        {#if media && !media.mime.startsWith("video/")}<img
            src={mediaURL(media.id, token)}
            alt={media.filename}
          />{/if}
        {#if quote}<blockquote class="context-copy">
            {quote}
          </blockquote>{:else}<span class="context-copy"
            >{media
              ? `${media.mime.startsWith("video/") ? "Video" : "Image"}${time != null ? ` · ${mediaTimeLabel(time)}` : ""}`
              : postLabel}</span
          >{/if}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Clear feedback focus"
          onclick={onclear}><Icon name="close" size={14} /></Button
        >
      </div>{/if}
    <div class="composer-row">
      <Textarea
        {id}
        {name}
        aria-label={label}
        bind:value
        {oninput}
        placeholder={replyName ? "Write a reply…" : "Add a comment…"}
        rows={1}
        maxlength={2000}
        required
        class="min-h-12 max-h-40 min-w-0 resize-none rounded-xl bg-secondary/40 pl-3 pr-14 py-3 text-base leading-5 shadow-none md:text-sm"
        onkeydown={(event) => {
          if (
            event.key !== "Enter" ||
            event.shiftKey ||
            event.isComposing ||
            event.keyCode === 229
          )
            return;
          event.preventDefault();
          if (busy || disabled || !value.trim()) return;
          const form = event.currentTarget.form;
          const submit = form?.querySelector<HTMLButtonElement>(
            'button[type="submit"]:not([hidden])',
          );
          if (submit && !submit.disabled) form?.requestSubmit(submit);
        }}
      />
      <div class="composer-submit">
        {#if actions}{@render actions()}{:else}
          <Button
            variant="secondary"
            size="icon"
            class="min-h-11 min-w-11 rounded-full"
            type="submit"
            aria-label={replyName ? "Send reply" : "Send comment"}
            title={replyName ? "Send reply" : "Send comment"}
            disabled={disabled || busy || !value.trim()}
          >
            <Icon name={busy ? "refresh" : "send"} size={20} />
          </Button>
        {/if}
      </div>
    </div>
    {#if focused && !replyName}<div
        class="quick-replies"
        transition:suggestions
      >
        {#each ["Looks good!", "Could you clarify this?", "I’d make this shorter."] as text}
          <Button
            variant="outline"
            size="sm"
            class="rounded-full min-h-11 h-11 text-sm px-4"
            disabled={busy || disabled || !!value.trim()}
            onmousedown={(event) => event.preventDefault()}
            onclick={() => {
              value = text;
              oninput?.();
              document.getElementById(id ?? "")?.focus({ preventScroll: true });
            }}>{text}</Button
          >
        {/each}
      </div>{/if}
    {#if error}<p class="action-error" role="alert">{error}</p>{/if}
  </div>
</div>

<style>
  .discussion-composer {
    display: block;
    padding: 10px 0 12px;
  }
  .composer-content {
    min-width: 0;
  }
  .composer-row {
    position: relative;
  }
  .composer-submit {
    position: absolute;
    right: 2px;
    bottom: 2px;
  }
  .quick-replies {
    display: flex;
    gap: 8px;
    padding-top: 8px;
    padding-right: 16px;
    padding-bottom: 4px;
    overflow-x: auto;
    mask-image: linear-gradient(to right, #000 calc(100% - 16px), transparent);
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
    overscroll-behavior-x: contain;
  }
  .composer-context {
    display: flex;
    align-items: center;
    gap: 6px;
    width: fit-content;
    max-width: 100%;
    margin-bottom: 4px;
    padding: 0 0 0 8px;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--muted-foreground);
    font-size: 12px;
  }
  .composer-context img {
    width: 30px;
    height: 26px;
    object-fit: cover;
    border-radius: 4px;
  }
  .context-copy {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .action-error {
    margin: 8px 0 0;
    font-size: 13px;
  }
</style>
