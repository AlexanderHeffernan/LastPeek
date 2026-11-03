<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { DropdownMenu } from "bits-ui";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import Icon from "./Icon.svelte";
  import { relativeTime, type Content } from "$lib/contracts";
  import { reviewTypes, type AIReviewRun, type ReviewType } from "$lib/ai";
  let {
    draftId,
    content,
    history = [],
    enabled = true,
    onapply,
  }: {
    draftId: string;
    content: Content;
    history?: AIReviewRun[];
    enabled?: boolean;
    onapply?: (
      postId: string,
      reviewed: string,
      quote: string,
      replacement: string,
    ) => boolean;
  } = $props();
  let completed = $state<AIReviewRun[]>([]);
  let deleted = $state<string[]>([]);
  let deleting = $state<string | null>(null);
  let confirmation = $state<ConfirmDialog>();
  const runs = $derived(
    [
      ...completed,
      ...history.filter(
        (run) => !completed.some((local) => local.id === run.id),
      ),
    ]
      .filter((run) => !deleted.includes(run.id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
  );
  let busy = $state<ReviewType | null>(null);
  let error = $state("");
  let dismissed = $state<string[]>([]),
    applied = $state<string[]>([]);
  const posts = $derived(content.posts.map(({ id, text }) => ({ id, text })));
  const length = $derived(posts.reduce((sum, p) => sum + p.text.length, 0));
  async function remove(reviewId: string) {
    if (
      !(await confirmation?.ask({
        title: "Delete AI review?",
        description:
          "This removes this private review and its suggestions. Your draft and discussion stay unchanged.",
        confirmLabel: "Delete review",
      }))
    )
      return;
    deleting = reviewId;
    error = "";
    try {
      const response = await fetch(`/api/drafts/${draftId}/ai-review`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId }),
      });
      if (!response.ok)
        throw new Error(
          (await response.json()).message || "Couldn’t delete this review.",
        );
      deleted = [...deleted, reviewId];
    } catch (cause) {
      error = (cause as Error).message;
    } finally {
      deleting = null;
    }
  }
  async function run(type: ReviewType) {
    if (busy) return;
    busy = type;
    error = "";
    try {
      const response = await fetch(`/api/drafts/${draftId}/ai-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posts, type }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.message || "AI review didn’t finish. Please try again.",
        );
      completed = [result as AIReviewRun, ...completed];
    } catch (cause) {
      error = (cause as Error).message;
    } finally {
      busy = null;
    }
  }
</script>

<div class="ai-results">
  <div class="review-modes" role="group" aria-label="Review type">
    {#each Object.entries(reviewTypes) as [key, mode]}
      <Button
        variant="outline"
        size="sm"
        title={mode.description}
        aria-label={mode.label}
        aria-busy={busy === key}
        disabled={!!busy ||
          !enabled ||
          !posts.some((p) => p.text.trim()) ||
          length > 20000 ||
          (key === "flow" && posts.length < 2)}
        onclick={() => run(key as ReviewType)}
        >{busy === key ? "Reviewing…" : mode.label}</Button
      >
    {/each}
  </div>
  {#if length > 20000}<p class="action-error">
      AI review supports up to 20,000 characters.
    </p>{/if}
  {#if error}<p class="action-error" role="alert">{error}</p>{/if}
  <section aria-label="AI review history" aria-live="polite">
    {#each runs as review (review.id)}
      {@const stale = JSON.stringify(review.posts) !== JSON.stringify(posts)}
      <article
        class="review-run"
        aria-label={`${reviewTypes[review.type].label} review`}
      >
        <div class="run-heading">
          <h3>{reviewTypes[review.type].label}</h3>
          <time datetime={review.created_at}
            >{relativeTime(review.created_at)}</time
          >
          {#if stale}<span
              class="small muted"
              title="The draft changed. Run another review before applying suggestions."
              >Draft edited</span
            >{/if}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              >{#snippet child({ props })}<Button
                  {...props}
                  class="ml-auto"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Actions for ${reviewTypes[review.type].label} review`}
                  disabled={deleting === review.id}><Icon name="more" /></Button
                >{/snippet}</DropdownMenu.Trigger
            >
            <DropdownMenu.Portal
              ><DropdownMenu.Content
                align="end"
                sideOffset={4}
                class="z-50 rounded-lg border border-border bg-popover p-1 shadow-lg"
              >
                <DropdownMenu.Item
                  class="cursor-pointer rounded-md px-3 py-2 text-sm text-destructive outline-none data-highlighted:bg-muted"
                  onSelect={() => {
                    void remove(review.id);
                  }}>Delete review</DropdownMenu.Item
                >
              </DropdownMenu.Content></DropdownMenu.Portal
            >
          </DropdownMenu.Root>
        </div>
        <p>{review.result.summary}</p>
        {#each review.result.findings as finding, index}
          {@const key = `${review.id}:${index}`}
          {#if !dismissed.includes(key)}
            <article
              class="ai-finding"
              aria-label={`${finding.category} finding`}
            >
              <span class="small muted"
                >Post {review.posts.findIndex((p) => p.id === finding.postId) +
                  1} · {finding.category}</span
              >
              <p>{finding.feedback}</p>
              {#if finding.replacement !== null}<div class="suggested-edit">
                  <p class="original" aria-label="Original wording">
                    <span aria-hidden="true">−</span>{finding.quote}
                  </p>
                  <p class="replacement" aria-label="Suggested wording">
                    <span aria-hidden="true">+</span>{finding.replacement ||
                      "Remove this text"}
                  </p>
                </div>
              {:else if finding.quote}<blockquote class="feedback-quote">
                  {finding.quote}
                </blockquote>{/if}
              <div class="finding-actions">
                {#if onapply && finding.quote && finding.replacement !== null}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={stale || applied.includes(key)}
                    onclick={() => {
                      if (
                        onapply?.(
                          finding.postId,
                          review.posts.find((p) => p.id === finding.postId)!
                            .text,
                          finding.quote!,
                          finding.replacement!,
                        )
                      )
                        applied = [...applied, key];
                      else
                        error =
                          "That text changed. Run another review before applying.";
                    }}>{applied.includes(key) ? "Applied" : "Apply"}</Button
                  >
                {/if}
                <Button
                  variant="ghost"
                  size="sm"
                  onclick={() => (dismissed = [...dismissed, key])}
                  >Dismiss</Button
                >
              </div>
            </article>
          {/if}
        {/each}
      </article>
    {:else}<p class="small muted empty-history">
        Choose a review above. Your results stay here, newest first.
      </p>{/each}
  </section>
</div>
<ConfirmDialog bind:this={confirmation} />

<style>
  .ai-results {
    padding-block: 8px 20px;
  }
  .run-heading {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .review-modes {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .review-modes :global(button) {
    min-height: 40px;
  }
  .review-run {
    padding-block: 18px;
    border-bottom: 1px solid var(--border);
  }
  .run-heading {
    flex-wrap: wrap;
  }
  h3 {
    margin: 0;
    font-size: 14px;
  }
  time {
    color: var(--muted-foreground);
    font-size: 11px;
  }
  .review-run p {
    font-size: 13px;
    line-height: 20px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    margin-block: 8px;
  }
  .ai-finding {
    padding-top: 12px;
    margin-top: 12px;
    border-top: 1px solid var(--border);
  }
  .suggested-edit {
    margin-block: 10px;
    border-radius: 6px;
    overflow: hidden;
  }
  .suggested-edit p {
    display: flex;
    gap: 8px;
    padding: 7px 10px;
    margin: 0;
  }
  .original {
    background: #ff6b5b0d;
    color: #e6a398;
  }
  .replacement {
    background: #71b9890d;
    color: #a2c8ae;
  }
  .finding-actions {
    display: flex;
    gap: 4px;
  }
  .empty-history {
    margin-top: 20px;
  }
</style>
