<script lang="ts">
  import { Input } from "$lib/components/ui/input/index.js";
  import DiscussionComposer from "$lib/components/DiscussionComposer.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Popover } from "bits-ui";
  import { enhance } from "$app/forms";
  import { onMount, tick } from "svelte";
  import { beforeNavigate, invalidateAll } from "$app/navigation";
  import Brand from "$lib/components/Brand.svelte";
  import PostPreview from "$lib/components/PostPreview.svelte";
  import FeedbackList from "$lib/components/FeedbackList.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import FriendControl from "$lib/components/FriendControl.svelte";
  import type { Feedback } from "$lib/contracts";
  import { unresolvedCount } from "$lib/discussions";
  let { data, form } = $props();
  let busy = $state(false),
    body = $state(""),
    name = $state(""),
    postId = $state(""),
    quote = $state("");
  let feedbackRevision = $state<number | null>(null);
  let parent = $state<Feedback | null>(null);
  let replyBody = $state("");
  let replyRevision = $state<number | null>(null);
  let lastInline = $state(false);
  let mediaId = $state("");
  let mediaTime = $state<number | null>(null);
  let identityDialog = $state<HTMLDialogElement>();
  let feedbackForm = $state<HTMLFormElement>();
  let approvalSubmit = $state<HTMLButtonElement>();
  let approvalPending = $state(false);
  let feedbackOpen = $state(false);
  let sent = $state(false);
  let signingIn = $state(false);
  const postKind = $derived(
    data.content.source?.kind === "reply"
      ? "Reply"
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
    if ((body || replyBody) && !confirm("Leave without sending your feedback?"))
      cancel();
  });
  function focusPost(id: string, selected: string) {
    postId = id;
    quote = selected;
    mediaId = "";
    mediaTime = null;
    feedbackRevision ??= data.revision;
    sent = false;
  }
  async function reply(comment: Feedback) {
    parent = comment;
    replyRevision ??= data.revision;
    sent = false;
    await tick();
    const input = document.getElementById("review-reply");
    input?.focus({ preventScroll: true });
    input?.scrollIntoView({ block: "center" });
  }
  onMount(() => {
    name = sessionStorage.getItem("reviewer-name") || "";
    const refresh = setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        !body &&
        !replyBody &&
        !postId &&
        !busy
      )
        void invalidateAll();
    }, 15000);
    return () => clearInterval(refresh);
  });
</script>

