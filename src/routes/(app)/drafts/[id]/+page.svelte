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
      shareToken = result.token;
      sharedRevision = result.revision;
      await invalidateAll();
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
      error =
        "Couldn’t copy the link. Open preview from the link menu to copy its address.";
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
<svelte:head><title>Your post · LastPeek</title></svelte:head>
<main class="workspace">
  <div class="workspace-grid editor-grid">
    <div class="editor-actions">
      <div class="draft-action-row">
        <div class="share-actions">
          <Button
            variant={shareToken ? "secondary" : "default"}
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
                <Button
                  variant="ghost"
                  href={`/r/${shareToken}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onclick={() => (shareOpen = false)}
                  ><Icon name="eye" size={16} />Open preview</Button
                >
                <Button variant="ghost" class="danger" onclick={revoke}
                  ><Icon name="trash" size={16} />Remove link</Button
                >
              </Popover.Content>
            </Popover.Root>{/if}
        </div>
        {#if data.aiEnabled}<AIReview draftId={data.draft.id} {content} />{/if}
        <Button
          variant="secondary"
          class="icon-button danger delete-draft"
          aria-label="Delete draft"
          title="Delete draft"
          disabled={uploading || saving || busy || deleting}
          onclick={() => deleteDialog?.showModal()}
          ><Icon name="trash" size={20} /></Button
        >
      </div>
      <span class="sr-only" role="status">{status}</span>
      {#if error}<div class="action-error" role="alert">
          {error}{#if status === "Not saved"}<Button
              variant="ghost"
              onclick={() => save()}>Retry save</Button
            >{/if}
        </div>{/if}
    </div>
    <section class="editor-posts">
      <div class="post-panel">
        <PostPreview
          bind:content
          {media}
          editing
          onchange={changed}
          onupload={upload}
          oncopy={copy}
        />
      </div>
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
    <aside class="feedback-column" aria-label="Feedback and sharing">
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
    </aside>
  </div>
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
