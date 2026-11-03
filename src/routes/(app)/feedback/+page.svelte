<script lang="ts">
  import { enhance } from "$app/forms";
  import { Input } from "$lib/components/ui/input/index.js";
  import Icon from "$lib/components/Icon.svelte";
  import * as Tabs from "$lib/components/ui/tabs/index.js";
  import { relativeTime } from "$lib/contracts";
  let { data } = $props();
  let filter = $state("unread");
  let search = $state("");
  const visible = $derived(
    data.discussions.filter(
      (row) =>
        (filter === "all" || row.unread) &&
        `${row.body} ${row.latest_body} ${row.name} ${row.draft_text}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
    ),
  );
</script>

<svelte:head><title>Discussions · LastPeek</title></svelte:head>
<main class="discussion-inbox" aria-label="Discussions">
  <header>
    <h1>Discussions</h1>
    <span class="small muted"
      >Across your drafts and conversations you’ve joined</span
    >
  </header>
  <Tabs.Root bind:value={filter}>
    <Tabs.List
      variant="line"
      class="w-full h-11 p-0 gap-0"
      aria-label="Discussion filter"
    >
      {#each ["unread", "all"] as value}<Tabs.Trigger {value}
          >{value === "unread"
            ? `Unread · ${data.discussions.filter((r) => r.unread).length}`
            : "All"}</Tabs.Trigger
        >{/each}
    </Tabs.List>
    <div class="inbox-search">
      <Icon name="search" size={18} /><Input
        aria-label="Search discussions"
        placeholder="Search discussions"
        bind:value={search}
      />
    </div>
    <Tabs.Content value={filter}
      ><section aria-label="Discussion feed">
        {#each visible as row (row.id)}
          <form method="POST" action="?/open" use:enhance>
            <input type="hidden" name="id" value={row.id} />
            <button
              type="submit"
              class="inbox-row"
              aria-label={`Open conversation: ${row.body}`}
            >
              <span class="inbox-meta"
                ><strong>{row.name}</strong><time datetime={row.updated_at}
                  >{relativeTime(row.updated_at)}</time
                >{#if row.unread}<span class="unread-dot" aria-label="Unread"
                  ></span>{/if}</span
              >
              <span class="inbox-question">{row.body}</span>
              {#if row.replies}<span class="inbox-latest"
                  >{row.latest_body}</span
                >{/if}
              <span class="inbox-context"
                >{row.own ? "Your draft" : "Reviewing"} · {row.draft_text ||
                  "Media post"}</span
              >
              <span class="small muted"
                >{row.replies} {row.replies === 1 ? "reply" : "replies"}</span
              >
            </button>
          </form>
        {:else}<div class="inbox-empty">
            <Icon name="comment" size={32} />
            <h2>
              {search
                ? "No matching discussions"
                : filter === "unread"
                  ? "All caught up"
                  : "No discussions yet"}
            </h2>
            <p class="muted">
              {search
                ? "Try another name or phrase."
                : filter === "unread"
                  ? "Your other conversations are in All."
                  : "Ask a question on a draft or leave someone feedback."}
            </p>
          </div>{/each}
      </section></Tabs.Content
    >
  </Tabs.Root>
</main>

<style>
  .discussion-inbox {
    max-width: 680px;
    margin: 0 auto;
    border-inline: 1px solid var(--line);
    min-height: 100dvh;
  }
  header {
    padding: 24px 20px 16px;
  }
  h1 {
    font-size: 20px;
    margin: 0 0 8px;
  }
  .inbox-search {
    padding: 16px;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .inbox-row {
    background: none;
    color: var(--foreground);
    border: 0;
    border-top: 1px solid var(--line);
    width: 100%;
    text-align: left;
    cursor: pointer;
    padding: 20px;
    display: grid;
    gap: 8px;
  }
  .inbox-row:hover {
    background: var(--muted);
  }
  .inbox-row:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: -2px;
  }
  .inbox-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  time {
    color: var(--muted-foreground);
    margin-left: auto;
  }
  .unread-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--primary-fill);
  }
  .inbox-question,
  .inbox-latest,
  .inbox-context {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .inbox-latest,
  .inbox-context {
    color: var(--muted-foreground);
    font-size: 13px;
  }
  .inbox-context {
    -webkit-line-clamp: 1;
    line-clamp: 1;
  }
  .inbox-empty {
    padding: 64px 20px;
    text-align: center;
  }
  .inbox-empty h2 {
    font-size: 18px;
    margin: 16px 0 8px;
  }
  @media (max-width: 600px) {
    header h1 {
      display: none;
    }
    header {
      padding-top: 16px;
    }
  }
</style>
