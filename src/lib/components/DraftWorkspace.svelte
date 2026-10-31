<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Popover } from "bits-ui";
  import { getContext, onDestroy, untrack } from "svelte";
  import { page } from "$app/state";
  import { replaceState } from "$app/navigation";
  import * as Tabs from "$lib/components/ui/tabs/index.js";
  import { enhance } from "$app/forms";
  import Icon from "$lib/components/Icon.svelte";
  import Brand from "$lib/components/Brand.svelte";
  import PostPreview from "$lib/components/PostPreview.svelte";
  import { avatarURL, relativeTime, xPostURLSchema } from "$lib/contracts";
  import type { PageData, ActionData } from "../../routes/(app)/$types";
  let {
    data,
    form,
    feedbackPage = false,
  }: { data: PageData; form?: ActionData; feedbackPage?: boolean } = $props();
  const navigation = getContext<{ reveal: () => void }>("mobile-navigation");
  let busy = $state(false);
  let createOpen = $state<string | null>(null);
  let clipboardURL = $state("");
  let pasteMessage = $state("");
  let pasteTimer: ReturnType<typeof setTimeout>;
  let clipboardRequest = 0;
  let createError = $state("");
  onDestroy(() => clearTimeout(pasteTimer));
  function pasteFailed(message: string) {
    clearTimeout(pasteTimer);
    pasteMessage = message;
    pasteTimer = setTimeout(() => (pasteMessage = ""), 2200);
  }
  function acceptLink(text: string, showError = true) {
    ++clipboardRequest;
    const parsed = xPostURLSchema.safeParse(text);
    clipboardURL = parsed.success ? parsed.data : "";
    createError = "";
    clearTimeout(pasteTimer);
    pasteMessage = "";
    if (!parsed.success && showError) pasteFailed("No X link copied");
  }
  async function readClipboard(automatic = false) {
    const request = ++clipboardRequest;
    try {
      if (automatic) {
        const permission = await navigator.permissions.query({
          name: "clipboard-read" as PermissionName,
        });
        if (
          permission.state !== "granted" ||
          request !== clipboardRequest ||
          !createOpen ||
          !document.hasFocus()
        )
          return;
      }
      const text = await navigator.clipboard.readText();
      if (request !== clipboardRequest || !createOpen) return;
      acceptLink(text, !automatic);
    } catch {
      if (automatic || request !== clipboardRequest || !createOpen) return;
      pasteFailed("Couldn’t paste link");
    }
  }
  function openCreation(open: boolean, location: string) {
    createOpen = open ? location : null;
    ++clipboardRequest;
    clearTimeout(pasteTimer);
    if (open) {
      clipboardURL = "";
      pasteMessage = "";
      createError = "";
      void readClipboard(true);
    }
  }
  let draftList = $state<HTMLDivElement>();
  let scrollY = $state(0);
  let endRequiresScroll = $state(false);
  $effect(() => {
    const list = draftList;
    if (!list) return;
    const navigation = document.querySelector<HTMLElement>(".app-navigation");
    const measure = () => {
      const bottomBar =
        navigation && getComputedStyle(navigation).flexDirection === "row"
          ? navigation.getBoundingClientRect().height
          : 0;
      endRequiresScroll =
        list.getBoundingClientRect().bottom + window.scrollY >
        window.innerHeight - bottomBar + 1;
    };
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    if (navigation) observer.observe(navigation);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  });
  let query = $state("");
  let filter = $state(
    untrack(() => feedbackPage)
      ? "all"
      : ["review", "done"].includes(page.url.searchParams.get("tab") ?? "")
        ? page.url.searchParams.get("tab")!
        : "drafts",
  );
  const search = $derived(query.trim().toLocaleLowerCase());
  const matchingFeedback = $derived(
    data.comments.filter((comment) =>
      [comment.name, comment.body, comment.suggestion, comment.quote].some(
        (text) => text?.toLocaleLowerCase().includes(search),
      ),
    ),
  );
  const recentFeedback = $derived(
    data.comments.filter((comment) => !comment.resolved).slice(0, 5),
  );
  const visibleComments = $derived(
    matchingFeedback.filter(
      (comment) =>
        filter === "all" ||
        (filter === "resolved" ? comment.resolved : !comment.resolved),
    ),
  );
  const filters = [
    { value: "drafts", label: "Drafts", icon: "drafts" },
    { value: "review", label: "To review", icon: "review" },
    { value: "done", label: "Done", icon: "done" },
  ];
  const counts = $derived({
    drafts: data.drafts.filter((d) => !d.posted_at).length,
    review: data.reviews.filter((r) => !r.completed_at).length,
  });
  const visible = $derived(
    (filter === "review"
      ? data.reviews.filter((r) => !r.completed_at)
      : filter === "done"
        ? [
            ...data.drafts.filter((d) => d.posted_at),
            ...data.reviews.filter((r) => r.completed_at),
          ].sort((a, b) => b.posted_at!.localeCompare(a.posted_at!))
        : data.drafts.filter((d) => !d.posted_at)
    ).filter((draft) =>
      draft.content.posts.some((post) =>
        post.text.toLocaleLowerCase().includes(search),
      ),
    ),
  );
