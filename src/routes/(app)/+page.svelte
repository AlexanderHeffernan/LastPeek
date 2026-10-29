<script lang="ts">
  import { enhance } from "$app/forms";
  import Icon from "$lib/components/Icon.svelte";
  import { relativeTime } from "$lib/contracts";
  let { data } = $props();
  let busy = $state(false);
</script>

<main class="page">
  <div class="page-header row between">
    <div>
      <span class="eyebrow">A little room to think</span>
      <h1>Your drafts.</h1>
      <p class="muted small">
        Not quite out in the world. Right where they belong.
      </p>
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
      <button class="primary" disabled={busy}
        ><Icon name="plus" size={16} />{busy ? "Opening…" : "New draft"}</button
      >
    </form>
  </div>
  {#if !data.drafts.length}<div class="empty">
      <div class="empty-icon"><Icon name="edit" size={25} /></div>
      <h2>Something worth a second look?</h2>
      <p class="small muted">
        Start with a thought. Invite a friend when you’re ready.
      </p>
      <form method="POST" action="?/create">
        <button class="primary">Write your first draft</button>
      </form>
    </div>{:else}<div class="draft-list">
      {#each data.drafts as draft}<a
          class="draft-card"
          href={`/drafts/${draft.id}`}
          ><div class="row between">
            <span class:green={draft.shared} class="badge"
              >{draft.shared
                ? `Shared · v${draft.shared_revision}`
                : "Only you"}</span
            ><Icon name="arrow" size={17} />
          </div>
          <h2>{draft.content.title || "Untitled thought"}</h2>
          <div class="draft-excerpt">
            {draft.content.posts[0].text ||
              (draft.content.posts[0].media.length
                ? "A picture worth sharing."
                : "A blank page, for now.")}
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
                {draft.feedback === 1 ? "thought" : "thoughts"}{/if}</span
            >
          </div></a
        >{/each}
    </div>{/if}
  <p class="footer-note">A second opinion, not another dashboard.</p>
</main>
