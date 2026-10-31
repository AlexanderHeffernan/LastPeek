<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { onMount, untrack } from "svelte";
  import { Popover } from "bits-ui";
  import { beforeNavigate, goto, invalidateAll } from "$app/navigation";
  import PostPreview from "$lib/components/PostPreview.svelte";
  import FeedbackList from "$lib/components/FeedbackList.svelte";
  import AIReview from "$lib/components/AIReview.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import {
    contentSchema,
    authorSchema,
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
  let moreOpen = $state(false);
  const postKind = $derived(
    content.source?.kind === "reply"
      ? "Comment"
      : content.source?.kind === "quote"
        ? "Quote"
        : "Post",
  );
  let deleteDialog = $state<HTMLDialogElement>();
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
  async function publish() {
    busy = true;
    error = "";
    try {
      if (pending.some((p) => p.error))
        throw new Error("Retry or dismiss failed uploads before sharing.");
      if (!(await save())) return;
      const result = await api({ action: "publish", version });
      await invalidateAll();
      shareToken = result.token;
      sharedRevision = result.revision;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  async function revoke() {
    if (
      !confirm(
        "Revoke this link? Anyone with it will lose access, including to attachments. Feedback will stay.",
      )
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
  function apply(comment: Feedback) {
    const post = content.posts.find((p) => p.id === comment.post_id);
    if (!post || !comment.suggestion) return;
    if (
      !confirm(
        "Replace this post’s wording with the suggestion? An active review link will update too.",
      )
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
    deleting = true;
    clearTimeout(timer);
    try {
      await api({ action: "delete" });
      saved = JSON.stringify(content);
      deleteDialog?.close();
      await goto("/");
    } catch (e) {
      deleteDialog?.close();
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
<main class="draft-page">
  <header class="draft-heading">
    <Button
      variant="ghost"
      class="icon-button"
      href="/"
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
      <div class="share-actions">
        <Button
          variant={shareToken ? "secondary" : "default"}
          aria-busy={busy}
          disabled={busy || saving || uploading || deleting}
          onclick={() => (shareToken ? copyLink() : publish())}
          ><Icon
            name={copied ? "check" : shareToken ? "copy" : "link"}
            size={15}
          />{busy
            ? "Preparing…"
            : shareToken
              ? copied
                ? "Copied!"
                : "Copy link"
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
                deleteDialog?.showModal();
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
        revision={dirty ? null : sharedRevision}
        {content}
        emptyText={shareToken
          ? "No feedback yet. Send your link to get a second look."
          : "A second pair of eyes? Share your draft to get feedback."}
        onresolve={resolveComment}
        onapply={apply}
      />
    </div>
  </aside>
</main>
<dialog
  bind:this={deleteDialog}
  class="confirm-dialog"
  aria-labelledby="delete-title"
  aria-describedby="delete-description"
  oncancel={(event) => {
    if (deleting) event.preventDefault();
  }}
>
  <div class="dialog-icon"><Icon name="trash" size={24} /></div>
  <h2 id="delete-title">Delete this draft?</h2>
  <p id="delete-description">
    This permanently deletes the draft, all feedback and all attachments. Review
    links will stop working. This can’t be undone.
  </p>
  <div class="row dialog-actions">
    <Button
      variant="outline"
      disabled={deleting}
      onclick={() => deleteDialog?.close()}>Keep draft</Button
    >
    <Button
      variant="destructive"
      disabled={deleting || saving}
      onclick={removeDraft}>{deleting ? "Deleting…" : "Delete draft"}</Button
    >
  </div>
</dialog>

<style>
  .draft-page {
    display: grid;
    grid-template-columns: minmax(0, 600px) minmax(0, 1fr);
    grid-template-areas: "heading sidebar" "posts sidebar";
    grid-template-rows: 52px 1fr;
    column-gap: 24px;
    min-height: 100dvh;
  }
  .draft-heading {
    grid-area: heading;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 4px 12px;
    border-inline: 1px solid #2f3336;
  }
  .draft-heading h1 {
    margin: 0;
    font-size: 20px;
    letter-spacing: 0;
  }
  .draft-heading :global(.edit-shortcut) {
    margin-left: auto;
    color: var(--muted-foreground);
  }
  .draft-heading :global(.edit-shortcut:hover),
  .draft-heading :global(.edit-shortcut:focus-visible) {
    color: var(--foreground);
  }
  .editor-posts {
    grid-area: posts;
    min-width: 0;
    border-inline: 1px solid #2f3336;
  }
  .draft-sidebar {
    grid-area: sidebar;
    min-width: 0;
    padding-top: 12px;
    align-self: start;
    position: sticky;
    top: 0;
    max-height: 100dvh;
    overflow-y: auto;
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
  .action-error {
    grid-column: 1 / -1;
    margin: 0;
  }
  .draft-feedback {
    border-top: 1px solid var(--border);
  }
  .draft-feedback :global(.feedback-card) {
    background: transparent;
    border: 0;
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    padding: 20px 0 16px;
    margin: 0;
  }
  .draft-feedback :global(.feedback-card.resolved) {
    opacity: 1;
  }
  .draft-feedback :global(.feedback-card.resolved .comment) {
    color: var(--muted-foreground);
  }
  .draft-feedback :global(.feedback-card.targeted) {
    box-shadow: inset 2px 0 var(--primary);
    padding-left: 12px;
  }
  .draft-feedback :global(.feedback-empty) {
    padding: 24px 12px;
    border: 0;
    border-radius: 0;
  }
  .pending {
    margin: 12px;
  }
  @media (max-width: 1000px) {
    .draft-page {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas: "heading" "sidebar" "posts" "feedback";
      grid-template-rows: 52px auto auto 1fr;
      min-height: calc(100dvh - 104px);
      border-inline: 1px solid #2f3336;
    }
    .draft-heading,
    .editor-posts {
      border-inline: 0;
    }
    .draft-sidebar {
      display: contents;
    }
    .draft-actions {
      grid-area: sidebar;
      padding: 4px 12px 12px;
    }
    .secondary-actions {
      gap: 4px;
    }
    .draft-feedback {
      grid-area: feedback;
      margin: 0 12px;
    }
  }
  @media (max-width: 600px) {
    .draft-page {
      border-inline: 0;
    }
    .draft-heading {
      gap: 12px;
      padding-inline: 8px;
    }
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
