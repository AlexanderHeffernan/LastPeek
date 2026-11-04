<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import DiscussionComposer from "$lib/components/DiscussionComposer.svelte";
  import ReviewPresence from "$lib/components/ReviewPresence.svelte";
  import DiscussionSplit from "$lib/components/DiscussionSplit.svelte";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Select } from "$lib/components/ui/select/index.js";
  import { applyAIEdit } from "$lib/ai";
  import { unresolvedCount } from "$lib/discussions";
  import { onMount, untrack, tick } from "svelte";
  import { Popover } from "bits-ui";
  import {
    beforeNavigate,
    goto,
    invalidateAll,
    replaceState,
  } from "$app/navigation";
  import { page } from "$app/state";
  import PostPreview from "$lib/components/PostPreview.svelte";
  import FeedbackList from "$lib/components/FeedbackList.svelte";
  import UserIdentity from "$lib/components/UserIdentity.svelte";
  import AIReview from "$lib/components/AIReview.svelte";
  import XPublish from "$lib/components/XPublish.svelte";
  import PostedOnX from "$lib/components/PostedOnX.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import * as Tabs from "$lib/components/ui/tabs/index.js";
  import {
    contentSchema,
    authorSchema,
    xPostURLSchema,
    type Content,
    type Media,
    type Feedback,
  } from "$lib/contracts";
  let { data } = $props();
  // The layout remounts this editor on draft changes. Refreshing feedback must not reset edits.
  const initial = untrack(() => data);
  const initialContent = untrack(() =>
    contentSchema.parse(initial.draft.content),
  );
  let content: Content = $state({
      ...structuredClone(initialContent),
      author: {
        name: initial.user.name,
        avatar: initial.user.avatar_id,
        handle: initial.user.handle,
      },
    }),
    media: Media[] = $state(initial.media);
  let version = $state(initial.draft.edit_version);
  let touched = $state(false);
  let inFlightSave: Promise<boolean> | undefined;
  let saved = $state(JSON.stringify(initialContent)),
    timer: ReturnType<typeof setTimeout>;
  let saving = $state(false),
    busy = $state(false),
    error = $state(""),
    status = $state("All changes saved");
  let shareToken = $state(initial.draft.share_token),
    sharedRevision = $state(initial.draft.shared_revision);
  let shareOpen = $state(false),
    origin = $state("");
  let copied = $state(false);
  let sharingOpen = $state(false);
  let commentBody = $state("");
  let replyBody = $state("");
  let replyError = $state("");
  let commentPost = $state("");
  let commentQuote = $state("");
  let commentMedia = $state("");
  let commentTime = $state<number | null>(null);
  let commentParent = $state<Feedback | null>(null);
  let commenting = $state(false);
  let commentError = $state("");
  let reviewTab = $state("discussion");
  let typeOpen = $state(false);
  let nextType = $state("post");
  let sourceURL = $state("");
  let typeError = $state("");
  let changingType = $state(false);
  let shareError = $state("");
  let moreOpen = $state(false);
  let actionStrip = $state<HTMLDivElement>();
  let compactActions = $state(false);
  $effect(() => {
    const element = actionStrip;
    const posted = !!data.draft.posted_at;
    const requiredWidth = posted
      ? 252
      : shareToken
        ? 340
        : data.recipients.length
          ? 322
          : 296;
    if (!element) return;
    const mobile = matchMedia("(max-width: 600px)");
    const measure = () => {
      compactActions = mobile.matches || element.clientWidth < requiredWidth;
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    mobile.addEventListener("change", measure);
    measure();
    return () => {
      observer.disconnect();
      mobile.removeEventListener("change", measure);
    };
  });
  let finishOpen = $state(false);
  let finishCopiedText = $state<string | null>(null);
  let finishError = $state("");
  const finishKind = $derived(
    content.source?.kind === "reply" ? "reply" : "quote",
  );
  const finishCopied = $derived(
    finishCopiedText !== null && finishCopiedText === content.posts[0].text,
  );
  async function copyForX() {
    finishError = "";
    const text = content.posts[0].text;
    try {
      await navigator.clipboard.writeText(text);
      finishCopiedText = text;
    } catch {
      finishError = "Couldn’t copy. Select and copy your text in the editor.";
    }
  }
  const postKind = $derived(
    content.source?.kind === "reply"
      ? "Reply"
      : content.source?.kind === "quote"
        ? "Quote"
        : "Post",
  );
  let confirmation: ConfirmDialog;
  let deleting = $state(false);
  let pending: {
    id: string;
    postId: string;
    file: File;
    progress: number;
    error: string;
    active: boolean;
  }[] = $state([]);
  const dirty = $derived(
    JSON.stringify(content) !== saved || (version === 0 && touched),
  );
  const uploading = $derived(pending.some((p) => p.active));
  onMount(() => {
    origin = location.origin;
    if (dirty) changed();
    return () => {
      clearTimeout(timer);
    };
  });
  beforeNavigate(({ cancel, to, willUnload, type }) => {
    if (
      initial.draft.edit_version === 0 &&
      !willUnload &&
      to &&
      dirty &&
      !uploading &&
      !error
    ) {
      cancel();
      void (async () => {
        while (dirty) {
          if (!(await save())) return;
        }
        await goto(to.url, { replaceState: type === "popstate" });
      })();
      return;
    }
    if (
      (dirty || uploading || saving || commentBody || replyBody) &&
      !confirm("There are unsaved changes or uploads. Leave this draft?")
    )
      cancel();
  });
  async function api(body: object) {
    const response = await fetch(`/api/drafts/${initial.draft.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        result.message || "This request didn’t finish. Please try again.",
      );
    return result;
  }
  function changed() {
    touched = true;
    status = "Unsaved changes";
    error = "";
    clearTimeout(timer);
    timer = setTimeout(() => {
      void save();
    }, 850);
  }
  function save(): Promise<boolean> {
    return (inFlightSave ??= persist().finally(() => {
      inFlightSave = undefined;
    }));
  }
  async function persist(): Promise<boolean> {
    clearTimeout(timer);
    if (!dirty) {
      status = "All changes saved";
      return true;
    }
    saving = true;
    status = "Saving…";
    const snapshot = JSON.stringify(content);
    try {
      const result = await api({
        action: "save",
        content: JSON.parse(snapshot),
        version,
      });
      version = result.version;
      sharedRevision = result.revision;
      content.author = authorSchema.parse(result.author);
      saved = JSON.stringify({
        ...JSON.parse(snapshot),
        author: content.author,
      });
      if (page.url.searchParams.has("new")) {
        replaceState(`/drafts/${initial.draft.id}`, page.state);
        await invalidateAll();
      }
      status = "All changes saved";
      return true;
    } catch (e) {
      error = (e as Error).message;
      status = "Not saved";
      return false;
    } finally {
      saving = false;
      if (JSON.stringify(content) !== saved && !error) changed();
    }
  }
  async function completeDraft() {
    if (uploading || !(await save())) return;
    busy = true;
    error = "";
    try {
      await api({ action: "complete", completed: true, version });
      await invalidateAll();
    } catch (cause) {
      error = (cause as Error).message;
    } finally {
      busy = false;
    }
  }
  async function publish() {
    if (
      data.recipients.length &&
      !(await confirmation.ask({
        title: "Create a review link?",
        description:
          "Anyone with the new link will be able to read and comment. Friend-only sharing will end.",
        confirmLabel: "Create review link",
        destructive: false,
      }))
    )
      return;
    busy = true;
    shareError = "";
    try {
      if (pending.some((p) => p.error))
        throw new Error("Retry or dismiss failed uploads before sharing.");
      if (!(await save())) {
        shareError = error || "Wait for your edits to finish saving.";
        return;
      }
      const result = await api({ action: "publish", version });
      await invalidateAll();
      shareToken = result.token;
      sharedRevision = result.revision;
      sharingOpen = false;
    } catch (e) {
      shareError = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  async function sendToFriend(userId: string, remove = false) {
    if (
      !remove &&
      shareToken &&
      !(await confirmation.ask({
        title: "Switch to friends only?",
        description:
          "The existing review link will stop working. Only the friends you select will have access.",
        confirmLabel: "Switch to friends only",
        destructive: false,
      }))
    )
      return;
    busy = true;
    shareError = "";
    try {
      if (!remove) {
        if (pending.some((p) => p.error))
          throw new Error("Retry or dismiss failed uploads before sharing.");
        if (!(await save())) {
          shareError = error || "Wait for your edits to finish saving.";
          return;
        }
      }
      const result = await api({
        action: remove ? "unshare-friend" : "friend",
        userId,
        version,
      });
      if (!remove) {
        shareToken = null;
        sharedRevision = result.revision;
      }
      await invalidateAll();
    } catch (e) {
      shareError = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  async function revoke() {
    if (
      !(await confirmation.ask({
        title: "Revoke this link?",
        description:
          "Anyone with it will lose access, including to attachments. Feedback will stay.",
        confirmLabel: "Revoke link",
        cancelLabel: "Keep link",
      }))
    )
      return;
    try {
      await api({ action: "revoke" });
      shareToken = null;
      shareOpen = false;
    } catch (e) {
      error = (e as Error).message;
    }
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      error =
        "Clipboard access is unavailable. Select and copy the text manually.";
      return false;
    }
  }
  async function copyLink() {
    if (await copy(`${origin}/r/${shareToken}`)) {
      copied = true;
      setTimeout(() => (copied = false), 2500);
    } else {
      error = `Couldn’t copy the link. Copy this address: ${origin}/r/${shareToken}`;
    }
  }
  function focusComment(id: string, quote: string) {
    reviewTab = "discussion";
    commentPost = id;
    commentQuote = quote;
    commentMedia = "";
    commentTime = null;
  }
  async function sendComment(inline = false) {
    commenting = true;
    if (inline) replyError = "";
    else commentError = "";
    try {
      if (!(await save())) throw new Error(error || "Save your draft first.");
      await api({
        action: "comment",
        version,
        revision: sharedRevision ?? 1,
        name: "",
        body: inline ? replyBody : commentBody,
        parentId: inline ? (commentParent?.id ?? "") : "",
        postId: inline ? "" : commentPost,
        quote: inline ? "" : commentQuote,
        mediaId: inline ? "" : commentMedia,
        mediaTime: inline ? null : commentTime,
      });
      if (inline) {
        replyBody = "";
        commentParent = null;
      } else {
        commentBody = "";
        focusComment("", "");
      }
      await invalidateAll();
    } catch (e) {
      if (inline) replyError = (e as Error).message;
      else commentError = (e as Error).message;
    } finally {
      commenting = false;
    }
  }
  async function changeType() {
    changingType = true;
    typeError = "";
    try {
      if (!(await save())) throw new Error(error || "Save your draft first.");
      const snapshot = structuredClone($state.snapshot(content));
      if (nextType === "post") delete snapshot.source;
      else {
        const parsed = xPostURLSchema.safeParse(sourceURL);
        if (!parsed.success) throw new Error("Enter a valid X post link.");
        snapshot.source = {
          kind: nextType as "reply" | "quote",
          url: parsed.data,
        };
      }
      const result = await api({ action: "save", content: snapshot, version });
      version = result.version;
      sharedRevision = result.revision;
      content.source = snapshot.source;
      content.author = authorSchema.parse(result.author);
      saved = JSON.stringify({ ...snapshot, author: content.author });
      typeOpen = false;
      await invalidateAll();
      if (dirty) changed();
    } catch (cause) {
      typeError = (cause as Error).message;
    } finally {
      changingType = false;
    }
  }
  async function apply(comment: Feedback) {
    const post = content.posts.find((p) => p.id === comment.post_id);
    if (!post || !comment.suggestion) return;
    if (
      !(await confirmation.ask({
        title: "Use this suggestion?",
        description:
          "This replaces the post’s wording. An active review link will update too.",
        confirmLabel: "Use suggestion",
        destructive: false,
      }))
    )
      return;
    post.text = comment.suggestion;
    changed();
  }
  async function upload(postId: string, files: File[]) {
    if (uploading) {
      error = "Please wait for the current upload before adding more files.";
      return;
    }
    for (const file of files) {
      const item = {
        id: crypto.randomUUID(),
        postId,
        file,
        progress: 0,
        error: "",
        active: false,
      };
      pending = [...pending, item];
      await sendUpload(item.id);
    }
  }
  async function sendUpload(id: string) {
    if (uploading) return;
    const item = pending.find((p) => p.id === id);
    if (!item) return;
    const post = content.posts.find((p) => p.id === item.postId);
    if (!post) {
      pending = pending.filter((p) => p.id !== id);
      return;
    }
    if (post.media.length >= 4) {
      item.error = "This post already has four attachments.";
      return;
    }
    const existing = media.filter((m) => post.media.includes(m.id));
    if (
      existing.some(
        (m) => m.mime.startsWith("video/") || m.mime === "image/gif",
      ) ||
      ((item.file.type.startsWith("video/") ||
        item.file.type === "image/gif") &&
        post.media.length)
    ) {
      item.error = "A video or GIF must be the only attachment on its post.";
      return;
    }
    item.active = true;
    item.error = "";
    item.progress = 0;
    try {
      if (version === 0) {
        touched = true;
        if (!(await save()))
          throw new Error(error || "Save the draft before uploading.");
      }
      const uploaded: Media = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/api/drafts/${initial.draft.id}/media`);
        xhr.timeout = 180000;
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable)
            item.progress = Math.round((e.loaded / e.total) * 100);
        };
        xhr.onload = () => {
          try {
            const value = JSON.parse(xhr.responseText);
            xhr.status === 201
              ? resolve(value)
              : reject(
                  new Error(value.message || "Upload failed. Please retry."),
                );
          } catch {
            reject(
              new Error("Upload failed. The file may exceed the server limit."),
            );
          }
        };
        xhr.onerror = xhr.ontimeout = () =>
          reject(new Error("Connection interrupted. Retry this upload."));
        const form = new FormData();
        form.set("file", item.file);
        xhr.send(form);
      });
      media = [...media, uploaded];
      const current = content.posts.find((p) => p.id === item.postId);
      if (current) {
        current.media = [...current.media, uploaded.id];
        changed();
      }
      pending = pending.filter((p) => p.id !== id);
    } catch (e) {
      item.error = (e as Error).message;
    } finally {
      item.active = false;
    }
  }
  async function removeDraft() {
    if (
      !(await confirmation.ask({
        title: "Delete this draft?",
        description:
          "This permanently deletes the draft, all feedback and all attachments. Review links will stop working. This can’t be undone.",
        confirmLabel: "Delete draft",
        cancelLabel: "Keep draft",
      }))
    )
      return;
    deleting = true;
    clearTimeout(timer);
    try {
      if (version > 0) await api({ action: "delete" });
      touched = false;
      saved = JSON.stringify(content);
      await goto("/");
    } catch (e) {
      error = (e as Error).message;
    } finally {
      deleting = false;
    }
  }
