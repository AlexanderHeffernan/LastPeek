<script lang="ts">
  import type { XSourcePost } from "$lib/x-post";
  import Icon from "./Icon.svelte";
  import twitter from "twitter-text";
  let { post }: { post: XSourcePost } = $props();
  const parts = $derived.by(() => {
    const result: { text: string; url?: string }[] = [];
    let cursor = 0;
    for (const entity of twitter.extractEntitiesWithIndices(post.text)) {
      const [start, end] = entity.indices;
      result.push({ text: post.text.slice(cursor, start) });
      const text = post.text.slice(start, end);
      const link = post.links.find((item) => item.text === text);
      const url =
        "url" in entity
          ? (link?.url ??
            (/^https?:\/\//i.test(entity.url)
              ? entity.url
              : `https://${entity.url}`))
          : "hashtag" in entity
            ? `https://x.com/hashtag/${encodeURIComponent(entity.hashtag)}`
            : `https://x.com/${"screenName" in entity ? entity.screenName : ""}`;
      result.push({ text: link?.label ?? text, url });
      cursor = end;
    }
    result.push({ text: post.text.slice(cursor) });
    return result;
  });
  const date = $derived(new Date(post.createdAt));
</script>

<div class="source-post" aria-label="Original X post">
  <a
    class="source-permalink"
    href={post.url}
    target="_blank"
    rel="noopener noreferrer"
    aria-label="Open original post on X"
  ></a>
  <div class="source-author">
    <a
      href={`https://x.com/${post.author.username}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${post.author.name} on X`}
    >
      <img
        class="source-avatar"
        src={post.author.avatar}
        alt=""
        referrerpolicy="no-referrer"
      />
      <span
        ><strong>{post.author.name}</strong><span class="source-handle"
          >@{post.author.username}</span
        ></span
      >
    </a>
    <span class="x-logo" aria-label="X"><Icon name="x" size={22} /></span>
  </div>
  <p class="source-text">
    {#each parts as part}{#if part.url}<a
          href={part.url}
          target="_blank"
          rel="noopener noreferrer">{part.text}</a
        >{:else}{part.text}{/if}{/each}
  </p>
  {#if post.media.length}
    <div class="source-media" class:multiple={post.media.length > 1}>
      {#each post.media as item}
        {#if item.type === "photo"}
          <a
            href={post.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="View image on X"
            ><img
              src={item.url}
              alt={item.alt}
              referrerpolicy="no-referrer"
            /></a
          >
        {:else}
          <video
            src={item.url}
            poster={item.preview}
            controls
            playsinline
            preload="none"
            aria-label={item.alt ||
              (item.type === "animated_gif"
                ? "Animated GIF on X"
                : "Video on X")}
            loop={item.type === "animated_gif"}><track kind="captions" /></video
          >
        {/if}
      {/each}
    </div>
  {/if}
  <div class="source-footer">
    <a href={post.url} target="_blank" rel="noopener noreferrer"
      ><time datetime={post.createdAt}
        >{date.toLocaleString("en", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZone: "UTC",
          timeZoneName: "short",
        })}</time
      ></a
    >
    <span aria-hidden="true">·</span>
    <a href={post.url} target="_blank" rel="noopener noreferrer">View on X</a>
  </div>
</div>

<style>
  .source-post {
    position: relative;
    min-width: 0;
    margin-top: 12px;
    color: #e7e9ea;
  }
  .source-permalink {
    position: absolute;
    inset: 0;
  }
  .source-author,
  .source-text,
  .source-media,
  .source-footer {
    position: relative;
  }
  .source-author,
  .source-footer {
    pointer-events: none;
  }
  .source-author a,
  .source-footer a {
    pointer-events: auto;
  }
  .source-author {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .source-author > a {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    color: inherit;
    text-decoration: none;
  }
  .source-author > a > span {
    min-width: 0;
  }
  strong {
    display: block;
    overflow-wrap: anywhere;
    font-size: 15px;
    line-height: 20px;
  }
  .source-avatar {
    width: 40px;
    height: 40px;
    flex: 0 0 40px;
    object-fit: cover;
    border-radius: 50%;
  }
  .source-handle {
    color: #71767b;
    font-size: 14px;
    overflow-wrap: anywhere;
  }
  .x-logo {
    font-size: 24px;
    align-self: flex-start;
  }
  .source-text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 15px;
    line-height: 20px;
    margin: 12px 0;
  }
  .source-text a {
    color: #1d9bf0;
  }
  .source-media {
    display: grid;
    overflow: hidden;
    gap: 2px;
    border: 1px solid #2f3336;
    border-radius: 14px;
  }
  .source-media.multiple {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .source-media a {
    min-width: 0;
  }
  .source-media img,
  .source-media video {
    display: block;
    width: 100%;
    max-height: 480px;
    object-fit: contain;
    background: #000;
  }
  .multiple img {
    height: 160px;
    object-fit: cover;
  }
  .source-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-top: 12px;
    font-size: 13px;
    color: #71767b;
  }
  .source-footer a {
    color: inherit;
  }
</style>
