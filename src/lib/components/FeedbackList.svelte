<script lang="ts">
  import { page } from "$app/state";
  import { invalidateAll } from "$app/navigation";
  import { Popover } from "bits-ui";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import type { Snippet } from "svelte";
  import { slide } from "svelte/transition";
  import { Button } from "$lib/components/ui/button/index.js";
  import FriendControl from "$lib/components/FriendControl.svelte";
  import UserIdentity from "$lib/components/UserIdentity.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import MediaViewer from "./MediaViewer.svelte";
  import {
    relativeTime,
    mediaURL,
    type Feedback,
    type Content,
    type Media,
  } from "$lib/contracts";
  import { contextChange, mediaTimeLabel } from "$lib/discussions";
  let {
    comments,
    revision,
    content,
    token,
    draftId,
    ownerId,
    media = [],
    onreply,
    onapply,
    onresolve,
    replyingTo,
    composer,
    emptyText = "No comments yet.",
  }: {
    comments: Feedback[];
    revision: number | null;
    content: Content;
    token?: string;
    draftId?: string;
    ownerId?: string;
    media?: Media[];
    onreply?: (comment: Feedback) => void;
    onapply?: (comment: Feedback) => void;
    onresolve?: (comment: Feedback) => Promise<void>;
    replyingTo?: string;
    composer?: Snippet;
    emptyText?: string;
  } = $props();
  const roots = $derived(comments.filter((c) => !c.parent_id));
  let showResolved = $state(false);
  let resolving = $state<string | null>(null);
  let resolveError = $state("");
  let resolveErrorId = $state<string | null>(null);
  let comparing = $state<Feedback | null>(null);
  let viewerIndex = $state<number | null>(null);
  let viewerTime = $state(0);
  let editing = $state<Feedback | null>(null);
  let editBody = $state("");
  let changing = $state(false);
  let messageError = $state("");
  let messageErrorId = $state("");
  let menu = $state<string | null>(null);
  let confirmation: ConfirmDialog;
  async function resolve(comment: Feedback) {
    resolving = comment.id;
    resolveError = "";
    resolveErrorId = comment.id;
    try {
      await onresolve?.(comment);
    } catch (cause) {
      resolveError = (cause as Error).message;
    } finally {
      resolving = null;
    }
  }
  async function changeMessage(comment: Feedback, remove = false) {
    if (
      remove &&
      !(await confirmation.ask({
        title: "Delete this message?",
        description:
          "Replies will stay, but your message will be removed. This can’t be undone.",
        confirmLabel: "Delete message",
        cancelLabel: "Keep message",
      }))
    )
      return;
    changing = true;
    messageError = "";
    messageErrorId = comment.id;
    try {
      const response = await fetch(`/api/comments/${comment.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: remove ? "delete" : "edit",
          version: comment.edit_version,
          body: editBody,
          token,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.message ?? "Couldn’t change this message.");
      editing = null;
      await invalidateAll();
    } catch (cause) {
      messageError = (cause as Error).message;
    } finally {
      changing = false;
    }
  }
  function containsTarget(root: Feedback): boolean {
    return (
      page.url.hash === `#feedback-${root.id}` ||
      comments.filter((c) => c.parent_id === root.id).some(containsTarget)
    );
  }
  const comparedPost = $derived(
    content.posts.find((p) => p.id === comparing?.post_id),
  );
  // Enter: make room, then reveal. Exit reverses that order: fade, then close the gap.
  function conversation(node: Element) {
    const duration = matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : 360;
    const layout = slide(node, { duration, easing: (t) => t });
    return {
      ...layout,
      css: (t: number) => {
        const height = Math.min(t / 0.6, 1);
        return `${layout.css!(height, 1 - height)};opacity:${Math.max(0, (t - 0.6) / 0.4)}`;
      },
    };
  }
</script>

{#if !comments.length}<p class="feedback-empty">{emptyText}</p>{/if}
{#each [false, true] as resolved}
  {#if resolved}
    <button
      class="resolved-divider"
      disabled={!roots.some((c) => c.resolved)}
      aria-expanded={showResolved}
      onclick={() => (showResolved = !showResolved)}
    >
      <span></span>{roots.some((c) => c.resolved)
        ? `Resolved · ${roots.filter((c) => c.resolved).length}`
        : "Nothing resolved"}{#if roots.some((c) => c.resolved)}<Icon
          name="down"
          size={14}
        />{/if}<span></span>
    </button>
  {/if}
  {#each roots.filter((c) => !!c.resolved === resolved) as root (root.id)}
    {#if !root.resolved || showResolved || containsTarget(root)}<section
        transition:conversation
        class="discussion-thread"
        aria-label={root.deleted_at
          ? "Conversation with deleted message"
          : `Conversation from ${root.name}`}
      >
        {@render branch(root, 0)}
      </section>{/if}
  {/each}
{/each}

{#snippet branch(comment: Feedback, depth: number)}
  {@render entry(comment)}
  {#if composer && replyingTo === comment.id}<div class="thread-composer">
      {@render composer()}
    </div>{/if}
  {@const children = comments
    .filter((c) => c.parent_id === comment.id)
    .toReversed()}
  {#if children.length}<div
      class="discussion-replies"
      class:deep={depth >= 2}
      role="group"
      aria-label={comment.deleted_at
        ? "Replies to deleted message"
        : `Replies to ${comment.name}`}
    >
      <div class="reply-entries">
        {#each children as child (child.id)}<div transition:conversation>
            {@render branch(child, depth + 1)}
          </div>{/each}
      </div>
    </div>{/if}
{/snippet}

{#snippet entry(comment: Feedback)}
  {@const change = contextChange(comment, content)}
  {@const post = content.posts.find((p) => p.id === comment.post_id)}
  {@const file = media.find((m) => m.id === comment.media_id)}
  <article
    id={`feedback-${comment.id}`}
    tabindex="-1"
    class="feedback-card"
    class:targeted={page.url.hash === `#feedback-${comment.id}`}
    aria-label={comment.deleted_at
      ? "Deleted message"
      : `Feedback from ${comment.name}`}
  >
    {#if comment.deleted_at}<p class="deleted-message">Message deleted</p>
      {#if onresolve && !comment.parent_id}<Button
          variant="ghost"
          disabled={resolving !== null}
          onclick={() => resolve(comment)}
          >{comment.resolved ? "Reopen" : "Resolve"}</Button
        >{/if}
      {#if resolveErrorId === comment.id && resolveError}<p
          role="alert"
          class="action-error"
        >
          {resolveError}
        </p>{/if}
    {:else}
      <UserIdentity
        name={comment.name}
        avatarId={comment.avatar_id}
        handle={comment.handle}
        userId={comment.user_id}
        guest={!comment.user_id}
        {token}
        compact
        discussion
      >
        {#snippet badges()}
          {#if !comment.user_id}<span
              class="author-label"
              class:own-guest={comment.can_manage}
              title={comment.can_manage
                ? "Your guest message"
                : "Guest reviewer"}
              >{comment.can_manage ? "Guest · You" : "Guest"}</span
            >{/if}
          {#if ownerId && comment.user_id === ownerId}<span class="author-label"
              >Author</span
            >{/if}
        {/snippet}
        {#snippet metadata()}
          <time datetime={comment.created_at}
            >{relativeTime(comment.created_at)}</time
          >
          {#if comment.edited_at}<span
              class="edited-marker"
              title="Message edited">edited</span
            >{/if}
          {#if change}<Button
              variant="ghost"
              size="sm"
              class="context-compare"
              title={`${change} · Compare`}
              aria-label={`${change} · Compare`}
              onclick={() => (comparing = comment)}
              ><Icon name="history" size={12} />Edited</Button
            >{:else if !comment.post_id && revision && comment.revision !== revision}<span
              class="edited-marker"
              role="img"
              aria-label="Draft edited since this comment"
              title="Draft edited since this comment"
              ><Icon name="history" size={12} />Edited</span
            >{/if}
        {/snippet}
        <div class="comment-context">
          {#if comment.post_id && (content.posts.length > 1 || !post)}<span
              class="context-post"
            >
              {post
                ? `On post ${content.posts.indexOf(post) + 1}`
                : "Post removed"}
            </span>{/if}
          {#if comment.quote}<blockquote class="feedback-quote">
              {comment.quote}
            </blockquote>{/if}
          {#if comment.media_id}<a
              class="comment-media"
              href={file?.mime.startsWith("video/")
                ? `${mediaURL(comment.media_id, token)}#t=${comment.media_time ?? 0}`
                : mediaURL(comment.media_id, token)}
              target="_blank"
              rel="noopener noreferrer"
              onclick={(event) => {
                const index = media.findIndex((m) => m.id === comment.media_id);
                if (index >= 0) {
                  event.preventDefault();
                  viewerTime = comment.media_time ?? 0;
                  viewerIndex = index;
                }
              }}
            >
              {#if file && !file.mime.startsWith("video/")}<img
                  src={mediaURL(file.id, token)}
                  alt={file.filename}
                />{:else}<Icon name="image" size={16} />{/if}
              {file?.mime.startsWith("video/")
                ? "Video"
                : "Image"}{comment.media_time !== null &&
              comment.media_time !== undefined
                ? ` · ${mediaTimeLabel(comment.media_time)}`
                : ""}
            </a>{/if}
        </div>
        {#if comment.agent_name}<span
            class="small muted agent-attribution"
            title="Sent by an agent on this user’s behalf. App-provided name."
            >via {comment.agent_name}</span
          >{/if}
        <p class="comment">{comment.body}</p>
        {#if comment.suggestion}<blockquote class="feedback-quote">
            {comment.suggestion}
          </blockquote>{/if}
        <div class="comment-actions">
          {#if onreply}<Button
              variant="ghost"
              onclick={() => onreply?.(comment)}>Reply</Button
            >{/if}
          {#if onresolve && !comment.parent_id}<Button
              variant="ghost"
              disabled={resolving !== null}
              onclick={() => resolve(comment)}
              >{comment.resolved ? "Reopen" : "Resolve"}</Button
            >{/if}
          {#if onapply && comment.suggestion && post}<Button
              variant="outline"
              onclick={() => onapply?.(comment)}>Use suggestion</Button
            >{/if}
          {#if comment.user_id && (draftId || token)}<FriendControl
              userId={comment.user_id}
              name={comment.name}
              {draftId}
              {token}
              inline
            />{/if}
          {#if comment.can_manage}<Popover.Root
              bind:open={
                () => menu === comment.id,
                (open) => (menu = open ? comment.id : null)
              }
            >
              <Popover.Trigger
                >{#snippet child({ props })}<Button
                    {...props}
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Message actions"
                    ><Icon name="more" size={18} /></Button
                  >{/snippet}</Popover.Trigger
              >
              <Popover.Content
                class="share-menu"
                align="end"
                sideOffset={4}
                aria-label="Message actions"
              >
                <Button
                  variant="ghost"
                  onclick={() => {
                    menu = null;
                    editing = comment;
                    editBody = comment.body;
                    messageError = "";
                  }}><Icon name="edit" size={16} />Edit message</Button
                >
                <Button
                  variant="ghost"
                  class="text-destructive"
                  onclick={() => {
                    menu = null;
                    void changeMessage(comment, true);
                  }}><Icon name="trash" size={16} />Delete message</Button
                >
              </Popover.Content>
            </Popover.Root>{/if}
        </div>
        {#if messageErrorId === comment.id && messageError && !editing}<p
            class="action-error"
            role="alert"
          >
            {messageError}
          </p>{/if}
        {#if resolveError && resolveErrorId === comment.id}<p
            class="action-error"
            role="alert"
          >
            {resolveError}
          </p>{/if}
      </UserIdentity>
    {/if}
  </article>
{/snippet}

<ConfirmDialog bind:this={confirmation} />
<Dialog.Root
  bind:open={
    () => editing !== null,
    (open) => {
      if (!open) editing = null;
    }
  }
>
  <Dialog.Content>
    <Dialog.Header
      ><Dialog.Title>Edit message</Dialog.Title><Dialog.Description
        >Your original post or media context stays attached.</Dialog.Description
      ></Dialog.Header
    >
    <form
      onsubmit={(event) => {
        event.preventDefault();
        if (editing) void changeMessage(editing);
      }}
    >
      <Textarea
        aria-label="Edit message text"
        bind:value={editBody}
        required
        maxlength={2000}
      />
      {#if messageError}<p role="alert" class="action-error">
          {messageError}
        </p>{/if}
      <Dialog.Footer
        ><Button
          variant="ghost"
          onclick={() => (editing = null)}
          disabled={changing}>Cancel</Button
        ><Button type="submit" disabled={changing || !editBody.trim()}
          >{changing ? "Saving…" : "Save message"}</Button
        ></Dialog.Footer
      >
    </form>
  </Dialog.Content>
</Dialog.Root>
<MediaViewer items={media} bind:index={viewerIndex} time={viewerTime} {token} />
<Dialog.Root
  bind:open={
    () => comparing !== null,
    (open) => {
      if (!open) comparing = null;
    }
  }
>
  <Dialog.Content class="max-h-[85dvh] overflow-y-auto">
    <Dialog.Header
      ><Dialog.Title
        >{comparing
          ? contextChange(comparing, content)
          : "Review context"}</Dialog.Title
      ><Dialog.Description
        >Compare the context when this comment was written with the current
        draft.</Dialog.Description
      ></Dialog.Header
    >
    {#if comparing}<div class="comparison-content">
        <span class="small muted">When reviewed</span>
        {#if contextChange(comparing, content) === "Source changed"}
          <p>
            {comparing.original_source?.kind ?? "Post"}
            {#if comparing.original_source}<a
                href={comparing.original_source.url}
                target="_blank"
                rel="noopener noreferrer">{comparing.original_source.url}</a
              >{/if}
          </p>
          <span class="small muted">Now</span>
          <p>
            {content.source?.kind ?? "Post"}
            {#if content.source}<a
                href={content.source.url}
                target="_blank"
                rel="noopener noreferrer">{content.source.url}</a
              >{/if}
          </p>
        {:else}
          <p>{comparing.original_post?.text ?? "Post unavailable"}</p>
          <span class="small muted">Now</span>
          <p>{comparedPost?.text ?? "Post removed"}</p>
        {/if}
      </div>{/if}
  </Dialog.Content>
</Dialog.Root>

<style>
  .resolved-divider {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 10px;
    padding: 14px 0;
    font-size: 12px;
    color: var(--muted-foreground);
    background: none;
    border: 0;
    cursor: pointer;
  }
  .resolved-divider span {
    flex: 1;
    border-top: 1px solid var(--border);
  }
  .resolved-divider:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .resolved-divider[aria-expanded="true"] :global(svg) {
    transform: rotate(180deg);
  }
  .discussion-thread {
    position: relative;
    border-top: 1px solid var(--border);
    padding: 16px 0;
  }
  .discussion-thread:first-child {
    border-top: 0;
  }
  .resolved-divider + .discussion-thread {
    border-top: 0;
  }
  .discussion-replies {
    position: relative;
    margin-left: 19px;
    padding-left: 20px;
    border-left: 2px solid var(--border);
  }
  .discussion-replies.deep {
    margin-left: 0;
    padding-left: 8px;
  }
  .deleted-message {
    color: var(--muted-foreground);
    font-size: 13px;
    font-style: italic;
    margin: 6px 0;
  }
  .own-guest {
    background: var(--accent);
    color: var(--foreground);
    outline: 1px solid var(--input);
  }
  .reply-entries {
    display: grid;
    gap: 12px;
    padding-top: 8px;
  }
  .thread-composer {
    margin-left: 19px;
    padding-left: 20px;
    border-left: 2px solid var(--border);
  }
  @media (max-width: 400px) {
    .thread-composer {
      margin-left: 0;
      padding-left: 0;
      border-left: 0;
    }
  }
  .feedback-card {
    position: relative;
    padding: 0;
    border: 0;
    scroll-margin-block: 24px;
  }
  .feedback-card.targeted {
    background: var(--muted);
    border-radius: 8px;
    outline: 6px solid var(--muted);
  }
  .feedback-card .comment {
    margin: 3px 0 0;
    font-size: 14px;
    line-height: 20px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .edited-marker,
  :global(.context-compare[data-slot="button"]) {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
    color: var(--muted-foreground);
    font-size: 10px;
    height: 20px;
    min-height: 20px;
    padding: 0;
  }
  .author-label {
    color: var(--muted-foreground);
    background: var(--secondary);
    padding: 1px 6px;
    border-radius: 999px;
    font-size: 10px;
    line-height: 16px;
    flex-shrink: 0;
  }
  time {
    color: var(--muted-foreground);
    white-space: nowrap;
    font-size: 11px;
    flex-shrink: 0;
  }
  .comment-context {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px 8px;
  }
  .comment-context:empty {
    display: none;
  }
  .context-post {
    font-size: 11px;
    color: var(--muted-foreground);
  }
  .feedback-quote {
    flex-basis: 100%;
    margin: 3px 0;
    padding: 3px 8px;
    border-left: 2px solid var(--primary);
    border-radius: 0 6px 6px 0;
    background: var(--secondary);
    color: var(--muted-foreground);
    font-size: 13px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .comment-actions {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
    margin-top: 2px;
  }
  .comment-actions :global([data-slot="button"]) {
    padding: 0;
    min-height: 32px;
    height: 32px;
    color: var(--muted-foreground);
    font-size: 12px;
    gap: 5px;
  }
  .comment-actions :global([data-slot="button"]:hover) {
    color: var(--primary);
    background: transparent;
  }
  .comparison-content p {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 13px;
  }
  .comment-media {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    font-size: 11px;
    margin-top: 6px;
    padding: 3px 7px 3px 3px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--muted-foreground);
  }
  .comment-media img {
    width: 32px;
    height: 24px;
    object-fit: cover;
    border-radius: 6px;
  }
  @media (pointer: coarse) {
    .comment-actions :global([data-slot="button"]) {
      min-height: 44px;
    }
  }
</style>
