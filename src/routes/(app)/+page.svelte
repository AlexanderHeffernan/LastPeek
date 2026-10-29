<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { enhance } from "$app/forms";
  import Icon from "$lib/components/Icon.svelte";
  import { relativeTime } from "$lib/contracts";
  let { data } = $props();
  let busy = $state(false);
</script>

<main class="page">
  <div class="page-header row between">
    <div>
      <span class="eyebrow">Your next good post</span>
      <h1>Your drafts.</h1>
    </div>
    <form
      method="POST"
      action="?/create"
      use:enhance={() => {
        busy = true;
        return async ({ update }) => {
          await update();
          busy = false;
        };
      }}
    >
      <Button variant="default" type="submit" disabled={busy}
        ><Icon name="plus" size={16} />{busy ? "Opening…" : "New draft"}</Button
      >
    </form>
  </div>
  {#if !data.drafts.length}<div class="empty">
      <div class="empty-icon"><Icon name="edit" size={25} /></div>
      <h2>Start something worth sharing.</h2>
      <form method="POST" action="?/create" use:enhance>
        <Button variant="default" type="submit">Write your first draft</Button>
      </form>
    </div>{:else}<div class="draft-list">
      {#each data.drafts as draft}<a
          class="draft-card"
          href={`/drafts/${draft.id}`}
          ><div class="row between">
            <Badge variant="secondary" class={[draft.shared && "brand-tint"]}
              >{draft.shared
                ? `Shared · v${draft.shared_revision}`
                : "Only you"}</Badge
            ><Icon name="arrow" size={17} />
          </div>
          <div class="draft-excerpt">
            {draft.content.posts[0].text ||
              (draft.content.posts[0].media.length
                ? "Media post"
                : "No text yet")}
          </div>
          <div class="draft-bottom row between">
            <span
              >{draft.content.posts.length}
              {draft.content.posts.length === 1 ? "post" : "posts"} · {relativeTime(
                draft.updated_at,
              )}</span
            ><span class="row"
              >{#if draft.feedback}<Icon
                  name="comment"
                  size={13}
                />{draft.feedback}
                {draft.feedback === 1 ? "comment" : "comments"}{/if}</span
            >
          </div></a
        >{/each}
    </div>{/if}
</main>