<svelte:window
  onbeforeunload={(event) => {
    if (body || replyBody) {
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
      onfocusmedia={async (id, media, time) => {
        focusPost(id, "");
        mediaId = media;
        mediaTime = time;
        await tick();
        const input = document.getElementById("review-comment");
        input?.focus({ preventScroll: true });
        input?.scrollIntoView({ block: "center" });
      }}
    />
  </section>
  <aside class="draft-sidebar" aria-label="Feedback">
    <div id="feedback" class="draft-feedback">
      <h2 class="discussion-heading">
        Discussion <span class="muted">{unresolvedCount(data.comments)}</span>
      </h2>
      {@render reviewComposer()}
      {#snippet reviewComposer(inline = false)}
        <form
          id={inline ? "review-reply-form" : "review-comment-form"}
          class="feedback-form"
          method="POST"
          action="?/comment"
          use:enhance={({ cancel, submitter, formElement }) => {
            feedbackForm = formElement;
            approvalPending = submitter?.getAttribute("value") === "looks-good";
            approvalSubmit =
              formElement.querySelector<HTMLButtonElement>(
                'button[value="looks-good"]',
              ) ?? undefined;
            lastInline = inline;
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
                if (inline) {
                  replyBody = "";
                  parent = null;
                  replyRevision = null;
                } else {
                  body = "";
                  postId = "";
                  quote = "";
                  mediaId = "";
                  mediaTime = null;
                  feedbackRevision = null;
                }
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
            value={(inline ? replyRevision : feedbackRevision) ?? data.revision}
          />
          <input type="hidden" name="postId" value={inline ? "" : postId} />
          <input type="hidden" name="quote" value={inline ? "" : quote} />
          <input
            type="hidden"
            name="parentId"
            value={inline ? (parent?.id ?? "") : ""}
          />
          <input type="hidden" name="mediaId" value={inline ? "" : mediaId} />
          {#if !inline && mediaTime !== null}<input
              type="hidden"
              name="mediaTime"
              value={mediaTime}
            />{/if}
          <input type="hidden" name="name" value={name} />
          <input type="hidden" name="currentRevision" value={data.revision} />
          <button
            hidden
            type="submit"
            name="intent"
            value="looks-good"
            aria-label="Send looks-good feedback"
            formnovalidate
          ></button>
          <DiscussionComposer
            id={inline ? "review-reply" : "review-comment"}
            label={inline ? "Your reply" : "Your feedback"}
            bind:value={
              () => (inline ? replyBody : body),
              (value) => {
                if (inline) replyBody = value;
                else body = value;
              }
            }
            user={data.reviewer ?? { name: name || "Guest" }}
            replyName={inline ? parent?.name : undefined}
            postLabel={!inline && postId
              ? `Post ${data.content.posts.findIndex((p) => p.id === postId) + 1}`
              : undefined}
            quote={inline ? "" : quote}
            media={inline
              ? undefined
              : data.media.find((m) => m.id === mediaId)}
            time={inline ? null : mediaTime}
            token={data.token}
            error={lastInline === inline && form?.message && !form.success
              ? form.message
              : undefined}
            oncancelreply={() => (parent = null)}
            onclear={() => {
              postId = "";
              quote = "";
              mediaId = "";
              mediaTime = null;
            }}
            oninput={() => {
              if (inline) replyRevision ??= data.revision;
              else feedbackRevision ??= data.revision;
              sent = false;
            }}
          >
            {#snippet actions()}
              {#if inline}<Button
                  type="submit"
                  size="sm"
                  class="min-h-11"
                  aria-label="Send reply"
                  disabled={busy}>{busy ? "Sending…" : "Reply"}</Button
                >{:else}
                <div class="share-actions review-submit">
                  <Button
                    type="submit"
                    size="sm"
                    class="min-h-11"
                    aria-label={sent ? "Feedback sent" : "Send feedback"}
                    disabled={busy}
                    >{busy ? "Sending…" : sent ? "Sent" : "Comment"}</Button
                  >
                  <Popover.Root bind:open={feedbackOpen}>
                    <Popover.Trigger>
                      {#snippet child({ props })}
                        <Button
                          {...props}
                          size="sm"
                          class="share-toggle min-h-11"
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
                        onclick={() => {
                          const current = document.getElementById(
                            "review-comment-form",
                          ) as HTMLFormElement | null;
                          current?.requestSubmit(
                            current.querySelector<HTMLButtonElement>(
                              'button[value="looks-good"]',
                            ) ?? undefined,
                          );
                        }}
                      >
                        <Icon name="check" size={16} />Looks good!
                      </Button>
                    </Popover.Content>
                  </Popover.Root>
                </div>
              {/if}
            {/snippet}
          </DiscussionComposer>
        </form>
      {/snippet}
      {#snippet replyComposer()}{@render reviewComposer(true)}{/snippet}
      <FeedbackList
        comments={data.comments}
        revision={data.revision}
        content={data.content}
        token={data.token}
        ownerId={data.ownerId}
        media={data.media}
        replyingTo={parent?.parent_id ?? parent?.id}
        composer={replyComposer}
        onreply={reply}
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
  .discussion-heading {
    font-size: 16px;
    display: flex;
    gap: 8px;
    margin: 0;
    padding: 18px 0 0;
  }
  .feedback-form {
    display: block;
    padding: 0;
    border-bottom: 1px solid var(--border);
  }
  .review-submit > :global(button:first-child) {
    flex: 1;
  }
  .review-page {
    width: 100%;
    max-width: 1004px;
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
      grid-template-areas: "heading" "posts" "feedback";
      grid-template-rows: 52px auto 1fr;
    }
  }
</style>
