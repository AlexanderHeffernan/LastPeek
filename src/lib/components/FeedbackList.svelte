<script lang="ts">
  import { relativeTime, type Feedback, type Content } from "$lib/contracts";
  let {
    comments,
    revision,
    content,
    onresolve,
    onapply,
    onversion,
  }: {
    comments: Feedback[];
    revision: number | null;
    content: Content;
    onresolve?: (comment: Feedback) => void;
    onapply?: (comment: Feedback) => void;
    onversion?: (revision: number) => void;
  } = $props();
</script>

{#if !comments.length}<div class="feedback-empty">
    A fresh pair of eyes makes a difference.<br />{onresolve
      ? "Share a link to start the conversation."
      : "Be the first to leave a thought."}
  </div>{/if}
{#each comments as comment (comment.id)}
  {@const index = content.posts.findIndex((p) => p.id === comment.post_id)}
  <article
    class="feedback-card"
    class:resolved={comment.resolved}
    aria-label={`Feedback from ${comment.name}`}
  >
    <div class="feedback-person">
      <span class="avatar">{comment.name.slice(0, 1).toUpperCase()}</span>
      <div>
        <strong>{comment.name}</strong> <small>Guest</small>
        <div><small>{relativeTime(comment.created_at)}</small></div>
      </div>
      <span
        style="margin-left:auto"
        class="badge"
        class:old={comment.revision !== revision}
        >v{comment.revision}{comment.revision !== revision
          ? " · Earlier version"
          : ""}</span
      >
    </div>
    <div class="small muted">
      {index >= 0
        ? `On post ${index + 1}`
        : "On a removed post"}{comment.resolved ? " · Resolved" : ""}
    </div>
    <p class="comment">{comment.body}</p>
    {#if comment.suggestion}<div class="suggestion">
        <div class="eyebrow" style="font-size:8px;margin-bottom:7px">
          Suggested wording
        </div>
        {comment.suggestion}
      </div>{/if}
    <div class="feedback-actions">
      {#if onapply && comment.suggestion && index >= 0 && !comment.resolved}<button
          onclick={() => onapply?.(comment)}>Use suggestion</button
        >{/if}{#if onresolve}<button
          class="quiet"
          onclick={() => onresolve?.(comment)}
          >{comment.resolved ? "Reopen" : "Resolve"}</button
        >{/if}{#if onversion && comment.revision !== revision}<button
          class="quiet"
          onclick={() => onversion?.(comment.revision)}
          >View v{comment.revision}</button
        >{/if}
    </div>
  </article>
{/each}
