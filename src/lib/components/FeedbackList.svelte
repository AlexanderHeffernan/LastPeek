<script lang="ts">
  import { page } from "$app/state";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import {
    avatarURL,
    relativeTime,
    type Feedback,
    type Content,
  } from "$lib/contracts";
  let {
    comments,
    revision,
    content,
    token,
    onresolve,
    onapply,
    emptyText = "No feedback yet.",
  }: {
    comments: Feedback[];
    revision: number | null;
    content: Content;
    token?: string;
    onresolve?: (comment: Feedback) => void;
    onapply?: (comment: Feedback) => void;
    emptyText?: string;
  } = $props();
</script>

{#if !comments.length}<div class="feedback-empty">{emptyText}</div>{/if}
{#each comments as comment (comment.id)}
  {@const index = content.posts.findIndex((p) => p.id === comment.post_id)}
  <article
    id={`feedback-${comment.id}`}
    tabindex="-1"
    class="feedback-card"
    class:resolved={comment.resolved}
    class:targeted={page.url.hash === `#feedback-${comment.id}`}
    aria-label={`Feedback from ${comment.name}`}
  >
    <div class="feedback-person">
      <span class="avatar" aria-hidden="true">
        {#if comment.avatar_id}<img
            src={avatarURL(comment.avatar_id, token)}
            alt=""
          />
        {:else}{comment.name.slice(0, 1).toUpperCase()}{/if}
      </span>
      <div>
        <strong>{comment.name}</strong>
        <div><small>{relativeTime(comment.created_at)}</small></div>
      </div>
      {#if comment.revision !== revision}<Badge
          variant="secondary"
          style="margin-left:auto"
          class={[comment.revision !== revision && "old"]}
          >Earlier feedback</Badge
        >{/if}
    </div>
    <div class="small muted">
      {!comment.post_id
        ? "General feedback"
        : index >= 0
          ? `On post ${index + 1}`
          : "On a removed post"}{comment.resolved ? " · Resolved" : ""}
    </div>
    {#if comment.quote}<blockquote class="feedback-quote">
        {comment.quote}
      </blockquote>{/if}
    <p class="comment">{comment.body}</p>
    {#if comment.suggestion}<div class="suggestion">
        <div class="eyebrow" style="margin-bottom:8px">Suggestion</div>
        {comment.suggestion}
      </div>{/if}
    <div class="feedback-actions">
      {#if onapply && comment.suggestion && index >= 0 && !comment.resolved}<Button
          variant="outline"
          onclick={() => onapply?.(comment)}>Use suggestion</Button
        >{/if}{#if onresolve}<Button
          variant="ghost"
          onclick={() => onresolve?.(comment)}
          >{comment.resolved ? "Reopen" : "Resolve"}</Button
        >{/if}
    </div>
  </article>
{/each}