</script>

<svelte:window
  onbeforeunload={(event) => {
    if (dirty || saving || uploading || commentBody || replyBody) {
      event.preventDefault();
      event.returnValue = "";
    }
  }}
/>
<svelte:head><title>{postKind} · LastPeek</title></svelte:head>
{#snippet publishingControls()}
  {#if data.draft.posted_at}
    <PostedOnX
      draftId={data.draft.id}
      link={data.postedLink}
      confirmedURL={data.xPublishing.publication?.status === "posted"
        ? data.xPublishing.publication.url
        : null}
      disabled={busy || deleting}
    />
  {:else}
    {#if content.source}
      <Button
        variant="outline"
        aria-label="Finish in X"
        onclick={() => {
          finishCopiedText = null;
          finishError = "";
          finishOpen = true;
        }}>Finish in <Icon name="x" size={16} /></Button
      >
    {/if}
    {#if data.xPublishing.enabled || data.xPublishing.publication}<XPublish
        draftId={data.draft.id}
        {content}
        {version}
        connection={data.xPublishing}
        disabled={dirty ||
          saving ||
          uploading ||
          pending.length > 0 ||
          busy ||
          deleting}
      />{/if}
  {/if}
{/snippet}
<main class="draft-page">
  <DiscussionSplit />
  <header class="draft-heading">
    <Button
      variant="ghost"
      class="icon-button"
      href={data.draft.posted_at ? "/?tab=done" : "/"}
      aria-label="Back to drafts"><Icon name="back" size={20} /></Button
    >
    <h1>{postKind}</h1>
    {#if version > 0}<ReviewPresence draftId={data.draft.id} />{/if}
    <Button
      variant="ghost"
      class="edit-shortcut"
      onclick={() =>
        document.getElementById(`post-text-${content.posts[0].id}`)?.focus()}
      ><Icon name="edit" size={16} />Edit</Button
    >
  </header>
  <section class="editor-posts" aria-label="Edit draft">
    <PostPreview
      bind:content
      {media}
      sourcePost={data.sourcePost}
      mentionsReady={version > 0}
      mentionsURL={data.mentionsEnabled
        ? `/api/drafts/${data.draft.id}/mentions`
        : undefined}
      editing
      onchange={changed}
      onupload={upload}
      oncopy={copy}
      focusedPost={commentPost}
      onfocuspost={focusComment}
      onfocusmedia={async (id, file, time) => {
        focusComment(id, "");
        commentMedia = file;
        commentTime = time;
        await tick();
        const input = document.getElementById("author-comment");
        input?.focus({ preventScroll: true });
        input?.scrollIntoView({ block: "center" });
      }}
      publishing={data.draft.posted_at ||
      content.source ||
      data.xPublishing.enabled ||
      data.xPublishing.publication
        ? publishingControls
        : undefined}
    />
    {#each pending as item}<div class="pending">
        <div class="row between">
          <span>{item.file.name}</span><span
            >{item.active ? `${item.progress}%` : "Not uploaded"}</span
          >
        </div>
        {#if item.active}<progress
            value={item.progress}
            max="100"
            aria-label={`Uploading ${item.file.name}`}
          ></progress>{:else}<p class="danger" role="alert">{item.error}</p>
          <div class="row">
            <Button variant="outline" onclick={() => sendUpload(item.id)}
              >Retry upload</Button
            ><Button
              variant="ghost"
              onclick={() =>
                (pending = pending.filter((p) => p.id !== item.id))}
              >Dismiss</Button
            >
          </div>{/if}
      </div>{/each}
  </section>
  <aside class="draft-sidebar" aria-label="Feedback and sharing">
    <div class="draft-actions" bind:this={actionStrip}>
      <div class="share-actions">
        <Button
          variant={shareToken ? "secondary" : "default"}
          aria-busy={busy}
          disabled={busy || saving || uploading || deleting}
          onclick={() => {
            if (shareToken) void copyLink();
            else {
              shareError = "";
              sharingOpen = true;
            }
          }}
          ><Icon
            name={copied ? "check" : shareToken ? "copy" : "link"}
            size={15}
          />{busy
            ? "Preparing…"
            : shareToken
              ? copied
                ? "Copied!"
                : "Copy link"
              : data.recipients.length
                ? "Friends only"
                : "Share draft"}</Button
        >
        {#if shareToken}<Popover.Root bind:open={shareOpen}>
            <Popover.Trigger
              >{#snippet child({ props })}<Button
                  {...props}
                  variant="secondary"
                  aria-label="Review link options"
                  class="share-toggle"><Icon name="down" size={15} /></Button
                >{/snippet}</Popover.Trigger
            >
            <Popover.Content
              class="share-menu"
              sideOffset={8}
              align="end"
              aria-label="Review link actions"
            >
              <Button
                variant="ghost"
                onclick={() => {
                  shareOpen = false;
                  shareError = "";
                  sharingOpen = true;
                }}><Icon name="users" size={16} />Share with friends</Button
              >
              <Button variant="ghost" class="danger" onclick={revoke}
                ><Icon name="trash" size={16} />Remove link</Button
              >
            </Popover.Content>
          </Popover.Root>{/if}
      </div>
      <div class="secondary-actions">
        {#if !compactActions}<div class="desktop-draft-actions">
            {#if !data.draft.posted_at}<Button
                variant="secondary"
                class="icon-button"
                title="Mark as posted"
                aria-label="Mark as posted"
                disabled={busy || saving || uploading || deleting}
                onclick={() => completeDraft()}
                ><Icon name="done" size={20} /></Button
              >{/if}
            <Button
              variant="destructive"
              class="icon-button danger"
              title="Delete draft"
              aria-label="Delete draft"
              disabled={uploading || saving || busy || deleting}
              onclick={() => removeDraft()}
              ><Icon name="trash" size={20} /></Button
            >
          </div>{/if}
        {#if compactActions || (!data.draft.posted_at && !data.xPublishing.publication)}<div
          >
            <Popover.Root bind:open={moreOpen}>
              <Popover.Trigger>
                {#snippet child({ props })}
                  <Button
                    {...props}
                    variant="outline"
                    class="icon-button"
                    aria-label="More draft actions"
                    title="More draft actions"
                    ><Icon name="more" size={22} /></Button
                  >
                {/snippet}
              </Popover.Trigger>
              <Popover.Content
                class="share-menu"
                sideOffset={8}
                align="end"
                aria-label="More draft actions"
              >
                {#if !data.draft.posted_at && !data.xPublishing.publication}<Button
                    variant="ghost"
                    onclick={() => {
                      moreOpen = false;
                      nextType = content.source?.kind ?? "post";
                      sourceURL = content.source?.url ?? "";
                      typeError = "";
                      typeOpen = true;
                    }}><Icon name="edit" size={16} />Change draft type</Button
                  >{/if}
                {#if compactActions}<div>
                    {#if !data.draft.posted_at}
                      <Button
                        variant="ghost"
                        disabled={busy || saving || uploading || deleting}
                        onclick={() => {
                          moreOpen = false;
                          void completeDraft();
                        }}
                      >
                        <Icon name="done" size={16} />Mark as posted
                      </Button>
                    {/if}
                    <Button
                      variant="ghost"
                      class="danger"
                      disabled={uploading || saving || busy || deleting}
                      onclick={() => {
                        moreOpen = false;
                        void removeDraft();
                      }}><Icon name="trash" size={16} />Delete draft</Button
                    >
                  </div>{/if}
              </Popover.Content>
            </Popover.Root>
          </div>{/if}
      </div>
      <span class="sr-only" role="status">{status}</span>
      {#if error}<div class="action-error" role="alert">
          {error}{#if status === "Not saved"}<Button
              variant="ghost"
              onclick={() => save()}>Retry save</Button
            >{/if}
        </div>{/if}
    </div>
    <div id="feedback" class="draft-feedback">
      <Tabs.Root bind:value={reviewTab} class="gap-0">
        <Tabs.List
          variant="line"
          class="review-tabs w-full border-b border-border p-0 h-14"
          aria-label="Draft review"
        >
          <Tabs.Trigger value="discussion" class="text-sm"
            >Discussion <span class="muted"
              >{unresolvedCount(data.comments)}</span
            ></Tabs.Trigger
          >
          {#if data.aiEnabled || data.aiReviews.length}<Tabs.Trigger
              value="ai"
              aria-label="AI review"
              class="text-sm"
              >AI review <span
                title="Private to you. Only post text is sent to OpenAI, not attachments, identity or review links. Each run uses your AI allowance."
                aria-label="Private AI review: only post text is sent to OpenAI"
                ><Icon name="lock" size={14} /></span
              ></Tabs.Trigger
            >{/if}
        </Tabs.List>
        <Tabs.Content value="discussion">
          <div class="discussion-panel">
            {@render commentComposer()}
            {#snippet commentComposer(inline = false)}
              <form
                class="owner-comment"
                onsubmit={(event) => {
                  event.preventDefault();
                  void sendComment(inline);
                }}
              >
                <DiscussionComposer
                  id={inline ? "author-reply" : "author-comment"}
                  label={inline ? "Your reply" : "Your comment"}
                  bind:value={
                    () => (inline ? replyBody : commentBody),
                    (value) => {
                      if (inline) replyBody = value;
                      else commentBody = value;
                    }
                  }
                  replyName={inline ? commentParent?.name : undefined}
                  postLabel={!inline && commentPost
                    ? `Post ${content.posts.findIndex((p) => p.id === commentPost) + 1}`
                    : undefined}
                  quote={inline ? "" : commentQuote}
                  media={inline
                    ? undefined
                    : media.find((m) => m.id === commentMedia)}
                  time={inline ? null : commentTime}
                  error={inline ? replyError : commentError}
                  busy={commenting}
                  disabled={uploading}
                  onclear={() => focusComment("", "")}
                />
              </form>
            {/snippet}
            {#snippet replyComposer()}{@render commentComposer(true)}{/snippet}
            <FeedbackList
              comments={data.comments}
              draftId={data.draft.id}
              ownerId={data.user.id}
              {media}
              revision={dirty ? null : sharedRevision}
              {content}
              replyingTo={commentParent?.id}
              composer={replyComposer}
              emptyText="No comments yet."
              onreply={async (comment) => {
                commentParent = comment;
                await tick();
                const input = document.getElementById("author-reply");
                input?.focus({ preventScroll: true });
                input?.scrollIntoView({ block: "center" });
              }}
              onapply={apply}
              onresolve={async (comment) => {
                await api({
                  action: "resolve",
                  commentId: comment.id,
                  resolved: !comment.resolved,
                });
                if (!comment.resolved && page.url.hash)
                  replaceState(page.url.pathname + page.url.search, page.state);
                await invalidateAll();
              }}
            />
          </div>
        </Tabs.Content>
        {#if data.aiEnabled || data.aiReviews.length}<Tabs.Content value="ai">
            <AIReview
              draftId={data.draft.id}
              {content}
              history={data.aiReviews}
              enabled={data.aiEnabled && version > 0 && !saving && !dirty}
              onapply={(postId, reviewed, quote, replacement) => {
                const post = content.posts.find((p) => p.id === postId);
                if (!post) return false;
                const text = applyAIEdit(
                  post.text,
                  reviewed,
                  quote,
                  replacement,
                );
                if (text === null) return false;
                post.text = text;
                changed();
                return true;
              }}
            />
          </Tabs.Content>{/if}
      </Tabs.Root>
    </div>
  </aside>
</main>
<Dialog.Root bind:open={typeOpen}>
  <Dialog.Content class="sm:max-w-[400px]">
    <Dialog.Header
      ><Dialog.Title>Change draft type</Dialog.Title><Dialog.Description
        >Keep your writing, attachments and discussion.</Dialog.Description
      ></Dialog.Header
    >
    <form
      class="stack"
      onsubmit={(event) => {
        event.preventDefault();
        void changeType();
      }}
    >
      <label
        >Draft type<Select
          aria-label="Draft type"
          bind:value={nextType}
          disabled={changingType}
          options={[
            { value: "post", label: "Post" },
            {
              value: "reply",
              label: data.mentionsEnabled ? "Reply" : "Reply · Pro",
              disabled: !data.mentionsEnabled,
            },
            {
              value: "quote",
              label: data.mentionsEnabled ? "Quote" : "Quote · Pro",
              disabled: !data.mentionsEnabled,
            },
          ]}
        /></label
      >
      {#if nextType !== "post"}<label
          >Original X post<Input
            type="url"
            bind:value={sourceURL}
            required
            placeholder="https://x.com/…/status/…"
            disabled={changingType}
          /></label
        >{/if}
      {#if typeError}<p class="action-error" role="alert">{typeError}</p>{/if}
      <Button type="submit" disabled={changingType}
        >{changingType ? "Updating…" : "Save type"}</Button
      >
    </form>
  </Dialog.Content>
</Dialog.Root>
<Dialog.Root bind:open={finishOpen}>
  <Dialog.Content class="sm:max-w-[400px]">
    <Dialog.Header>
      <Dialog.Title>Finish your {finishKind}</Dialog.Title>
      <Dialog.Description>
        {finishKind === "reply"
          ? "Copy your text, then open the original post and paste into a reply on X."
          : "Copy your text, then open the original post, choose Quote and paste on X."}
      </Dialog.Description>
    </Dialog.Header>
    <Button
      variant="outline"
      disabled={!content.posts[0].text.trim()}
      onclick={copyForX}
      ><Icon name={finishCopied ? "check" : "copy"} size={18} />{finishCopied
        ? "Copied"
        : `Copy ${finishKind}`}</Button
    >
    {#if finishError}<p class="action-error" role="alert">{finishError}</p>{/if}
    <Button
      href={content.source?.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open original in X"
    >
      Open original in <Icon name="x" size={18} />
    </Button>
    {#if content.posts.length > 1 || content.posts.some((post) => post.media.length)}
      <p class="small muted">
        Copy each additional post and download attachments from the editor to
        add them in X.
      </p>
    {/if}
  </Dialog.Content>
</Dialog.Root>
<Dialog.Root bind:open={sharingOpen}>
  <Dialog.Content
    showCloseButton={false}
    class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[440px] rounded-[20px] bg-card p-7"
    onEscapeKeydown={(event) => {
      if (busy) event.preventDefault();
    }}
    onInteractOutside={(event) => {
      if (busy) event.preventDefault();
    }}
  >
    <div class="row between">
      <Dialog.Title class="text-xl font-semibold">Share draft</Dialog.Title>
      <Button
        variant="ghost"
        class="icon-button"
        aria-label="Close sharing"
        disabled={busy}
        onclick={() => (sharingOpen = false)}
        ><Icon name="close" size={20} /></Button
      >
    </div>
    <h3 class="small">Friends only</h3>
    <Dialog.Description class="small muted">
      Only selected friends can open this review while signed in.
    </Dialog.Description>
    <div class="share-friends">
      {#each data.connections.filter((c) => c.accepted) as friend (friend.id)}
        {@const sent = data.recipients.includes(friend.user_id)}
        <div class="share-friend">
          <UserIdentity
            name={friend.name}
            handle={friend.handle}
            avatarId={friend.avatar_id}
            userId={friend.user_id}
          />
          <Button
            variant={sent ? "ghost" : "secondary"}
            disabled={busy || saving || uploading}
            aria-label={sent
              ? `Remove ${friend.name}’s review access`
              : `Send to ${friend.name}`}
            onclick={() => sendToFriend(friend.user_id, sent)}
            >{sent ? "Remove access" : "Send"}</Button
          >
        </div>
      {:else}<Button variant="outline" href="/friends"
          >Add friends<Icon name="users" size={16} /></Button
        >{/each}
    </div>
    <div class="share-link-option">
      <h3 class="small">Review link</h3>
      <p class="small muted">
        Anyone with the link can read and comment, without an account.
      </p>
      <Button
        variant="outline"
        disabled={busy || saving || uploading}
        onclick={publish}
        ><Icon name="link" size={16} />{busy
          ? "Preparing…"
          : "Create review link"}</Button
      >
    </div>
    {#if shareError}<p class="action-error" role="alert">{shareError}</p>{/if}
  </Dialog.Content>
</Dialog.Root>
<ConfirmDialog bind:this={confirmation} />

<style>
  .owner-comment {
    border-bottom: 1px solid var(--border);
  }
  .share-friends {
    max-height: 40dvh;
    overflow-y: auto;
  }
  .share-friend {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 0;
  }
  .share-link-option {
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid var(--line);
  }
  .draft-heading :global(.edit-shortcut) {
    margin-left: auto;
    color: var(--muted-foreground);
  }
  .draft-heading :global(.edit-shortcut:hover),
  .draft-heading :global(.edit-shortcut:focus-visible) {
    color: var(--foreground);
  }
  .draft-actions {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    padding-bottom: 16px;
  }
  .share-actions > :global(button:first-child) {
    flex: 1;
    min-height: 44px;
  }
  .share-actions :global(.share-toggle) {
    min-width: 44px;
    min-height: 44px;
  }
  .secondary-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: flex-end;
  }
  .secondary-actions :global(.icon-button) {
    min-width: 44px;
    min-height: 44px;
  }
  .desktop-draft-actions :global(.icon-button) {
    border-radius: 999px;
  }
  .action-error {
    grid-column: 1 / -1;
    margin: 0;
  }
  .pending {
    margin: 12px;
  }
  @media (max-width: 1000px) {
    .draft-actions {
      grid-area: sidebar;
      padding: 4px 12px 12px;
    }
    .secondary-actions {
      gap: 4px;
    }
  }
  @media (max-width: 600px) {
    .draft-actions {
      gap: 6px;
    }
    .draft-actions :global(button) {
      padding-inline: 10px;
      font-size: 13px;
      gap: 6px;
    }
  }
</style>
