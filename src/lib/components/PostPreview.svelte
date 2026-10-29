<script lang="ts">
  import { Input } from "$lib/components/ui/input/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import Icon from "./Icon.svelte";
  import twitter from "twitter-text";
  import { tick } from "svelte";
  import {
    mediaURL,
    avatarURL,
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
  }: {
    content: Content;
    media: Media[];
    editing?: boolean;
    token?: string;
    onchange?: () => void;
    onupload?: (postId: string, files: File[]) => void;
    oncopy?: (text: string) => void;
  } = $props();
  function movePost(index: number, direction: number) {
    const next = [...content.posts];
    [next[index], next[index + direction]] = [
      next[index + direction],
      next[index],
    ];
    content.posts = next;
    onchange();
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

<section aria-label="Post thread">
  {#each content.posts as post, index (post.id)}
    <article class="post" aria-label={`Post ${index + 1}`}>
      <div class="avatar" aria-hidden="true">
        {#if content.author.avatar}<img
            src={avatarURL(content.author.avatar, token)}
            alt=""
          />{:else}{content.author.name.slice(0, 1).toUpperCase() || "Y"}{/if}
      </div>
      <div class="post-body">
        <div class="post-author">
          <strong>{content.author.name || "Your name"}</strong><span
            class="handle"
            >{content.author.handle
              ? `@${content.author.handle.replace(/^@/, "")}`
              : ""}</span
          >{#if content.posts.length > 1}<span
              class="muted small"
              style="margin-left:auto">{index + 1}/{content.posts.length}</span
            >{/if}
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
            {#each textParts(post.text) as part}{#if part.href}<a
                  href={part.href}
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
                      src={mediaURL(id, token)}
                      controls
                      playsinline
                      preload="metadata"
                      aria-label={`Video on post ${index + 1}`}
                      ><track kind="captions" /><a
                        href={`${mediaURL(id, token)}${token ? "&" : "?"}download=1`}
                        >Download video</a
                      ></video
                    >
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
                    </div>{:else if item.mime.startsWith("video/")}<div
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
        {#if editing || oncopy}{@const count = twitter.parseTweet(
            post.text,
          ).weightedLength}
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
                  <circle cx="12" cy="12" r="10" stroke="#2f3336" />
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke={count > 280 ? "#ffad1f" : "#1d9bf0"}
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
                {#if index === content.posts.length - 1 && content.posts.length < 25}<Button
                    variant="outline"
                    class="icon-button add-post"
                    aria-label="Add post to thread"
                    title="Add post to thread"
                    onclick={async () => {
                      const id = crypto.randomUUID();
                      content.posts = [
                        ...content.posts,
                        { id, text: "", media: [] },
                      ];
                      onchange();
                      await tick();
                      document.getElementById(`post-text-${id}`)?.focus();
                    }}><Icon name="plus" size={20} /></Button
                  >{/if}
              </div>
              {#if content.posts.length > 1}<div class="post-order">
                  {#if index > 0}<Button
                      variant="ghost"
                      class="icon-button"
                      aria-label={`Move post ${index + 1} up`}
                      onclick={() => movePost(index, -1)}
                      ><Icon name="up" size={14} /></Button
                    >{/if}{#if index < content.posts.length - 1}<Button
                      variant="ghost"
                      class="icon-button"
                      aria-label={`Move post ${index + 1} down`}
                      onclick={() => movePost(index, 1)}
                      ><Icon name="down" size={14} /></Button
                    >{/if}
                  {#if content.posts.length > 1}<Button
                      variant="destructive"
                      class="icon-button danger"
                      aria-label={`Remove post ${index + 1}`}
                      onclick={() => {
                        if (
                          confirm(
                            "Remove this post from the working draft? Shared versions and feedback will stay.",
                          )
                        ) {
                          content.posts = content.posts.filter(
                            (p) => p.id !== post.id,
                          );
                          onchange();
                        }
                      }}><Icon name="close" size={14} /></Button
                    >{/if}
                </div>{/if}
            {/if}
          </div>{/if}
      </div>
    </article>
  {/each}
</section>
