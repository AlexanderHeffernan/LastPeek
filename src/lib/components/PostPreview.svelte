<script lang="ts">
  import { Input } from "$lib/components/ui/input/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import Icon from "./Icon.svelte";
  import XSourcePost from "./XSourcePost.svelte";
  import { X_SOURCE_UNAVAILABLE } from "$lib/x-post";
  import type { XSourcePost as SourcePost } from "$lib/x-post";
  import twitter from "twitter-text";
  import { tick } from "svelte";
  import {
    mediaURL,
    avatarURL,
    relativeTime,
    type Content,
    type Media,
  } from "$lib/contracts";
  let {
    content = $bindable(),
    media,
    editing = false,
    token,
    onchange = () => {},
    onupload = () => {},
    oncopy,
    onfocuspost,
    focusedPost,
    timeline = false,
    sourcePost = null,
    updatedAt,
    publishing,
  }: {
    content: Content;
    media: Media[];
    editing?: boolean;
    token?: string;
    onchange?: () => void;
    onupload?: (postId: string, files: File[]) => void;
    oncopy?: (text: string) => void;
    onfocuspost?: (postId: string, quote: string) => void;
    focusedPost?: string;
    timeline?: boolean;
    sourcePost?: SourcePost | null;
    updatedAt?: string;
    publishing?: import("svelte").Snippet;
  } = $props();
  // Like X's composer, only the post being written shows its tools.
  let activeId = $state(content.posts.at(-1)?.id);
  let removeDialog = $state<HTMLDialogElement>();
  let removingPost = $state<string | null>(null);
  const active = $derived(
    content.posts.some((p) => p.id === activeId)
      ? activeId
      : content.posts.at(-1)?.id,
  );
  async function removePost(id: string) {
    const index = content.posts.findIndex((post) => post.id === id);
    const previous = content.posts[Math.max(index - 1, 0)];
    content.posts = content.posts.filter((post) => post.id !== id);
    activeId = (previous.id === id ? content.posts[0] : previous).id;
    removeDialog?.close();
    removingPost = null;
    onchange();
    await tick();
    document.getElementById(`post-text-${activeId}`)?.focus();
  }
  function moveMedia(postIndex: number, index: number, direction: number) {
    const ids = [...content.posts[postIndex].media];
    [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
    content.posts[postIndex].media = ids;
    onchange();
  }
  function textParts(text: string) {
    const parts: { text: string; href?: string }[] = [];
    let cursor = 0;
    for (const entity of twitter.extractEntitiesWithIndices(text)) {
      const [start, end] = entity.indices;
      parts.push({ text: text.slice(cursor, start) });
      const label = text.slice(start, end);
      const href =
        "url" in entity
          ? /^https?:\/\//i.test(entity.url)
            ? entity.url
            : `https://${entity.url}`
          : "hashtag" in entity
            ? `https://x.com/hashtag/${encodeURIComponent(entity.hashtag)}`
            : "screenName" in entity
              ? `https://x.com/${entity.screenName}${"listSlug" in entity ? entity.listSlug : ""}`
              : `https://x.com/search?q=${encodeURIComponent(label)}`;
      parts.push({ text: label, href });
      cursor = end;
    }
    parts.push({ text: text.slice(cursor) });
    return parts;
  }
</script>

<svelte:document
  onselectionchange={() => {
    if (editing || !onfocuspost) return;
    const selection = window.getSelection();
    const text = selection?.anchorNode?.parentElement?.closest(".post-text");
    const postId = text?.closest<HTMLElement>("article")?.dataset.postId;
    if (
      postId &&
      selection?.toString().trim() &&
      text?.contains(selection.focusNode) &&
      content.posts.some((p) => p.id === postId)
    ) {
      onfocuspost(postId, selection.toString());
    }
  }}
/>
<section aria-label="Post thread">
  {#if content.source?.kind === "reply" && !timeline}
    <div class="reply-source">
      <span class="source-label"
        ><Icon name="reply" size={16} />Replying to</span
      >
      {#if sourcePost}<XSourcePost post={sourcePost} />
      {:else}<p class="source-unavailable" role="status">
          {X_SOURCE_UNAVAILABLE}
        </p>{/if}
    </div>
  {/if}
  {#each content.posts as post, index (post.id)}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <article
      class="post"
      data-post-id={post.id}
      class:feedback-focused={focusedPost === post.id}
      class:inactive={editing && content.posts.length > 1 && post.id !== active}
      aria-label={`Post ${index + 1}`}
      onfocusin={() => (activeId = post.id)}
      onclick={(event) => {
        if (
          !onfocuspost ||
          (event.target as Element).closest("a,button,input,video")
        )
          return;
        const selection = window.getSelection();
        const text = event.currentTarget.querySelector(".post-text");
        const quote =
          selection &&
          text?.contains(selection.anchorNode) &&
          text.contains(selection.focusNode)
            ? selection.toString()
            : "";
        onfocuspost(post.id, quote);
      }}
    >
      <div class="avatar" aria-hidden="true">
        {#if content.author.avatar}<img
            src={avatarURL(content.author.avatar, token)}
            alt=""
          />{:else}{content.author.name.slice(0, 1).toUpperCase() || "Y"}{/if}
      </div>
      <div class="post-body">
        <div class="post-author" class:timeline-author={timeline}>
          <strong>{content.author.name || "Your name"}</strong><span
            class="handle"
            >{content.author.handle
              ? `@${content.author.handle.replace(/^@/, "")}`
              : ""}</span
          >{#if updatedAt}<time
              datetime={updatedAt}
              title={`Updated ${new Date(updatedAt).toLocaleString()}`}
              ><span aria-hidden="true"> · </span><span class="sr-only"
                >Updated
              </span>{relativeTime(updatedAt)}</time
            >{/if}{#if content.posts.length > 1}<span class="post-position"
              >{index + 1}/{content.posts.length}</span
            >{#if editing && post.id === active}<Button
                variant="ghost"
                class="icon-button remove-post"
                aria-label={`Remove post ${index + 1}`}
                title="Remove post"
                onclick={() => {
                  if (post.text.trim() || post.media.length) {
                    removingPost = post.id;
                    removeDialog?.showModal();
                  } else void removePost(post.id);
                }}><Icon name="close" size={16} /></Button
              >{/if}{/if}
        </div>
        <div class:editable-post={editing}>
          {#if editing}<Textarea
              class="post-editor"
              id={`post-text-${post.id}`}
              aria-label={`Post ${index + 1} text`}
              bind:value={post.text}
              oninput={onchange}
              placeholder={index ? "Add another post" : "What’s happening?"}
              maxlength={25000}
              rows={1}
            ></Textarea>{/if}
          <p class="post-text" aria-hidden={editing ? "true" : undefined}>
            {#each textParts(post.text) as part}{#if part.href && timeline}<span
                  class="post-link">{part.text}</span
                >{:else if part.href}<a
                  href={part.href}
                  tabindex={editing ? -1 : undefined}
                  target="_blank"
                  rel="noopener noreferrer">{part.text}</a
                >{:else}{part.text}{/if}{/each}
          </p>
        </div>
        {#if onfocuspost}<Button
            variant="ghost"
            class="post-feedback-button"
            aria-label={`Comment on post ${index + 1}`}
            aria-pressed={focusedPost === post.id}
            onclick={() => onfocuspost?.(post.id, "")}
            ><Icon name="comment" size={16} />{focusedPost === post.id
              ? "Selected for feedback"
              : "Comment"}</Button
          >{/if}
        {#if post.media.length}<div
            class="media-grid"
            class:multi={post.media.length > 1}
            class:three={post.media.length === 3}
          >
            {#each post.media as id, mediaIndex (id)}{@const item = media.find(
                (m) => m.id === id,
              )}
              {#if item}<div class="media-item">
                  {#if item.mime.startsWith("video/")}<video
                      src={mediaURL(id, token)}
                      controls={!timeline}
                      playsinline
                      preload="metadata"
                      aria-label={`Video on post ${index + 1}`}
                      ><track kind="captions" />{#if !timeline}<a
                          href={`${mediaURL(id, token)}${token ? "&" : "?"}download=1`}
                          >Download video</a
                        >{/if}</video
                    >
                  {:else if timeline}<img
                      src={mediaURL(id, token)}
                      alt={item.filename}
                      loading="lazy"
                    />
                  {:else}<a
                      href={mediaURL(id, token)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open image ${mediaIndex + 1} on post ${index + 1}`}
                      ><img src={mediaURL(id, token)} alt={item.filename} /></a
                    >{/if}
                  {#if editing}<div class="media-actions">
                      {#if mediaIndex > 0}<Button
                          variant="outline"
                          class="icon-button"
                          aria-label={`Move attachment ${mediaIndex + 1} earlier on post ${index + 1}`}
                          onclick={() => moveMedia(index, mediaIndex, -1)}
                          ><Icon name="back" size={12} /></Button
                        >{/if}{#if mediaIndex < post.media.length - 1}<Button
                          variant="outline"
                          class="icon-button"
                          aria-label={`Move attachment ${mediaIndex + 1} later on post ${index + 1}`}
                          onclick={() => moveMedia(index, mediaIndex, 1)}
                          ><Icon name="arrow" size={12} /></Button
                        >{/if}<Button
                        variant="outline"
                        class="icon-button"
                        aria-label={`Remove attachment ${mediaIndex + 1} from post ${index + 1}`}
                        onclick={() => {
                          post.media = post.media.filter((m) => m !== id);
                          onchange();
                        }}><Icon name="close" size={13} /></Button
                      >
                    </div>{:else if !timeline && item.mime.startsWith("video/")}<div
                      class="media-actions"
                    >
                      <Button
                        variant="ghost"
                        class="icon-button"
                        href={`${mediaURL(id, token)}${token ? "&" : "?"}download=1`}
                        aria-label={`Download video on post ${index + 1}`}
                        title="Download video"
                        ><Icon name="download" size={16} /></Button
                      >
                    </div>{/if}
                </div>{/if}
            {/each}
          </div>{/if}
        {#if index === 0 && content.source}
          {#if timeline}<div class="source-label">
              <Icon name={content.source.kind} size={16} />{content.source
                .kind === "quote"
                ? "Quote post"
                : "Reply"}
            </div>
          {:else if content.source.kind === "quote"}
            <div class="quote-source">
              <span class="source-label"
                ><Icon name="quote" size={16} />Quoting</span
              >
              {#if sourcePost}<XSourcePost post={sourcePost} />
              {:else}<p class="source-unavailable" role="status">
                  {X_SOURCE_UNAVAILABLE}
                </p>{/if}
            </div>
          {/if}
        {/if}
        {#if (editing && (post.id === active || (publishing && index === content.posts.length - 1))) || (!editing && oncopy)}{@const count =
            twitter.parseTweet(post.text).weightedLength}
          <div class="post-tools">
            <div class="post-action-icons">
              {#if editing}<label class="upload-button" title="Add media"
                  ><Icon name="image" size={20} /><Input
                    type="file"
                    aria-label={`Add media to post ${index + 1}`}
                    accept="image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm"
                    multiple
                    onchange={(event) => {
                      onupload(post.id, [...(event.currentTarget.files || [])]);
                      event.currentTarget.value = "";
                    }}
                  /></label
                >{/if}
              {#if oncopy}<Button
                  variant="ghost"
                  class="icon-button"
                  aria-label={`Copy post ${index + 1} text`}
                  title="Copy text"
                  onclick={() => oncopy?.(post.text)}
                  ><Icon name="copy" size={20} /></Button
                >{/if}
              {#each post.media as id}{@const file = media.find(
                  (m) => m.id === id,
                )}{#if file}<Button
                    variant="ghost"
                    class="icon-button"
                    aria-label={`Download ${file.filename}`}
                    title={`Download ${file.filename}`}
                    href={`${mediaURL(id, token)}${token ? "&" : "?"}download=1`}
                    download={file.filename}
                    ><Icon name="download" size={20} /></Button
                  >{/if}{/each}
            </div>
            {#if editing}
              <div class="post-count">
                <svg class="count-ring" viewBox="0 0 24 24" aria-hidden="true">
                  <circle class="count-track" cx="12" cy="12" r="10" />
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    class="count-fill"
                    class:over={count > 280}
                    stroke-dasharray="62.832"
                    stroke-dashoffset={62.832 * (1 - Math.min(count / 280, 1))}
                  />
                </svg>
                <span
                  class="counter"
                  class:over={count > 280}
                  aria-label={`${count} of 280 characters${count > 280 ? ". X Premium required" : ""}`}
                  title={count > 280 ? "X Premium required" : "Character count"}
                  >{count}/280</span
                >
                <div class="post-submit-actions">
                  {#if content.posts.length < 25}<Button
                      variant="outline"
                      class="icon-button add-post"
                      aria-label="Add post to thread"
                      title="Add post to thread"
                      onclick={async () => {
                        const id = crypto.randomUUID();
                        content.posts = content.posts.toSpliced(index + 1, 0, {
                          id,
                          text: "",
                          media: [],
                        });
                        onchange();
                        activeId = id;
                        await tick();
                        document.getElementById(`post-text-${id}`)?.focus();
                      }}><Icon name="plus" size={20} /></Button
                    >{/if}
                  {#if index === content.posts.length - 1 && publishing}{@render publishing()}{/if}
                </div>
              </div>
            {/if}
          </div>{/if}
      </div>
    </article>
  {/each}
</section>

{#if editing}
  <dialog
    bind:this={removeDialog}
    class="confirm-dialog"
    aria-labelledby="remove-post-title"
    aria-describedby="remove-post-description"
  >
    <div class="dialog-icon"><Icon name="trash" size={24} /></div>
    <h2 id="remove-post-title">Remove this post?</h2>
    <p id="remove-post-description">
      Its text and attachments will be removed from this draft. Existing
      feedback will stay. This can’t be undone.
    </p>
    <div class="row dialog-actions">
      <Button variant="outline" onclick={() => removeDialog?.close()}
        >Keep post</Button
      >
      <Button variant="destructive" onclick={() => removePost(removingPost!)}
        >Remove post</Button
      >
    </div>
  </dialog>
{/if}

<style>
  .timeline-author {
    flex-wrap: nowrap;
  }
  .timeline-author strong,
  .timeline-author .handle {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .timeline-author .handle {
    flex-shrink: 2;
  }
  .timeline-author time {
    flex-shrink: 0;
    color: #71767b;
    white-space: nowrap;
  }
  .source-unavailable {
    margin: 12px 0 0;
    color: #93989d;
    font-size: 13px;
    line-height: 20px;
  }
  .source-label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #93989d;
    font-size: 13px;
  }
  .reply-source {
    padding: 16px;
    border-bottom: 1px solid #2f3336;
  }
  .quote-source {
    margin-top: 12px;
    padding: 12px;
    border: 1px solid #2f3336;
    border-radius: 16px;
  }
</style>