</script>

<svelte:window
  bind:scrollY
  onpaste={(event) => {
    if (!createOpen || busy || event.defaultPrevented) return;
    if (
      event.target instanceof Element &&
      event.target.closest('input, textarea, [contenteditable="true"]')
    )
      return;
    event.preventDefault();
    acceptLink(event.clipboardData?.getData("text/plain") || "");
  }}
/>

{#snippet newPost(
  label = "New post",
  secondary = false,
  options = false,
  location = "primary",
)}
  <div class="share-actions">
    {#if location !== "floating" || !data.xSourcesEnabled}
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
        <Button
          type="submit"
          variant={secondary ? "outline" : "default"}
          aria-label={location === "floating" ? "New post" : undefined}
          disabled={busy}
          ><Icon
            name="plus"
            size={location === "floating" ? 28 : 16}
          />{#if location !== "floating"}{busy
              ? "Opening…"
              : label}{/if}</Button
        >
      </form>
    {/if}
    {#if options && data.xSourcesEnabled}<Popover.Root
        open={createOpen === location}
        onOpenChange={(open) => openCreation(open, location)}
      >
        <Popover.Trigger
          >{#snippet child({ props })}
            <Button
              {...props}
              variant={secondary ? "outline" : "default"}
              disabled={busy}
              class={location === "floating"
                ? "floating-trigger"
                : "share-toggle"}
              aria-label={location === "floating"
                ? "New post"
                : "New post options"}
              ><Icon
                name={location === "floating" ? "plus" : "down"}
                size={location === "floating" ? 28 : 15}
              /></Button
            >
          {/snippet}</Popover.Trigger
        >
        <Popover.Content
          class="share-menu create-menu"
          sideOffset={8}
          align="end"
          role="dialog"
          aria-label="New post actions"
        >
          {#if clipboardURL}
            <div class="clipboard-source">
              <strong>From X</strong>
              <p>
                <Icon name="link" size={16} /><span
                  >{clipboardURL.replace("https://", "")}</span
                >
              </p>
            </div>
            {#each ["reply", "quote"] as sourceKind}
              <form
                method="POST"
                action="?/create"
                use:enhance={() => {
                  busy = true;
                  createError = "";
                  return async ({ result, update }) => {
                    busy = false;
                    if (result.type === "failure" || result.type === "error") {
                      createError =
                        result.type === "failure"
                          ? (result.data?.error as string) ||
                            "Couldn’t create your post. Try again."
                          : "Couldn’t create your post. Try again.";
                    } else {
                      createOpen = null;
                      await update();
                    }
                  };
                }}
              >
                <input type="hidden" name="kind" value={sourceKind} />
                <input type="hidden" name="url" value={clipboardURL} />
                <Button variant="ghost" type="submit" disabled={busy}>
                  <Icon name={sourceKind} size={18} />{sourceKind === "reply"
                    ? "New reply"
                    : "New quote"}
                </Button>
              </form>
            {/each}
            {#if createError}<p class="clipboard-error" role="alert">
                {createError}
              </p>{/if}
          {:else}
            <Button
              variant="ghost"
              onclick={() => readClipboard()}
              aria-label={pasteMessage || "Paste to reply or quote"}
            >
              <Icon name="copy" size={18} />
              <span class="paste-label">
                <span class:paste-hidden={!!pasteMessage}
                  >Paste to reply or quote</span
                >
                <span
                  class="paste-message"
                  class:paste-hidden={!pasteMessage}
                  aria-hidden="true">{pasteMessage}</span
                >
              </span>
            </Button>
            <span class="sr-only" role="status">{pasteMessage}</span>
            <div class="creation-divider"></div>
            <form
              method="POST"
              action="?/create"
              use:enhance={() => {
                busy = true;
                return async ({ update }) => {
                  await update();
                  busy = false;
                  createOpen = null;
                };
              }}
            >
              <Button type="submit" variant="ghost" disabled={busy}
                ><Icon name="plus" size={16} />New post</Button
              >
            </form>
          {/if}
        </Popover.Content>
      </Popover.Root>{/if}
  </div>
{/snippet}

<Tabs.Root
  bind:value={filter}
  class="contents"
  onValueChange={(value) => {
    if (!feedbackPage) {
      const url = new URL(page.url.href);
      if (value === "drafts") url.searchParams.delete("tab");
      else url.searchParams.set("tab", value);
      replaceState(url, page.state);
    }
  }}
>
  <main
    class="drafts-page"
    class:feedback-page={feedbackPage}
    aria-label={feedbackPage ? "Feedback" : "Drafts"}
  >
    <div class="feed-toolbar" onfocusin={() => navigation.reveal()}>
      <div class="drafts-filters">
        {#if feedbackPage}
          <div role="group" aria-label="Filter feedback" class="contents">
            {#each feedbackPage ? [{ value: "all", label: "All", icon: "comment" }, { value: "open", label: "Open", icon: "eye" }, { value: "resolved", label: "Resolved", icon: "check" }] : filters as item}
              <Button
                variant="ghost"
                aria-pressed={filter === item.value}
                onclick={() => (filter = item.value)}
                ><Icon name={item.icon} size={16} />{item.label}</Button
              >
            {/each}
          </div>
        {:else}
          <Tabs.List
            variant="line"
            class="w-full h-11 p-0 gap-0"
            aria-label="Draft queues"
          >
            {#each filters as item}
              <Tabs.Trigger
                value={item.value}
                aria-label={item.value === "done"
                  ? item.label
                  : `${item.label} ${counts[item.value as keyof typeof counts]}`}
                ><Icon
                  name={item.icon}
                  size={18}
                />{item.label}{#if item.value !== "done"}<span
                    class="queue-count"
                    >{counts[item.value as keyof typeof counts]}</span
                  >{/if}</Tabs.Trigger
              >
            {/each}
          </Tabs.List>
        {/if}
      </div>
    </div>
    <div class="draft-search">
      <Icon name="search" size={18} />
      <Input
        type="search"
        aria-label={feedbackPage ? "Search feedback" : "Search posts"}
        placeholder={feedbackPage ? "Search feedback" : "Search posts"}
        bind:value={query}
      />
    </div>
    <div class="drafts-actions">
      {@render newPost("New post", false, true)}
      {#if form?.error}<p role="alert" class="action-error">
          {form.error}
        </p>{/if}
    </div>
    <div class="floating-create">
      {@render newPost("New post", false, true, "floating")}
      {#if form?.error}<p role="alert" class="action-error">
          {form.error}
        </p>{/if}
    </div>
    <Tabs.Content value={filter} class="contents">
      <section
        class="drafts-column"
        aria-label={feedbackPage ? "Feedback feed" : "Draft feed"}
      >
        {#if feedbackPage}
          {#each visibleComments as comment (comment.id)}
            {@render feedbackEntry(comment)}
          {:else}
            <div class="empty">
              <div class="empty-mascot"><Brand markOnly decorative /></div>
              <h2>{search ? "Not a peep." : "A little quiet here."}</h2>
              <p>
                {search
                  ? "No feedback matches that search."
                  : "Share a draft for a second pair of eyes."}
              </p>
              {#if search || filter !== "all"}<Button
                  variant="outline"
                  onclick={() => {
                    query = "";
                    filter = "all";
                  }}>Clear search and filters</Button
                >{:else}<Button href="/" variant="outline">Browse drafts</Button
                >{/if}
            </div>
          {/each}
        {:else if !data.drafts.length && !data.reviews.length && filter === "drafts"}
          <div class="empty">
            <div class="empty-mascot"><Brand markOnly decorative /></div>
            <h2>Start something worth sharing.</h2>
            <p>Nothing to peek at. Yet. Let’s change that.</p>
            {@render newPost("Write your first post")}
          </div>
        {:else}
          <div class="draft-feed" aria-label="Drafts" bind:this={draftList}>
            {#each visible as draft (draft.id)}
              {@const href = draft.token
                ? `/r/${draft.token}`
                : `/drafts/${draft.id}`}
              <article class="draft-entry" aria-label="Draft preview">
                <a
                  class="draft-open"
                  {href}
                  onclick={(event) => {
                    if ((event.target as Element).closest("video"))
                      event.preventDefault();
                  }}
                  aria-label={`${draft.token ? "Review post" : "Open draft"}: ${draft.content.posts[0].text.slice(0, 80) || "Untitled draft"}`}
                >
                  <PostPreview
                    content={{
                      ...draft.content,
                      posts: [draft.content.posts[0]],
                    }}
                    media={data.media}
                    token={draft.token ?? undefined}
                    timeline
                    updatedAt={draft.updated_at}
                  />
                  {#if !draft.content.posts[0].text && !draft.content.posts[0].media.length}<p
                      class="draft-placeholder"
                    >
                      No text yet
                    </p>{/if}
                </a>
                <div class="draft-meta">
                  <Button
                    variant="ghost"
                    class="draft-stat stat-thread"
                    {href}
                    aria-label={`${draft.content.posts.length} ${draft.content.posts.length === 1 ? "post" : "posts"} in thread`}
                  >
                    <span class="stat-icon"
                      ><Icon name="thread" size={20} /></span
                    >{draft.content.posts.length}
                    <span class="stat-tooltip" role="tooltip"
                      >{draft.content.posts.length === 1
                        ? "Post"
                        : "Thread"}</span
                    >
                  </Button>
                  <Button
                    variant="ghost"
                    class="draft-stat stat-feedback"
                    href={`${href}#feedback`}
                    aria-label={`${draft.feedback} open ${draft.feedback === 1 ? "comment" : "comments"}`}
                  >
                    <span class="stat-icon"
                      ><Icon name="comment" size={20} /></span
                    >{draft.feedback}
                    <span class="stat-tooltip" role="tooltip">Feedback</span>
                  </Button>
                  <Button
                    variant="ghost"
                    class="draft-stat stat-sharing"
                    {href}
                    aria-label={draft.shared
                      ? "Shared for review"
                      : "Only you — not shared"}
                  >
                    <span class="stat-icon"
                      ><Icon
                        name={draft.shared ? "link" : "lock"}
                        size={20}
                      /></span
                    >
                    <span class="stat-tooltip" role="tooltip"
                      >{draft.shared ? "Shared" : "Only you"}</span
                    >
                  </Button>
                  {#if draft.posted_at}<span class="queue-status"
                      ><Icon name="done" size={16} />{draft.token
                        ? "Reviewed"
                        : "Posted"}</span
                    >{/if}
                </div>
              </article>
            {:else}
              <div class="empty">
                <div class="empty-mascot"><Brand markOnly decorative /></div>
                <h2>
                  {search
                    ? "Not a peep."
                    : filter === "done"
                      ? "Good things take a little work."
                      : "All clear."}
                </h2>
                <p>
                  {search
                    ? "No posts match that search."
                    : filter === "review"
                      ? "No posts waiting for your feedback."
                      : filter === "done"
                        ? "Posted drafts and finished reviews will land here."
                        : "Nothing left to post. Make room for your next idea."}
                </p>
                <div class="empty-actions">
                  {#if search}
                    <Button
                      variant="outline"
                      onclick={() => {
                        query = "";
                        filter = "drafts";
                      }}>Clear search and filters</Button
                    >
                  {/if}
                  {@render newPost("New post", true)}
                </div>
              </div>
            {/each}
          </div>
          {#if visible.length && endRequiresScroll && scrollY > 0}
            <div class="feed-end" role="group" aria-label="End of drafts">
              <div class="empty-actions">
                <Button
                  variant="ghost"
                  onclick={() =>
                    window.scrollTo({
                      top: 0,
                      behavior: matchMedia("(prefers-reduced-motion: reduce)")
                        .matches
                        ? "instant"
                        : "smooth",
                    })}
                >
                  <Icon name="up" size={16} />Back to top
                </Button>
                {@render newPost("New post", true, true, "end")}
              </div>
            </div>
          {/if}
        {/if}
      </section>
    </Tabs.Content>
    <aside
      class="recent-feedback"
      class:recent-drafts={feedbackPage}
      aria-label={feedbackPage ? "Recent drafts" : "Recent feedback"}
    >
      {#if feedbackPage}
        <h2>Recent drafts</h2>
        {#each data.drafts.slice(0, 5) as draft}
          <a class="feedback-entry" href={`/drafts/${draft.id}`}
            ><span class="stat-icon"><Icon name="drafts" size={22} /></span>
            <div class="feedback-content">
              <p class="feedback-body">
                {draft.content.posts[0].text || "Untitled draft"}
              </p>
              <time class="feedback-status" datetime={draft.updated_at}
                >{relativeTime(draft.updated_at)}</time
              >
            </div></a
          >
        {:else}<p class="feedback-empty">
            Your next idea starts with a draft.
          </p>{/each}
      {:else}
        <h2>Recent feedback</h2>
        {#each recentFeedback as comment (comment.id)}
          {@render feedbackEntry(comment)}
        {:else}
          <p class="feedback-empty">
            No open feedback. A second pair of eyes will show up here.
          </p>
        {/each}
        <Button variant="ghost" href="/feedback" class="all-feedback"
          >View all feedback<Icon name="arrow" size={16} /></Button
        >
      {/if}
    </aside>
  </main>
</Tabs.Root>

{#snippet feedbackEntry(comment: (typeof data.comments)[number])}
  {@const draft = data.drafts.find((draft) => draft.id === comment.draft_id)!}
  <a
    class="feedback-entry"
    href={`/drafts/${comment.draft_id}#feedback-${comment.id}`}
    aria-label={`Open feedback from ${comment.name}: ${comment.body.slice(0, 80)}`}
  >
    <span class="avatar feedback-avatar" aria-hidden="true">
      {#if comment.avatar_id}<img src={avatarURL(comment.avatar_id)} alt="" />
      {:else}{comment.name.slice(0, 1).toUpperCase()}{/if}
    </span>
    <div class="feedback-content">
      <div class="feedback-byline">
        <strong>{comment.name}</strong>
        <time datetime={comment.created_at}
          >{relativeTime(comment.created_at)}</time
        >
      </div>
      <p class="feedback-body">{comment.body}</p>
      <p class="feedback-draft">
        {draft.content.posts[0].text || "Untitled draft"}
      </p>
      {#if comment.revision !== draft.shared_revision}
        <span class="feedback-status">Earlier feedback</span>
      {/if}
      {#if comment.resolved}
        <span class="feedback-status">Resolved</span>
      {/if}
    </div>
  </a>
{/snippet}

<style>
  .queue-count {
    color: var(--muted-foreground);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .queue-status {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-left: auto;
    color: var(--muted-foreground);
    font-size: 12px;
  }
  :global(.create-menu) {
    width: min(320px, calc(100vw - 32px));
    max-height: min(520px, calc(100dvh - 100px));
    overflow-y: auto;
  }
  :global(.create-menu [data-slot="button"]) {
    min-height: 44px;
  }
  .clipboard-source {
    min-width: 0;
    padding: 8px;
  }
  .paste-label {
    display: grid;
    text-align: left;
  }
  .paste-label span {
    grid-area: 1 / 1;
    transition: opacity 220ms ease;
  }
  .paste-message {
    color: var(--danger);
  }
  .paste-hidden {
    opacity: 0;
  }
  @media (prefers-reduced-motion: reduce) {
    .paste-label span {
      transition: none;
    }
  }
  .clipboard-source p {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--muted-foreground);
    font-size: 13px;
    margin: 8px 0 0;
  }
  .clipboard-source span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .creation-divider {
    border-top: 1px solid var(--border);
    margin: 4px 0;
  }
  .clipboard-error {
    color: var(--danger);
    font-size: 13px;
    padding: 4px 8px;
    margin: 0;
  }
  .feed-toolbar {
    display: contents;
  }
  .floating-create {
    display: none;
  }
  .feedback-page .drafts-column > .feedback-entry {
    border-bottom: 1px solid var(--border);
    border-top: 0;
  }
  :global(.all-feedback) {
    width: 100%;
  }
  .drafts-page {
    width: 100%;
    display: grid;
    grid-template-columns: minmax(0, 600px) minmax(0, 1fr);
    grid-template-areas: "tabs search" "feed create" "feed feedback";
    grid-template-rows: 44px auto 1fr;
    gap: 0 24px;
    margin: 0 auto;
    min-height: 100dvh;
  }
  .drafts-column {
    grid-area: feed;
    min-width: 0;
    border-inline: 1px solid #2f3336;
  }
  .drafts-actions {
    grid-area: create;
    position: sticky;
    top: 0;
    align-self: start;
    z-index: 10;
    background: var(--background);
    padding: 12px 0;
  }
  .drafts-actions .share-actions {
    width: 100%;
  }
  .drafts-actions form {
    flex: 1;
  }
  .drafts-actions form :global(button) {
    width: 100%;
    min-height: 44px;
  }
  .drafts-actions :global(.share-toggle) {
    min-height: 44px;
  }
  .draft-search > :global(svg) {
    position: absolute;
    left: 14px;
    top: 17px;
    color: var(--muted-foreground);
    pointer-events: none;
  }
  .draft-search {
    position: relative;
    grid-area: search;
    padding-top: 8px;
  }
  .draft-search :global(input) {
    border-radius: 999px;
    padding-left: 40px;
    min-height: 36px;
    height: 36px;
  }
  .recent-feedback {
    grid-area: feedback;
    align-self: start;
    border: 1px solid var(--border);
    border-radius: 16px;
    overflow: hidden;
  }
  .recent-feedback h2 {
    margin: 0;
    padding: 16px;
    font-size: 20px;
  }
  .feedback-entry {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 16px;
    color: var(--foreground);
    transition: background 120ms;
  }
  .feedback-avatar {
    width: 32px;
    height: 32px;
    font-size: 13px;
  }
  .feedback-content {
    min-width: 0;
    flex: 1;
  }
  .feedback-entry + .feedback-entry {
    border-top: 1px solid var(--border);
  }
  .feedback-entry:hover {
    background: var(--secondary);
  }
  .feedback-entry:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: -2px;
  }
  .feedback-byline {
    display: flex;
    gap: 12px;
    align-items: baseline;
    font-size: 14px;
  }
  .feedback-byline time {
    margin-left: auto;
    flex-shrink: 0;
    color: var(--muted-foreground);
    font-size: 12px;
  }
  .feedback-byline strong {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .feedback-body,
  .feedback-draft {
    margin: 8px 0 0;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .feedback-body {
    font-size: 14px;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    white-space: pre-wrap;
  }
  .feedback-draft {
    padding-left: 10px;
    border-left: 2px solid var(--border);
    font-size: 13px;
    color: var(--muted-foreground);
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
  .feedback-status {
    display: block;
    margin-top: 8px;
    font-size: 12px;
    color: var(--muted-foreground);
  }
  .feedback-empty {
    border: 0;
    border-radius: 0;
    text-align: left;
    margin: 0;
    padding: 0 16px 20px;
    color: var(--muted-foreground);
    font-size: 14px;
  }
  .drafts-column .empty {
    border: 0;
    border-radius: 0;
    margin: 0;
    padding: 72px 24px;
    background: transparent;
  }
  .empty-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 12px;
  }
  .feed-end {
    padding: 32px 24px;
    text-align: center;
  }
  .empty-mascot {
    margin: 0 auto 24px;
    width: 88px;
  }
  .empty-mascot :global(svg) {
    width: 88px;
    height: auto;
  }
  .empty h2 {
    margin: 0;
    font-size: 24px;
    letter-spacing: -0.6px;
  }
  .empty p {
    max-width: 300px;
    margin: 12px auto 28px;
    color: var(--muted-foreground);
    font-size: 15px;
  }
  .drafts-filters {
    grid-area: tabs;
    display: flex;
    border: 1px solid #2f3336;
    border-top: 0;
    gap: 0;
  }
  .drafts-filters :global(button) {
    flex: 1;
    height: 100%;
    border-radius: 0;
    border-bottom: 2px solid transparent;
    padding: 8px 10px;
    min-height: 44px;
    color: var(--muted-foreground);
    transition:
      color 120ms,
      background-color 120ms,
      border-color 120ms;
  }
  .drafts-filters :global(button[aria-pressed="true"]),
  .drafts-filters :global(button[data-state="active"]) {
    color: var(--foreground);
    border-bottom-color: var(--primary);
    box-shadow: none;
  }
  .draft-feed {
    background: transparent;
  }
  .draft-entry {
    display: block;
    color: #e7e9ea;
    border-bottom: 1px solid #2f3336;
  }
  .draft-open {
    display: block;
  }
  .draft-open:hover {
    color: #e7e9ea;
  }
  .draft-open:focus-visible {
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
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    margin: 0 16px 0 68px;
    padding-bottom: 8px;
  }
  .draft-meta :global(.draft-stat) {
    --stat-color: #1d9bf0;
    position: relative;
    height: 44px;
    padding: 0 8px 0 0;
    gap: 2px;
    color: #71767b;
    font-size: 13px;
    background: transparent;
    transition: color 150ms;
  }
  .draft-meta :global(.stat-feedback) {
    --stat-color: #f91880;
  }
  .draft-meta :global(.stat-sharing) {
    --stat-color: #00ba7c;
  }
  .draft-meta :global(.draft-stat:is(:hover, :focus-visible)) {
    color: var(--stat-color);
    background: transparent;
  }
  .stat-icon {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    transition: background-color 150ms;
  }
  .draft-meta :global(.draft-stat:is(:hover, :focus-visible) .stat-icon) {
    background: color-mix(in srgb, var(--stat-color) 12%, transparent);
  }
  .stat-tooltip {
    position: absolute;
    top: calc(100% - 1px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 20;
    pointer-events: none;
    padding: 3px 7px;
    border-radius: 4px;
    background: #495560;
    color: #fff;
    font-size: 11px;
    line-height: 16px;
    white-space: nowrap;
    visibility: hidden;
    opacity: 0;
    transition:
      opacity 120ms,
      visibility 120ms;
  }
  .draft-meta :global(.draft-stat:is(:hover, :focus-visible) .stat-tooltip) {
    visibility: visible;
    opacity: 1;
    transition-delay: 180ms;
  }
  .draft-placeholder {
    margin: 0 16px 14px 68px;
    font-size: 13px;
    color: #93989d;
  }
  @media (max-width: 1000px) {
    .drafts-page {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas: "tabs" "search" "create" "feed" "feedback";
      grid-template-rows: 44px auto auto 1fr auto;
    }
    .draft-search {
      padding: 12px 16px;
      border-inline: 1px solid #2f3336;
    }
    .draft-search > :global(svg) {
      left: 30px;
      top: 23px;
    }
    .draft-search :global(input) {
      min-height: 40px;
      height: 40px;
    }
    .drafts-actions {
      top: 0;
      padding: 0 16px 12px;
      border-inline: 1px solid #2f3336;
      border-bottom: 1px solid #2f3336;
    }
    .recent-feedback {
      margin: 24px 16px;
    }
  }
  @media (max-width: 600px) {
    .drafts-page {
      min-height: calc(
        100dvh - 100px - var(--mobile-nav-inset) -
          env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)
      );
      padding-top: 44px;
      grid-template-areas: "search" "feed";
      grid-template-rows: auto 1fr;
    }
    .feed-toolbar {
      display: block;
      position: fixed;
      left: 0;
      right: 0;
      top: calc(52px + env(safe-area-inset-top, 0px));
      z-index: 25;
      background: var(--background);
      transform: translate3d(0, calc(-1 * var(--mobile-chrome-offset)), 0);
      will-change: transform;
    }
    .drafts-filters {
      height: 44px;
    }
    .draft-search {
      height: 60px;
      padding-block: 9px 10px;
      border-bottom: 1px solid var(--border);
    }
    .draft-search > :global(svg) {
      top: 21px;
    }
    .drafts-actions,
    .recent-feedback {
      display: none;
    }
    .floating-create {
      display: block;
      position: fixed;
      right: 20px;
      bottom: calc(60px + var(--mobile-nav-inset));
      z-index: 35;
      transform: translate3d(0, calc(var(--mobile-chrome-progress) * 48px), 0);
      will-change: transform;
    }
    .floating-create .action-error {
      position: absolute;
      right: 0;
      bottom: 100%;
      width: min(280px, calc(100vw - 40px));
      margin: 0 0 8px;
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--card);
    }
    .floating-create :global(.floating-trigger),
    .floating-create > .share-actions > form :global(button) {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      padding: 0;
      box-shadow: 0 4px 20px #0006;
    }
    .floating-create :global(.floating-trigger svg),
    .floating-create > .share-actions > form :global(button svg) {
      width: 28px;
      height: 28px;
    }
    .feed-end {
      padding-bottom: 96px;
    }
    .drafts-column,
    .drafts-filters,
    .draft-search,
    .drafts-actions {
      border-inline: 0;
    }
    .draft-meta,
    .draft-placeholder {
      margin-left: 62px;
      margin-right: 12px;
    }
  }
  @media (max-width: 360px) {
    .drafts-filters :global(button) {
      padding-inline: 4px;
      gap: 4px;
      font-size: 12px;
    }
  }
</style>
