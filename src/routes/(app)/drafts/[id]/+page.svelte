<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { onMount, untrack } from "svelte";
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
  let version = $state(initial.draft.edit_version),
    historical = $state(0);
  let saved = $state(JSON.stringify(initialContent)),
    timer: ReturnType<typeof setTimeout>;
  let saving = $state(false),
    busy = $state(false),
    error = $state(""),
    message = $state(""),
    status = $state("All changes saved");
  let shareToken = $state(initial.draft.share_token),
    sharedRevision = $state(initial.draft.shared_revision);
  let shareOpen = $state(false),
    origin = $state("");
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
  const displayed: Content = $derived(
    historical
      ? data.revisions.find((r) => r.number === historical)?.content || content
      : content,
  );
  const sharedContent = $derived(
    data.revisions.find((r) => r.number === sharedRevision)?.content,
  );
  const differs = $derived(
    !sharedContent ||
      JSON.stringify(contentSchema.parse(sharedContent)) !==
        JSON.stringify(content),
  );
  onMount(() => {
    origin = location.origin;
    if (dirty) changed();
    return () => clearTimeout(timer);
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
    message = "";
    try {
      if (pending.some((p) => p.error))
        throw new Error("Retry or dismiss failed uploads before sharing.");
      if (!(await save())) return;
      const result = await api({ action: "publish", version });
      shareToken = result.token;
      sharedRevision = result.revision;
      shareOpen = true;
      message = "Your review link is ready.";
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
      message = "Link revoked. Your feedback is still here.";
    } catch (e) {
      error = (e as Error).message;
    }
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      message = "Copied. Ready when you are.";
    } catch {
      error =
        "Clipboard access is unavailable. Select and copy the text manually.";
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
    if (historical) {
      historical = 0;
    }
    const post = content.posts.find((p) => p.id === comment.post_id);
    if (!post || !comment.suggestion) return;
    if (
      !confirm(
        "Replace this post’s wording with the suggestion? This changes your working draft only.",
      )
    )
      return;
    post.text = comment.suggestion;
    changed();
    message =
      "Suggestion added to your working draft. Update the shared version when ready.";
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
  {#if error}<div
      class="notice error row between"
      role="alert"
      style="margin-bottom:18px"
    >
      <span>{error}</span><Button variant="ghost" onclick={() => save()}
        >Retry save</Button
      >
    </div>{/if}
  {#if message}<div
      class="notice row between"
      role="status"
      style="margin-bottom:18px"
    >
      {message}<Button
        variant="ghost"
        class="icon-button"
        aria-label="Dismiss message"
        onclick={() => (message = "")}><Icon name="close" size={14} /></Button
      >
    </div>{/if}
  <div class="workspace-grid editor-grid">
    <div class="editor-actions">
      <div class="row between">
        <Button
          variant="default"
          disabled={busy || saving || uploading || deleting}
          onclick={publish}
          ><Icon name={shareToken ? "check" : "link"} size={15} />{busy
            ? "Preparing…"
            : shareToken
              ? differs
                ? "Update shared version"
                : "Share link"
              : "Share draft"}</Button
        >
        <Button
          variant="ghost"
          class="icon-button danger"
          aria-label="Delete draft"
          title="Delete draft"
          disabled={uploading || saving || busy || deleting}
          onclick={() => deleteDialog?.showModal()}
          ><Icon name="trash" size={20} /></Button
        >
      </div>
      <span
        class="small muted save-status"
        role="status"
        class:save-failed={status === "Not saved"}
        ><span
          class="status-dot"
          class:saved={!dirty && !saving}
          class:failed={status === "Not saved"}
        ></span>{status}</span
      >
    </div>
    <section class="editor-posts">
      {#if historical}<div class="notice" style="margin-bottom:16px">
          Viewing shared version {historical}. Your working draft is unchanged.
          <Button variant="ghost" onclick={() => (historical = 0)}
            >Back to working draft</Button
          >
        </div>{/if}
      <div class="post-panel">
        {#if historical}
          <PostPreview content={displayed} {media} oncopy={copy} />
        {:else}
          <PostPreview
            bind:content
            {media}
            editing
            onchange={changed}
            onupload={upload}
            oncopy={copy}
          />
        {/if}
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
      {#if data.aiEnabled}
        <AIReview draftId={data.draft.id} {content} historical={!!historical} />
      {/if}
      {#if shareToken && (shareOpen || sharedRevision)}<div class="share-box">
          <div class="row between">
            <strong class="small">Review link</strong><Badge
              variant="secondary"
              class="brand-tint">v{sharedRevision}</Badge
            >
          </div>
          <Input
            aria-label="Review link"
            readonly
            value={`${origin}/r/${shareToken}`}
            onclick={(e) => e.currentTarget.select()}
          />
          <div class="row">
            <Button
              variant="outline"
              onclick={() => copy(`${origin}/r/${shareToken}`)}
              ><Icon name="copy" size={13} />Copy link</Button
            ><Button
              variant="ghost"
              href={`/r/${shareToken}`}
              target="_blank"
              rel="noopener noreferrer">Open preview</Button
            >
          </div>
          <p>Anyone with the link can review.</p>
          <Button
            variant="destructive"
            class="danger"
            style="margin-top:12px"
            onclick={revoke}>Revoke link</Button
          >
        </div>{/if}
      <div class="feedback-heading row between">
        <div>
          <h2>Feedback</h2>
        </div>
        <Button
          variant="ghost"
          class="icon-button"
          aria-label="Refresh feedback"
          onclick={() => invalidateAll()}
          ><Icon name="comment" size={16} /></Button
        >
      </div>
      <FeedbackList
        comments={data.comments}
        revision={historical || sharedRevision}
        {content}
        onresolve={resolveComment}
        onapply={apply}
        onversion={(n) => {
          historical = n;
        }}
      />
      {#if data.revisions.length}<details style="margin-top:24px">
          <summary class="small muted" style="cursor:pointer"
            >Shared version history</summary
          >
          <div class="stack" style="gap:8px;margin-top:12px">
            {#each data.revisions as revision}<Button
                variant="ghost"
                onclick={() => {
                  historical = revision.number;
                }}
                >Version {revision.number}<span class="muted small"
                  >{new Date(revision.created_at).toLocaleDateString()}</span
                ></Button
              >{/each}
          </div>
        </details>{/if}
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
    This permanently deletes every shared version, all feedback and all
    attachments. Review links will stop working. This can’t be undone.
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
