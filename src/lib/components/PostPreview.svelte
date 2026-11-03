<script lang="ts">
  import { Input } from "$lib/components/ui/input/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import Icon from "./Icon.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import XSourcePost from "./XSourcePost.svelte";
  import MentionEditor from "./MentionEditor.svelte";
  import MediaViewer from "./MediaViewer.svelte";
  import { X_SOURCE_UNAVAILABLE } from "$lib/x-post";
  import type { XSourcePost as SourcePost } from "$lib/x-post";
  import twitter from "twitter-text";
  import { tick } from "svelte";
  import { videoPlayback } from "$lib/video-playback";
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
    onfocusmedia,
    focusedPost,
    timeline = false,
    sourcePost = null,
    updatedAt,
    publishing,
    mentionsURL,
    mentionsReady = true,
  }: {
    content: Content;
    media: Media[];
    editing?: boolean;
    token?: string;
    onchange?: () => void;
    onupload?: (postId: string, files: File[]) => void;
    oncopy?: (text: string) => void;
    onfocuspost?: (postId: string, quote: string) => void;
    onfocusmedia?: (
      postId: string,
      mediaId: string,
      time: number | null,
    ) => void;
    focusedPost?: string;
    timeline?: boolean;
    sourcePost?: SourcePost | null;
    updatedAt?: string;
    publishing?: import("svelte").Snippet;
    mentionsURL?: string;
    mentionsReady?: boolean;
  } = $props();
  // Like X's composer, only the post being written shows its tools.
  let activeId = $state(content.posts.at(-1)?.id);
  let confirmation = $state<ConfirmDialog>();
  let invalidMentions = $state<Record<string, string[]>>({});
  let viewerPost = $state<string>();
  let viewerIndex = $state<number | null>(null);
  let viewerTime = $state(0);
  const viewerItems = $derived(
    (content.posts.find((p) => p.id === viewerPost)?.media ?? []).flatMap(
      (id) => media.find((m) => m.id === id) ?? [],
    ),
  );
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
    if (!onfocuspost) return;
    const input = document.activeElement;
    if (
      editing &&
      input instanceof HTMLTextAreaElement &&
      input.classList.contains("post-editor")
    ) {
      const quote = input.value.slice(input.selectionStart, input.selectionEnd);
      const postId = input.closest<HTMLElement>("article")?.dataset.postId;
      if (postId && quote.trim()) onfocuspost(postId, quote);
      return;
    }
    const selection = window.getSelection();
    const text = selection?.anchorNode?.parentElement?.closest(
      ".post-text,[contenteditable]",
    );
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
      class:detail-post={!timeline}
      data-post-id={post.id}
      class:feedback-focused={focusedPost === post.id}
      class:inactive={editing && content.posts.length > 1 && post.id !== active}
      aria-label={`Post ${index + 1}`}
      onfocusin={() => (activeId = post.id)}
      onclick={(event) => {
        if (
          !onfocuspost ||
          (event.target as Element).closest(
            "a,button,input,textarea,video,[contenteditable]",
          )
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
        onfocuspost(focusedPost === post.id && !quote ? "" : post.id, quote);
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
          <strong>{content.author.name || "Your name"}</strong
          >{#if !timeline}<span class="author-break"
            ></span>{/if}{#if content.author.handle}<span class="handle"
              >@{content.author.handle.replace(/^@/, "")}</span
            >{/if}{#if updatedAt}<span
              class="post-time-separator"
              aria-hidden="true">·</span
            ><time
              datetime={updatedAt}
              title={`Updated ${new Date(updatedAt).toLocaleString()}`}
              ><span class="sr-only">Updated </span>{relativeTime(
                updatedAt,
              )}</time
            >{/if}{#if content.posts.length > 1}<span class="post-position"
              >{index + 1}/{content.posts.length}</span
            >{#if editing && post.id === active}<Button
                variant="ghost"
                class="icon-button remove-post"
                aria-label={`Remove post ${index + 1}`}
                title="Remove post"
                onclick={async () => {
                  if (post.text.trim() || post.media.length) {
                    if (
                      !(await confirmation?.ask({
                        title: "Remove this post?",
                        description:
                          "Its text and attachments will be removed from this draft. Existing feedback will stay. This can’t be undone.",
                        confirmLabel: "Remove post",
                        cancelLabel: "Keep post",
                      }))
                    )
                      return;
                    await removePost(post.id);
                  } else void removePost(post.id);
                }}><Icon name="close" size={16} /></Button
              >{/if}{/if}
        </div>
        <div class:editable-post={editing}>
          {#if editing && mentionsURL}<MentionEditor
              bind:value={post.text}
              bind:invalid={
                () => invalidMentions[post.id] ?? [],
                (handles) => (invalidMentions[post.id] = handles)
              }
              url={mentionsURL}
              enabled={mentionsReady}
              id={`post-text-${post.id}`}
              label={`Post ${index + 1} text`}
              placeholder={index ? "Add another post" : "What’s happening?"}
              {onchange}
            />{:else if editing}<Textarea
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
                  class:invalid-mention={editing &&
                    invalidMentions[post.id]?.includes(
                      part.text.slice(1).toLowerCase(),
                    )}
                  tabindex={editing ? -1 : undefined}
                  target="_blank"
                  rel="noopener noreferrer">{part.text}</a
                >{:else}{part.text}{/if}{/each}
          </p>
        </div>
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
                      use:videoPlayback={id}
                      src={mediaURL(id, token)}
                      controls
                      muted
                      loop
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
                  {:else}<Button
                      variant="ghost"
                      class="media-open h-full w-full min-h-0 rounded-none p-0"
                      aria-label={`Open image ${mediaIndex + 1} on post ${index + 1}`}
                      onclick={() => {
                        viewerPost = post.id;
                        viewerTime = 0;
                        viewerIndex = mediaIndex;
                      }}
                      ><img
                        src={mediaURL(id, token)}
                        alt={item.filename}
                      /></Button
                    >{/if}
                  {#if !timeline && (editing || item.mime.startsWith("video/"))}<div
                      class="media-actions"
                      class:video-actions={item.mime.startsWith("video/")}
                    >
                      {#if item.mime.startsWith("video/")}<Button
                          variant="ghost"
                          class="icon-button"
                          aria-label={`Open video on post ${index + 1}`}
                          title="Enlarge video"
                          onclick={(event) => {
                            const video = event.currentTarget
                              .closest(".media-item")
                              ?.querySelector("video");
                            viewerTime = video?.currentTime ?? 0;
                            video?.pause();
                            viewerPost = post.id;
                            viewerIndex = mediaIndex;
                          }}><Icon name="expand" size={18} /></Button
                        >{/if}
                      {#if editing}
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
                      {/if}
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
        {#if (editing && (post.id === active || (publishing && index === content.posts.length - 1))) || (!editing && (oncopy || onfocuspost))}{@const count =
            twitter.parseTweet(post.text).weightedLength}
          <div class="post-tools">
            <div class="post-action-icons">
              {#if onfocuspost}<Button
                  variant="ghost"
                  class="icon-button"
                  aria-label={`Comment on post ${index + 1}`}
                  title="Discuss this post, or select specific text"
                  aria-pressed={focusedPost === post.id}
                  onclick={() =>
                    onfocuspost?.(focusedPost === post.id ? "" : post.id, "")}
                  ><Icon name="comment" size={18} /></Button
                >{/if}
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

{#if !timeline}<MediaViewer
    items={viewerItems}
    bind:index={viewerIndex}
    time={viewerTime}
    {token}
    oncomment={onfocusmedia
      ? (file, time) => onfocusmedia?.(viewerPost!, file.id, time)
      : undefined}
  />{/if}

{#if editing}
  <ConfirmDialog bind:this={confirmation} />
{/if}

<style>
  .post-text a.invalid-mention {
    color: var(--destructive);
    text-decoration: underline wavy;
    text-underline-offset: 3px;
  }
  .timeline-author {
    flex-wrap: nowrap;
  }
  .detail-post {
    row-gap: 8px;
    padding-bottom: 16px;
  }
  .detail-post .post-body {
    display: contents;
  }
  .detail-post .post-body > :global(*) {
    grid-column: 1 / -1;
  }
  .detail-post .post-body > .post-author {
    grid-column: 2;
    gap: 0 4px;
    align-content: center;
  }
  .author-break {
    flex-basis: 100%;
    height: 0;
  }
  .detail-post .post-author .handle,
  .detail-post .post-author time {
    font-size: 13px;
    color: var(--post-muted);
  }
  .detail-post:not(:last-child)::before {
    display: none;
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
  .post-time-separator {
    color: var(--post-muted);
  }
  .timeline-author time {
    flex-shrink: 0;
    color: var(--post-muted);
    white-space: nowrap;
  }
  .source-unavailable {
    margin: 12px 0 0;
    color: var(--post-subtle);
    font-size: 13px;
    line-height: 20px;
  }
  .source-label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--post-subtle);
    font-size: 13px;
  }
  .reply-source {
    padding: 16px;
    border-bottom: 1px solid var(--post-border);
  }
  .quote-source {
    margin-top: 12px;
    padding: 12px;
    border: 1px solid var(--post-border);
    border-radius: 16px;
  }
</style>
