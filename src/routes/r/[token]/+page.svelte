<script lang="ts">
  import { Input } from "$lib/components/ui/input/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Popover } from "bits-ui";
  import { enhance } from "$app/forms";
  import { onMount } from "svelte";
  import { beforeNavigate, invalidateAll } from "$app/navigation";
  import Brand from "$lib/components/Brand.svelte";
  import PostPreview from "$lib/components/PostPreview.svelte";
  import FeedbackList from "$lib/components/FeedbackList.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import FriendControl from "$lib/components/FriendControl.svelte";
  let { data, form } = $props();
  let busy = $state(false),
    body = $state(""),
    name = $state(""),
    postId = $state(""),
    quote = $state("");
  let feedbackRevision = $state<number | null>(null);
  let identityDialog = $state<HTMLDialogElement>();
  let feedbackForm = $state<HTMLFormElement>();
  let approvalSubmit = $state<HTMLButtonElement>();
  let approvalPending = $state(false);
  let feedbackOpen = $state(false);
  let sent = $state(false);
  let signingIn = $state(false);
  const postKind = $derived(
    data.content.source?.kind === "reply"
      ? "Comment"
      : data.content.source?.kind === "quote"
        ? "Quote"
        : "Post",
  );
  const previewTitle = $derived(
    `${data.content.author.name} · ${data.content.posts.length > 1 ? "Thread" : "Post"} for review`,
  );
  const previewDescription = $derived(
    Array.from(data.content.posts[0].text.trim()).slice(0, 300).join("") ||
      "Take a look and leave your feedback.",
  );
  const previewImage = $derived(
    `${data.reviewURL}/preview.png?v=${data.revision}`,
  );
  beforeNavigate(({ cancel }) => {
    if (body && !confirm("Leave without sending your feedback?")) cancel();
  });
  function focusPost(id: string, selected: string) {
    postId = id;
    quote = selected;
    feedbackRevision ??= data.revision;
    sent = false;
  }
  onMount(() => {
    name = sessionStorage.getItem("reviewer-name") || "";
    const refresh = setInterval(() => {
      if (document.visibilityState === "visible" && !body && !postId && !busy)
        void invalidateAll();
    }, 15000);
    return () => clearInterval(refresh);
  });
</script>

<svelte:window
  onbeforeunload={(event) => {
    if (body) {
      event.preventDefault();
      event.returnValue = "";
    }
  }}
