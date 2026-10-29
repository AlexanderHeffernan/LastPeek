<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import type { Content } from "$lib/contracts";
  import { aiReviewSchema, type AIReview } from "$lib/ai";
  let {
    draftId,
    content,
    historical,
  }: { draftId: string; content: Content; historical: boolean } = $props();
  let busy = $state(false),
    error = $state(""),
    reviewed = $state("");
  let review: AIReview | null = $state(null);
  const snapshot = $derived(
    JSON.stringify({
      posts: content.posts.map(({ id, text }) => ({ id, text })),
    }),
  );
  let reviewedPosts: { id: string; text: string }[] = $state([]);
  const stale = $derived(!!review && reviewed !== snapshot);
  const length = $derived(
    content.posts.reduce((sum, p) => sum + p.text.length, 0),
  );
  async function run() {
    busy = true;
    error = "";
    const input = snapshot;
    try {
      const response = await fetch(`/api/drafts/${draftId}/ai-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: input,
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.message || "AI review didn’t finish. Please try again.",
        );
      review = aiReviewSchema.parse(result);
      reviewed = input;
      reviewedPosts = JSON.parse(input).posts;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<section class="share-box" aria-label="AI second look" aria-busy={busy}>
  <div class="row between">
    <h2 class="small">AI second look</h2>
    <Button
      variant="outline"
      disabled={busy ||
        historical ||
        !content.posts.some((p) => p.text.trim()) ||
        length > 20000}
      onclick={run}
    >
      {busy ? "Reviewing…" : review ? "Review again" : "Review text"}
    </Button>
  </div>
  <p>
    Send post text to OpenAI for a private review. No attachments or automatic
    edits.
  </p>
  {#if length > 20000}<p role="status">
      AI review supports up to 20,000 characters. Your draft can be longer.
    </p>{/if}
  {#if error}<div class="notice error" role="alert" style="margin-top:12px">
      {error}
    </div>{/if}
  {#if busy}<p role="status">Reading your draft…</p>{/if}
  {#if review}
    {#if stale || historical}<p class="notice" role="status">
        Earlier-text review — review again for your current wording.
      </p>{/if}
    <div class="stack" style="margin-top:16px;gap:16px" aria-live="polite">
      <p style="margin:0;color:var(--foreground)">{review.summary}</p>
      {#each review.findings as finding}
        <div>
          <strong class="small"
            >Post {reviewedPosts.findIndex((p) => p.id === finding.postId) + 1} ·
            {finding.category}</strong
          >
          <p style="margin-top:6px;color:var(--foreground)">
            {finding.feedback}
          </p>
          <details class="small muted">
            <summary>Reviewed text</summary>
            <p style="white-space:pre-wrap;overflow-wrap:anywhere">
              {reviewedPosts.find((p) => p.id === finding.postId)?.text}
            </p>
          </details>
        </div>
      {/each}
    </div>
  {/if}
</section>
