<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { enhance } from "$app/forms";
  import Icon from "$lib/components/Icon.svelte";
  import PostPreview from "$lib/components/PostPreview.svelte";
  import { relativeTime } from "$lib/contracts";
  let { data } = $props();
  let busy = $state(false);
  let query = $state("");
  let filter = $state("all");
  let sort = $state("updated");
  const filters = [
    { value: "all", label: "All" },
    { value: "feedback", label: "With feedback" },
    { value: "shared", label: "Shared" },
    { value: "private", label: "Private" },
  ];
  const visible = $derived(
    data.drafts
      .filter(
        (draft) =>
          (filter === "all" ||
            (filter === "feedback"
              ? draft.feedback > 0
              : filter === "shared"
                ? draft.shared
                : !draft.shared)) &&
          draft.content.posts.some((post) =>
            post.text
              .toLocaleLowerCase()
              .includes(query.trim().toLocaleLowerCase()),
          ),
      )
      .sort((a, b) => {
        const field = sort === "updated" ? "updated_at" : "created_at";
        return (
          (sort === "oldest" ? 1 : -1) *
          (Date.parse(a[field]) - Date.parse(b[field]))
        );
      }),
  );
</script>

<main class="drafts-page">
  <div class="drafts-heading row between">
    <h1>Your drafts.</h1>
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
      <Button type="submit" disabled={busy}
        ><Icon name="plus" size={16} />{busy ? "Opening…" : "New draft"}</Button
      >
    </form>
  </div>
  {#if !data.drafts.length}
    <div class="empty">
      <div class="empty-icon"><Icon name="edit" size={25} /></div>
      <h2>Start something worth sharing.</h2>
      <form method="POST" action="?/create" use:enhance>
        <Button type="submit">Write your first draft</Button>
      </form>
    </div>
  {:else}
    <div class="drafts-controls">
      <Input
        type="search"
        aria-label="Search drafts"
        placeholder="Search drafts…"
        bind:value={query}
      />
      <div class="drafts-sort row between">
        <span class="small" role="status"
          >{visible.length} {visible.length === 1 ? "draft" : "drafts"}</span
        >
        <select aria-label="Sort drafts" bind:value={sort}>
          <option value="updated">Recently updated</option>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>
      <div class="drafts-filters" role="group" aria-label="Filter drafts">
        {#each filters as item}
          <Button
            variant="ghost"
            aria-pressed={filter === item.value}
            onclick={() => (filter = item.value)}>{item.label}</Button
          >
        {/each}
      </div>
    </div>
    <div class="draft-feed" aria-label="Drafts">
      {#each visible as draft (draft.id)}
        <a
          class="draft-entry"
          href={`/drafts/${draft.id}`}
          aria-label={`Open draft: ${draft.content.posts[0].text.slice(0, 80) || "Untitled draft"}`}
        >
          <PostPreview
            content={{ ...draft.content, posts: [draft.content.posts[0]] }}
            media={data.media}
            timeline
          />
          {#if !draft.content.posts[0].text && !draft.content.posts[0].media.length}<p
              class="draft-placeholder"
            >
              No text yet
            </p>{/if}
          {#if draft.content.posts.length > 1}<div class="draft-thread">
              <Icon name="thread" size={16} />Show thread · {draft.content.posts
                .length} posts
            </div>{/if}
          <div class="draft-meta">
            <span class:shared={draft.shared}
              ><Icon
                name={draft.shared ? "link" : "lock"}
                size={16}
              />{draft.shared ? "Shared" : "Only you"}</span
            >
            {#if draft.feedback}<span class="feedback"
                ><Icon name="comment" size={16} />{draft.feedback} open {draft.feedback ===
                1
                  ? "comment"
                  : "comments"}</span
              >{/if}
            <time
              datetime={draft.updated_at}
              title={`Updated ${new Date(draft.updated_at).toLocaleString()}`}
              >Updated {relativeTime(draft.updated_at)}</time
            >
          </div>
        </a>
      {:else}
        <div class="empty">
          <h2>No matching drafts.</h2>
          <Button
            variant="outline"
            onclick={() => {
              query = "";
              filter = "all";
            }}>Clear search and filters</Button
          >
        </div>
      {/each}
    </div>
  {/if}
</main>

<style>
  .drafts-page {
    width: 100%;
    max-width: 600px;
    margin: 36px auto 64px;
  }
  .drafts-heading {
    padding: 0 16px 24px;
    gap: 12px;
  }
  h1 {
    font-size: 26px;
    margin: 0;
    letter-spacing: -0.8px;
  }
  .drafts-controls {
    padding: 0 16px;
  }
  .drafts-sort {
    margin: 12px 0 8px;
    gap: 12px;
  }
  select {
    width: auto;
    min-height: 40px;
    font-size: 13px;
    padding: 6px 10px;
  }
  .drafts-filters {
    display: flex;
    justify-content: space-between;
    gap: 0;
  }
  .drafts-filters :global(button) {
    border-radius: 0;
    border-bottom: 2px solid transparent;
    padding: 12px 10px;
    min-height: 44px;
    color: var(--muted-foreground);
  }
  .drafts-filters :global(button[aria-pressed="true"]) {
    color: var(--foreground);
    border-bottom-color: var(--primary);
  }
  .draft-feed {
    background: #000;
    border: 1px solid #2f3336;
  }
  .draft-entry {
    display: block;
    color: #e7e9ea;
    transition: background 120ms;
  }
  .draft-entry + .draft-entry {
    border-top: 1px solid #2f3336;
  }
  .draft-entry:hover {
    background: #080808;
    color: #e7e9ea;
  }
  .draft-entry:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: -2px;
  }
  .draft-entry :global(.post-text) {
    display: -webkit-box;
    -webkit-line-clamp: 6;
    line-clamp: 6;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .draft-entry :global(.post-link) {
    color: var(--x-blue);
  }
  .draft-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 18px;
    margin: 0 16px 0 68px;
    padding: 0 0 16px;
    font-size: 12px;
    color: #93989d;
  }
  .draft-meta span,
  .draft-thread {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .draft-meta .shared,
  .draft-meta .feedback {
    color: var(--primary);
  }
  .draft-meta time {
    margin-left: auto;
  }
  .draft-thread,
  .draft-placeholder {
    margin: 0 16px 14px 68px;
    font-size: 13px;
    color: #93989d;
  }
  .draft-thread {
    color: var(--primary);
  }
  @media (max-width: 600px) {
    .drafts-page {
      margin-top: 24px;
    }
    .draft-feed {
      border-inline: 0;
    }
    .draft-meta,
    .draft-thread,
    .draft-placeholder {
      margin-left: 62px;
      margin-right: 12px;
    }
    .draft-meta time {
      margin-left: 0;
    }
  }
  @media (max-width: 360px) {
    h1 {
      font-size: 23px;
    }
    .drafts-filters :global(button) {
      padding-inline: 6px;
      font-size: 12px;
    }
  }
</style>
