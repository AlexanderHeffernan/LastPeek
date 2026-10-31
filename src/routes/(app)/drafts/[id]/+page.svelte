<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { onMount, untrack } from "svelte";
  import { Popover } from "bits-ui";
  import { beforeNavigate, goto, invalidateAll } from "$app/navigation";
  import PostPreview from "$lib/components/PostPreview.svelte";
  import FeedbackList from "$lib/components/FeedbackList.svelte";
  import AIReview from "$lib/components/AIReview.svelte";
  import XPublish from "$lib/components/XPublish.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import {
    contentSchema,
    authorSchema,
    type Content,
    type Media,
    type Feedback,
    avatarURL,
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
  let shareError = $state("");
  let moreOpen = $state(false);
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
      ? "Comment"
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
  const dirty = $derived(JSON.stringify(content) !== saved);
  const uploading = $derived(pending.some((p) => p.active));
  onMount(() => {
    origin = location.origin;
    if (dirty) changed();
    const refresh = setInterval(() => {
      if (document.visibilityState === "visible") void invalidateAll();
    }, 15000);
    return () => {
      clearTimeout(timer);
      clearInterval(refresh);
    };
  });
  beforeNavigate(({ cancel }) => {
    if (
      (dirty || uploading || saving) &&
      !confirm("There are unsaved changes or uploads. Leave this draft?")
    )
      cancel();
  });
  async function api(body: object) {
    const response = await fetch(`/api/drafts/${data.draft.id}`, {
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
    status = "Unsaved changes";
    error = "";
    clearTimeout(timer);
    timer = setTimeout(() => {
      void save();
    }, 850);
  }
  async function save(): Promise<boolean> {
    clearTimeout(timer);
    if (saving) return false;
    if (JSON.stringify(content) === saved) {
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
      const completed = !data.draft.posted_at;
      await api({ action: "complete", completed, version });
      await goto(completed ? "/?tab=done" : "/");
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
  async function resolveComment(comment: Feedback) {
    try {
      await api({
        action: "resolve",
        commentId: comment.id,
        resolved: !comment.resolved,
      });
      await invalidateAll();
    } catch (e) {
      error = (e as Error).message;
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
      const uploaded: Media = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/api/drafts/${data.draft.id}/media`);
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
      await api({ action: "delete" });
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
    if (dirty || saving || uploading) {
      event.preventDefault();
      event.returnValue = "";
    }
  }}
/>
<svelte:head><title>{postKind} · LastPeek</title></svelte:head>
{#snippet publishingControls()}
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
{/snippet}
<main class="draft-page">
  <header class="draft-heading">
    <Button
      variant="ghost"
      class="icon-button"
      href={data.draft.posted_at ? "/?tab=done" : "/"}
      aria-label="Back to drafts"><Icon name="back" size={20} /></Button
    >
    <h1>{postKind}</h1>
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
      editing
      onchange={changed}
      onupload={upload}
      oncopy={copy}
      publishing={content.source ||
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
    <div class="draft-actions">
      <Button
        class="completion-action"
        variant="outline"
        disabled={busy || saving || uploading || deleting}
        onclick={completeDraft}
      >
        <Icon name={data.draft.posted_at ? "drafts" : "done"} size={18} />{data
          .draft.posted_at
          ? "Move to drafts"
          : "Mark as posted"}
      </Button>
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
        {#if data.aiEnabled}<AIReview draftId={data.draft.id} {content} />{/if}
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
            <Button
              variant="ghost"
              class="danger"
              disabled={uploading || saving || busy || deleting}
              onclick={() => {
                moreOpen = false;
                void removeDraft();
              }}><Icon name="trash" size={16} />Delete draft</Button
            >
          </Popover.Content>
        </Popover.Root>
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
      <FeedbackList
        comments={data.comments}
        draftId={data.draft.id}
        revision={dirty ? null : sharedRevision}
        {content}
        emptyText={data.recipients.length
          ? "No feedback yet. Your friends can find this post in Friends."
          : shareToken
            ? "No feedback yet. Send your link to get a second look."
            : "A second pair of eyes? Share your draft to get feedback."}
        onresolve={resolveComment}
        onapply={apply}
      />
    </div>
  </aside>
</main>
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
          <span class="avatar" aria-hidden="true"
            >{#if friend.avatar_id}<img
                src={avatarURL(friend.avatar_id)}
                alt=""
              />{:else}{friend.name.slice(0, 1).toUpperCase()}{/if}</span
          ><strong>{friend.name}</strong>
          <div class="share-friend-actions">
            {#if data.completedReviews.includes(friend.user_id)}
              <Button
                variant="secondary"
                disabled={busy || saving || uploading}
                aria-label={`Request another look from ${friend.name}`}
                onclick={() => sendToFriend(friend.user_id, false)}
                >Request another look</Button
              >
            {/if}
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
  .share-friend-actions {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
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
  .share-friend strong {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .share-friend .avatar {
    flex-shrink: 0;
  }
  @media (max-width: 480px) {
    .share-friend {
      flex-wrap: wrap;
    }
    .share-friend-actions {
      width: 100%;
      align-items: stretch;
    }
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
  .draft-actions :global(.completion-action) {
    grid-column: 1 / -1;
    min-height: 44px;
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
