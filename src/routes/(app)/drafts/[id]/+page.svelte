<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import * as Tabs from "$lib/components/ui/tabs/index.js";
  import { onMount, untrack } from "svelte";
  import { beforeNavigate, goto, invalidateAll } from "$app/navigation";
  import PostPreview from "$lib/components/PostPreview.svelte";
  import FeedbackList from "$lib/components/FeedbackList.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import {
    mediaURL,
    type Content,
    type Media,
    type Feedback,
  } from "$lib/contracts";
  let { data } = $props();
  // The layout remounts this editor on draft changes. Refreshing feedback must not reset edits.
  const initial = untrack(() => data);
  let content: Content = $state(structuredClone(initial.draft.content)),
    media: Media[] = $state(initial.media);
  let version = $state(initial.draft.edit_version),
    editing = $state(true),
    historical = $state(0);
  let saved = $state(JSON.stringify(initial.draft.content)),
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
  const differs = $derived(
    !sharedRevision ||
      JSON.stringify(
        data.revisions.find((r) => r.number === sharedRevision)?.content,
      ) !== JSON.stringify(content),
  );
  onMount(() => {
    origin = location.origin;
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
      saved = snapshot;
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
    editing = true;
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
    if (
      !confirm(
        "Permanently delete this draft, every shared version, all feedback and its attachments?",
      )
    )
      return;
    try {
      await api({ action: "delete" });
      saved = JSON.stringify(content);
      await goto("/");
    } catch (e) {
      error = (e as Error).message;
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
<svelte:head
  ><title>{content.title || "Your draft"} · LastPeek</title></svelte:head
>
<main class="workspace">
  <div class="workspace-toolbar">
    <a class="breadcrumb row" href="/"
      ><Icon name="back" size={14} />Your drafts</a
    >
    <div class="row">
      <span class="small muted" role="status"
        ><span class="status-dot"></span>{status}</span
      ><Button
        variant="ghost"
        disabled={saving || uploading}
        onclick={() => save()}>Save</Button
      ><Button
        variant="default"
        disabled={busy || saving || uploading}
        onclick={publish}
        ><Icon name={shareToken ? "check" : "link"} size={15} />{busy
          ? "Preparing…"
          : shareToken
            ? differs
              ? "Update shared version"
              : "Share link"
            : "Share draft"}</Button
      >
    </div>
  </div>
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
  <div class="workspace-grid">
    <section>
      {#if historical}<div class="notice" style="margin-bottom:16px">
          Viewing shared version {historical}. Your working draft is unchanged.
          <Button variant="ghost" onclick={() => (historical = 0)}
            >Back to working draft</Button
          >
        </div>{/if}
      <Tabs.Root
        class="post-panel"
        value={editing && !historical ? "write" : "preview"}
        onValueChange={(value) => {
          editing = value === "write";
          if (editing) historical = 0;
        }}
      >
        <div class="panel-heading editor-heading">
          <Input
            class="title-input"
            aria-label="Draft title"
            placeholder="Untitled draft"
            bind:value={content.title}
            oninput={changed}
            maxlength={120}
            disabled={!!historical}
          />
          <Tabs.List aria-label="Draft mode">
            <Tabs.Trigger value="write"
              ><Icon name="edit" size={15} />Write</Tabs.Trigger
            >
            <Tabs.Trigger value="preview"
              ><Icon name="eye" size={15} />Preview</Tabs.Trigger
            >
          </Tabs.List>
        </div>
        <Tabs.Content value="write" class="m-0">
          <PostPreview
            bind:content
            {media}
            editing
            onchange={changed}
            onupload={upload}
          />
        </Tabs.Content>
        <Tabs.Content value="preview" class="m-0">
          <PostPreview content={displayed} {media} />
        </Tabs.Content>
      </Tabs.Root>
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
      <div class="row between" style="margin-top:18px">
        <Button
          variant="ghost"
          onclick={() => copy(content.posts.map((p) => p.text).join("\n\n"))}
          ><Icon name="copy" size={14} />Copy thread text</Button
        >
        <details>
          <summary class="small muted" style="cursor:pointer"
            >Draft options</summary
          >
          <div class="stack" style="padding-top:12px">
            <Button
              variant="destructive"
              class="danger"
              disabled={uploading || saving}
              onclick={removeDraft}
              ><Icon name="trash" size={14} />Delete draft</Button
            >
          </div>
        </details>
      </div>
      {#each content.posts as post, index}<div class="export-post">
          <span class="small muted">Post {index + 1}</span>
          <Button
            variant="ghost"
            aria-label={`Copy post ${index + 1} text`}
            onclick={() => copy(post.text)}
            ><Icon name="copy" size={16} />Copy text</Button
          >{#each post.media as id}{@const file = media.find(
              (m) => m.id === id,
            )}{#if file}<Button
                variant="ghost"
                class="download-file"
                aria-label={`Download ${file.filename}`}
                href={`${mediaURL(id)}?download=1`}
                ><Icon name="download" size={16} /><span>{file.filename}</span
                ></Button
              >{/if}{/each}
        </div>{/each}
    </section>
    <aside class="feedback-column" aria-label="Feedback and sharing">
      {#if shareToken && (shareOpen || sharedRevision)}<div class="share-box">
          <div class="row between">
            <strong class="small">Review link</strong><Badge
              variant="secondary"
              class="green">v{sharedRevision}</Badge
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
          editing = false;
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
                  editing = false;
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
