<script lang="ts">
  import type { Snippet } from "svelte";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import UserIdentity from "$lib/components/UserIdentity.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import Icon from "$lib/components/Icon.svelte";
  import { mediaURL, type Media } from "$lib/contracts";
  import { mediaTimeLabel } from "$lib/discussions";

  let {
    value = $bindable(""),
    id,
    label,
    name = "body",
    user,
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
    oncancelreply,
    onclear,
    actions,
  }: {
    value?: string;
    id?: string;
    label: string;
    name?: string;
    user: { name: string; avatar_id?: string | null };
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
    oncancelreply?: () => void;
    onclear?: () => void;
    actions?: Snippet;
  } = $props();
</script>

<div class="discussion-composer">
  <UserIdentity
    name={user.name}
    avatarId={user.avatar_id}
    avatarOnly
    showPresence={false}
  />
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
        class="min-h-10 max-h-40 min-w-0 flex-1 resize-none rounded-lg bg-secondary/40 px-3 py-2.5 text-base leading-5 shadow-none md:text-sm"
      />
      <div class="composer-submit">
        {#if actions}{@render actions()}{:else}
          <Button
            size="sm"
            class="min-h-11 rounded-full"
            type="submit"
            disabled={disabled || busy || !value.trim()}
          >
            {busy ? "Sending…" : replyName ? "Reply" : "Comment"}
          </Button>
        {/if}
      </div>
      {#if replyName}<Button
          variant="ghost"
          size="icon-sm"
          class="min-h-11 shrink-0"
          aria-label="Cancel reply"
          onclick={oncancelreply}><Icon name="close" size={14} /></Button
        >{/if}
    </div>
    {#if error}<p class="action-error" role="alert">{error}</p>{/if}
  </div>
</div>

<style>
  .discussion-composer {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr);
    gap: 10px;
    padding: 10px 0 12px;
  }
  .composer-content {
    min-width: 0;
  }
  .composer-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  .composer-submit {
    padding-top: 0;
  }
  .composer-submit :global([data-slot="button"]) {
    padding-inline: 13px;
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
  @media (max-width: 360px) {
    .discussion-composer {
      gap: 8px;
    }
    .composer-row {
      gap: 6px;
    }
    .composer-submit :global([data-slot="button"]) {
      padding-inline: 10px;
    }
  }
</style>
