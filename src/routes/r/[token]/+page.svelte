<script lang="ts">
  import DiscussionComposer from "$lib/components/DiscussionComposer.svelte";
  import ReviewPresence from "$lib/components/ReviewPresence.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Popover } from "bits-ui";
  import { enhance } from "$app/forms";
  import { getContext, tick } from "svelte";
  import type { Writable } from "svelte/store";
  import { beforeNavigate } from "$app/navigation";
  import PostPreview from "$lib/components/PostPreview.svelte";
  import FeedbackList from "$lib/components/FeedbackList.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import FriendControl from "$lib/components/FriendControl.svelte";
  import type { Feedback } from "$lib/contracts";
  import { unresolvedCount } from "$lib/discussions";
  let { data, form } = $props();
  const name = getContext<Writable<string>>("guest-name");
  const guestAccess =
    getContext<(oncontinue?: () => void) => void>("guest-access");
  let busy = $state(false),
    body = $state(""),
    postId = $state(""),
    quote = $state("");
  let feedbackRevision = $state<number | null>(null);
  let parent = $state<Feedback | null>(null);
  let replyBody = $state("");
  let replyRevision = $state<number | null>(null);
  let lastInline = $state(false);
  let mediaId = $state("");
  let mediaTime = $state<number | null>(null);
  let feedbackForm = $state<HTMLFormElement>();
  let approvalSubmit = $state<HTMLButtonElement>();
  let approvalPending = $state(false);
  let feedbackOpen = $state(false);
  let sent = $state(false);
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
  beforeNavigate(({ cancel, willUnload }) => {
    if (
      data.reviewer &&
      !willUnload &&
      (body || replyBody) &&
      !confirm("Leave without sending your feedback?")
    )
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
        if (!data.reviewer) {
          event.preventDefault();
          guestAccess();
        }
      }}><Icon name="back" size={20} /></Button
    >
    <h1>{postKind}</h1>
    <ReviewPresence token={data.token} />
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
            if (!data.reviewer && !$name.trim()) {
              cancel();
              guestAccess(() =>
                feedbackForm?.requestSubmit(
                  approvalPending ? approvalSubmit : undefined,
                ),
              );
              return;
            }
            busy = true;
            return async ({ result, update }) => {
              await update({ reset: false, invalidateAll: true });
              busy = false;
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
          <input type="hidden" name="name" value={$name} />
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
            {busy}
            error={lastInline === inline && form?.message && !form.success
              ? form.message
              : undefined}
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
                  variant="ghost"
                  type="submit"
                  size="icon"
                  class="min-h-11 min-w-11 text-primary"
                  aria-label="Send reply"
                  disabled={busy || !replyBody.trim()}
                  ><Icon name={busy ? "refresh" : "up"} size={20} /></Button
                >{:else}
                <div class="review-submit">
                  <Button
                    variant="ghost"
                    type="submit"
                    size="icon"
                    class="min-h-11 min-w-11 text-primary"
                    aria-label={sent ? "Feedback sent" : "Send feedback"}
                    disabled={busy || !body.trim()}
                    ><Icon
                      name={busy ? "refresh" : sent ? "check" : "up"}
                      size={20}
                    /></Button
                  >
                  <Popover.Root bind:open={feedbackOpen}>
                    <Popover.Trigger>
                      {#snippet child({ props })}
                        <Button
                          {...props}
                          variant="ghost"
                          size="icon-sm"
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
  }
  .review-submit {
    display: flex;
    align-items: center;
  }
  .draft-feedback {
    border-top: 0;
  }
  .review-page {
    width: 100%;
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