/>
<svelte:head>
  <title>{previewTitle} · LastPeek</title>
  <meta name="description" content={previewDescription} />
  {#if !data.private}
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="LastPeek" />
    <meta property="og:title" content={previewTitle} />
    <meta property="og:description" content={previewDescription} />
    <meta property="og:url" content={data.reviewURL} />
    <meta property="og:image" content={previewImage} />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta
      property="og:image:alt"
      content={`Opening post by ${data.content.author.name}: ${previewDescription}`}
    />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content={previewTitle} />
    <meta name="twitter:description" content={previewDescription} />
    <meta name="twitter:image" content={previewImage} />
    <meta
      name="twitter:image:alt"
      content={`Opening post by ${data.content.author.name}: ${previewDescription}`}
    />
  {/if}
</svelte:head>
{#if !data.reviewer}
  <header class="topbar">
    <Brand href="/login" /><a class="small muted" href="/login"
      >Sign in<Icon name="arrow" size={12} /></a
    >
  </header>
{/if}
<main class="draft-page review-page" class:guest-review={!data.reviewer}>
  <header class="draft-heading">
    <Button
      variant="ghost"
      class="icon-button"
      href={data.review
        ? data.review.completed
          ? "/?tab=done"
          : "/?tab=review"
        : data.reviewer
          ? "/"
          : "/login"}
      aria-label={data.reviewer ? "Back to drafts" : "Back"}
      onclick={(event) => {
        if (!data.reviewer && history.length > 1) {
          event.preventDefault();
          history.back();
        }
      }}><Icon name="back" size={20} /></Button
    >
    <h1>{postKind}</h1>
    {#if data.private}<span class="small muted"
        ><Icon name="lock" size={16} />Friends only</span
      >{/if}
    <FriendControl
      userId={data.ownerId}
      name={data.content.author.name}
      token={data.token}
    />
  </header>
  <section class="editor-posts" aria-label="Post for review">
    <PostPreview
      content={data.content}
      media={data.media}
      sourcePost={data.sourcePost}
      token={data.token}
      focusedPost={postId}
      onfocuspost={focusPost}
    />
  </section>
  <aside class="draft-sidebar" aria-label="Feedback">
    <form
      bind:this={feedbackForm}
      class="feedback-form"
      method="POST"
      action="?/comment"
      use:enhance={({ cancel, submitter }) => {
        approvalPending = submitter === approvalSubmit;
        feedbackOpen = false;
        if (!data.reviewer && !name.trim() && !signingIn) {
          cancel();
          identityDialog?.showModal();
          return;
        }
        busy = true;
        return async ({ result, update }) => {
          await update({ reset: false, invalidateAll: true });
          busy = false;
          signingIn = false;
          if (result.type === "success") {
            body = "";
            postId = "";
            quote = "";
            feedbackRevision = null;
            approvalPending = false;
            sent = true;
            identityDialog?.close();
            sessionStorage.setItem("reviewer-name", name);
          }
        };
      }}
    >
      <input
        type="hidden"
        name="revision"
        value={feedbackRevision ?? data.revision}
      />
      <input type="hidden" name="postId" value={postId} />
      <input type="hidden" name="quote" value={quote} />
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="currentRevision" value={data.revision} />
      <button
        bind:this={approvalSubmit}
        hidden
        type="submit"
        name="intent"
        value="looks-good"
        aria-label="Send looks-good feedback"
        formnovalidate
      ></button>
      <label
        >Your feedback<Textarea
          name="body"
          bind:value={body}
          oninput={() => {
            feedbackRevision ??= data.revision;
            sent = false;
          }}
          required
          maxlength={2000}
          rows={4}
          placeholder="What do you think?"
        /></label
      >
      {#if postId}<div class="feedback-focus">
          <div class="row between">
            <span class="small"
              >On post {data.content.posts.findIndex((p) => p.id === postId) +
                1}</span
            ><Button
              variant="ghost"
              class="icon-button"
              aria-label="Clear feedback focus"
              onclick={() => {
                postId = "";
                quote = "";
              }}><Icon name="close" size={14} /></Button
            >
          </div>
          {#if quote}<blockquote class="feedback-quote">
              {quote}
            </blockquote>{/if}
        </div>{:else}<span class="small muted"
          >General feedback · click a post or select text to focus</span
        >{/if}
      {#if form?.message && !form.success}<p class="action-error" role="alert">
          {form.message}
        </p>{/if}
      <div class="share-actions review-submit">
        <Button type="submit" disabled={busy}
          >{busy ? "Sending…" : sent ? "Feedback sent" : "Send feedback"}<Icon
            name={sent ? "check" : "arrow"}
            size={16}
          /></Button
        >
        <Popover.Root bind:open={feedbackOpen}>
          <Popover.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                class="share-toggle"
                disabled={busy}
                aria-label="Feedback options"
              >
                <Icon name="down" size={15} />
              </Button>
            {/snippet}
          </Popover.Trigger>
          <Popover.Content
            class="share-menu"
            sideOffset={8}
            align="end"
            aria-label="Feedback options"
          >
            <Button
              variant="ghost"
              disabled={busy || !!body.trim()}
              onclick={() => feedbackForm?.requestSubmit(approvalSubmit)}
            >
              <Icon name="check" size={16} />Looks good!
            </Button>
          </Popover.Content>
        </Popover.Root>
      </div>
    </form>
    <div class="draft-feedback">
      <FeedbackList
        comments={data.comments}
        revision={data.revision}
        content={data.content}
        token={data.token}
        emptyText="Be the first to give this draft a second look."
      />
    </div>
  </aside>
</main>
<dialog
  bind:this={identityDialog}
  class="confirm-dialog"
  aria-labelledby="identity-title"
>
  <h2 id="identity-title">Who’s giving feedback?</h2>
  <form
    onsubmit={(event) => {
      event.preventDefault();
      identityDialog?.close();
      feedbackForm?.requestSubmit(approvalPending ? approvalSubmit : undefined);
    }}
    class="stack"
  >
    <label
      >Your name<Input
        bind:value={name}
        required
        maxlength={80}
        autocomplete="nickname"
        placeholder="Name or username"
      /></label
    >
    <Button type="submit">Send feedback<Icon name="arrow" size={16} /></Button>
    <Button
      variant="outline"
      href="/login"
      target="_blank"
      rel="noopener noreferrer"
      onclick={() => (signingIn = true)}
      >Sign in instead<Icon name="arrow" size={16} /></Button
    >
    {#if signingIn}<Button
        variant="outline"
        onclick={() => {
          identityDialog?.close();
          feedbackForm?.requestSubmit(
            approvalPending ? approvalSubmit : undefined,
          );
        }}>Continue signed in</Button
      >{/if}
    <Button
      variant="ghost"
      type="button"
      onclick={() => identityDialog?.close()}>Keep writing</Button
    >
  </form>
</dialog>

<style>
  .review-submit > :global(button:first-child) {
    flex: 1;
  }
  .review-page {
    width: 100%;
    max-width: 932px;
    margin-inline: auto;
  }
  .guest-review {
    min-height: 0;
    flex: 1;
  }
  :global(.app-content:has(.guest-review)) {
    display: flex;
    flex-direction: column;
  }
  @media (max-width: 1000px) {
    .review-page {
      max-width: 600px;
      grid-template-areas: "heading" "posts" "form" "feedback";
      grid-template-rows: 52px auto auto 1fr;
    }
    .feedback-form {
      grid-area: form;
      padding: 24px 12px 20px;
    }
  }
</style>
