<script lang="ts">
  import { page } from "$app/state";
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
    {@const replies = comments
      .filter((c) => c.parent_id === root.id)
      .toReversed()}
    {#if !root.resolved || showResolved || [root, ...replies].some((c) => page.url.hash === `#feedback-${c.id}`)}<section
        transition:conversation
        class="discussion-thread"
        class:has-replies={replies.length > 0}
        aria-label={`Conversation from ${root.name}`}
      >
        {@render entry(root)}
        {#if replies.length}<div class="discussion-replies">
            <div class="reply-entries">
              {#each replies as reply (reply.id)}<div transition:conversation>
                  {@render entry(reply)}
                </div>{/each}
            </div>
          </div>{/if}
        {#if composer && replyingTo === root.id}<div class="thread-composer">
            {@render composer()}
          </div>{/if}
      </section>{/if}
  {/each}
{/each}

{#snippet entry(comment: Feedback)}
  {@const change = contextChange(comment, content)}
  {@const post = content.posts.find((p) => p.id === comment.post_id)}
  {@const file = media.find((m) => m.id === comment.media_id)}
  <article
    id={`feedback-${comment.id}`}
    tabindex="-1"
    class="feedback-card"
    class:targeted={page.url.hash === `#feedback-${comment.id}`}
    aria-label={`Feedback from ${comment.name}`}
  >
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
      {#snippet metadata()}
        {#if !comment.user_id}<span class="author-label">Guest</span>{/if}
        {#if ownerId && comment.user_id === ownerId}<span class="author-label"
            >Author</span
          >{/if}
        <time datetime={comment.created_at}
          >{relativeTime(comment.created_at)}</time
        >
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
      {#if change}<Button
          variant="ghost"
          size="sm"
          class="context-compare"
          onclick={() => (comparing = comment)}>{change} · Compare</Button
        >{:else if !comment.post_id && revision && comment.revision !== revision}<span
          class="small muted">Draft edited since this comment</span
        >{/if}
      {#if comment.suggestion}<blockquote class="feedback-quote">
          {comment.suggestion}
        </blockquote>{/if}
      <div class="comment-actions">
        {#if onreply}<Button variant="ghost" onclick={() => onreply?.(comment)}
            >Reply</Button
          >{/if}
        {#if onresolve && !comment.parent_id}<Button
            variant="ghost"
            disabled={resolving !== null}
            onclick={async () => {
              resolving = comment.id;
              resolveError = "";
              resolveErrorId = comment.id;
              try {
                await onresolve?.(comment);
              } catch (e) {
                resolveError = (e as Error).message;
              } finally {
                resolving = null;
              }
            }}>{comment.resolved ? "Reopen" : "Resolve"}</Button
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
      </div>
      {#if resolveError && resolveErrorId === comment.id}<p
          class="action-error"
          role="alert"
        >
          {resolveError}
        </p>{/if}
    </UserIdentity>
  </article>
{/snippet}

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
    padding-left: 30px;
    border-left: 2px solid var(--border);
  }
  .reply-entries {
    display: grid;
    gap: 12px;
    padding-top: 8px;
  }
  .thread-composer {
    margin-left: 19px;
    padding-left: 30px;
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
  .has-replies > .feedback-card::before {
    content: "";
    position: absolute;
    left: 19px;
    top: 46px;
    bottom: 0;
    border-left: 2px solid var(--border);
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
