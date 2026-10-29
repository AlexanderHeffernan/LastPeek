<script lang="ts">
  import Icon from "./Icon.svelte";
  import twitter from "twitter-text";
  import { mediaURL, type Content, type Media } from "$lib/contracts";
  let {
    content = $bindable(),
    media,
    editing = false,
    token,
    onchange = () => {},
    onupload = () => {},
  }: {
    content: Content;
    media: Media[];
    editing?: boolean;
    token?: string;
    onchange?: () => void;
    onupload?: (postId: string, files: File[]) => void;
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
</script>

{#if editing}<div class="identity">
    <label
      >Display name<input
        bind:value={content.author.name}
        oninput={onchange}
        maxlength="80"
        required
      /></label
    ><label
      >X handle <span class="muted">(optional)</span><input
        bind:value={content.author.handle}
        oninput={onchange}
        placeholder="@yourname"
        maxlength="16"
      /></label
    >
  </div>{/if}
<section aria-label="Post thread">
  {#each content.posts as post, index (post.id)}
    <article class="post" aria-label={`Post ${index + 1}`}>
      <div class="avatar" aria-hidden="true">
        {content.author.name.slice(0, 1).toUpperCase() || "Y"}
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
        {#if editing}<textarea
            class="post-editor"
            aria-label={`Post ${index + 1} text`}
            bind:value={post.text}
            oninput={onchange}
            placeholder={index
              ? "Keep the thought going…"
              : "What’s on your mind?"}
            maxlength="25000"
            rows={Math.max(
              3,
              Math.min(
                14,
                post.text.split("\n").length + Math.ceil(post.text.length / 60),
              ),
            )}></textarea>{:else}<p class="post-text">{post.text}</p>{/if}
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
                      ><track kind="captions" />Your browser cannot play this
                      video. Use the download link below.</video
                    ><a
                      class="small muted"
                      style="display:block;padding:8px 12px"
                      href={`${mediaURL(id, token)}${token ? "&" : "?"}download=1`}
                      >Download video if playback is unavailable</a
                    >
                  {:else}<a
                      href={mediaURL(id, token)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open image ${mediaIndex + 1} on post ${index + 1}`}
                      ><img src={mediaURL(id, token)} alt={item.filename} /></a
                    >{/if}
                  {#if editing}<div class="media-actions">
                      {#if mediaIndex > 0}<button
                          class="icon-button"
                          aria-label={`Move attachment ${mediaIndex + 1} earlier on post ${index + 1}`}
                          onclick={() => moveMedia(index, mediaIndex, -1)}
                          ><Icon name="back" size={12} /></button
                        >{/if}{#if mediaIndex < post.media.length - 1}<button
                          class="icon-button"
                          aria-label={`Move attachment ${mediaIndex + 1} later on post ${index + 1}`}
                          onclick={() => moveMedia(index, mediaIndex, 1)}
                          ><Icon name="arrow" size={12} /></button
                        >{/if}<button
                        class="icon-button"
                        aria-label={`Remove attachment ${mediaIndex + 1} from post ${index + 1}`}
                        onclick={() => {
                          post.media = post.media.filter((m) => m !== id);
                          onchange();
                        }}><Icon name="close" size={13} /></button
                      >
                    </div>{/if}
                </div>{/if}
            {/each}
          </div>{/if}
        {#if editing}{@const count = twitter.parseTweet(
            post.text,
          ).weightedLength}
          <div class="post-tools">
            <label class="upload-button"
              ><Icon name="image" size={17} /><span>Add media</span><input
                type="file"
                aria-label={`Add media to post ${index + 1}`}
                accept="image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm"
                multiple
                onchange={(event) => {
                  onupload(post.id, [...(event.currentTarget.files || [])]);
                  event.currentTarget.value = "";
                }}
              /></label
            ><span class="spacer"></span>
            <span
              class="counter"
              class:over={count > 280}
              title="X standard posts allow 280 weighted characters. Longer posts require an eligible X account."
              >{count}/280</span
            >
            {#if index > 0}<button
                class="icon-button quiet"
                aria-label={`Move post ${index + 1} up`}
                onclick={() => movePost(index, -1)}
                ><Icon name="up" size={14} /></button
              >{/if}{#if index < content.posts.length - 1}<button
                class="icon-button quiet"
                aria-label={`Move post ${index + 1} down`}
                onclick={() => movePost(index, 1)}
                ><Icon name="down" size={14} /></button
              >{/if}
            {#if content.posts.length > 1}<button
                class="icon-button quiet danger"
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
                }}><Icon name="close" size={14} /></button
              >{/if}
          </div>{/if}
      </div>
    </article>
  {/each}
</section>
{#if editing && content.posts.length < 25}<div class="add-post">
    <button
      class="quiet"
      onclick={() => {
        content.posts = [
          ...content.posts,
          { id: crypto.randomUUID(), text: "", media: [] },
        ];
        onchange();
      }}><Icon name="plus" size={15} />Add to thread</button
    >
  </div>{/if}
<div class="preview-caption">
  Unpublished preview · Appearance approximates X. Line wrapping, media crops
  and playback can vary. {#if editing}Longer posts may require X Premium.{/if}
</div>
