<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import Icon from "./Icon.svelte";
  import { mediaURL, type Media } from "$lib/contracts";
  let {
    items,
    index = $bindable(null),
    time = 0,
    token,
    oncomment,
  }: {
    items: Media[];
    index?: number | null;
    time?: number;
    token?: string;
    oncomment?: (file: Media, time: number | null) => void;
  } = $props();
  const file = $derived(index === null ? undefined : items[index]);
  let video = $state<HTMLVideoElement>();
  let pendingComment: { file: Media; time: number | null } | undefined;
</script>

<Dialog.Root
  bind:open={
    () => index !== null,
    (open) => {
      if (!open) index = null;
    }
  }
>
  <Dialog.Content
    class="media-viewer flex flex-col gap-0 p-0"
    showCloseButton={false}
    onCloseAutoFocus={(event) => {
      if (!pendingComment) return;
      event.preventDefault();
      oncomment?.(pendingComment.file, pendingComment.time);
      pendingComment = undefined;
    }}
    onkeydown={(event) => {
      if (event.target instanceof HTMLVideoElement || index === null) return;
      if (event.key === "ArrowLeft" && index > 0) {
        event.preventDefault();
        index--;
      }
      if (event.key === "ArrowRight" && index < items.length - 1) {
        event.preventDefault();
        index++;
      }
    }}
  >
    {#if file}
      <Dialog.Header class="sr-only">
        <Dialog.Title>Attachment viewer</Dialog.Title>
        <Dialog.Description class="sr-only"
          >Attachment viewer. Use the previous and next buttons to browse
          attachments.</Dialog.Description
        >
      </Dialog.Header>
      <div class="viewer-stage">
        {#key file.id}
          {#if file.mime.startsWith("video/")}
            <video
              bind:this={video}
              src={mediaURL(file.id, token)}
              controls
              muted
              playsinline
              preload="metadata"
              aria-label="Enlarged video"
              onloadedmetadata={(event) => {
                event.currentTarget.currentTime = Math.min(
                  time,
                  event.currentTarget.duration || 0,
                );
              }}><track kind="captions" /></video
            >
          {:else}<img src={mediaURL(file.id, token)} alt={file.filename} />{/if}
        {/key}
      </div>
      <div class="viewer-actions">
        {#if items.length > 1}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous attachment"
            disabled={index === 0}
            onclick={() => {
              if (index !== null) index--;
            }}><Icon name="back" /></Button
          >
          <span class="small muted">{(index ?? 0) + 1} / {items.length}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next attachment"
            disabled={index === items.length - 1}
            onclick={() => {
              if (index !== null) index++;
            }}><Icon name="arrow" /></Button
          >
        {/if}
        <span class="viewer-spacer"></span>
        <Button
          variant="ghost"
          size="icon-sm"
          href={`${mediaURL(file.id, token)}${token ? "&" : "?"}download=1`}
          download={file.filename}
          aria-label={`Download ${file.filename}`}
          title="Download"><Icon name="download" /></Button
        >
        {#if oncomment}<Button
            variant="ghost"
            size="icon"
            aria-label="Comment on attachment"
            title="Comment on attachment"
            onclick={() => {
              pendingComment = {
                file,
                time: file.mime.startsWith("video/")
                  ? (video?.currentTime ?? time)
                  : null,
              };
              index = null;
            }}><Icon name="comment" /></Button
          >{/if}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close"
          onclick={() => (index = null)}><Icon name="close" /></Button
        >
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>

<style>
  :global(.media-viewer) {
    width: 100vw;
    max-width: 100vw;
    height: 100dvh;
    max-height: 100dvh;
    border-radius: 0;
    background: #09090bf5;
    box-shadow: none;
    --tw-ring-shadow: 0 0 #0000;
  }
  .viewer-stage {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
    flex: 1;
    padding: 64px 16px 16px;
    overflow: hidden;
  }
  .viewer-stage img,
  .viewer-stage video {
    display: block;
    max-width: 100%;
    max-height: calc(100dvh - 80px);
    object-fit: contain;
  }
  .viewer-actions {
    position: absolute;
    top: max(12px, env(safe-area-inset-top));
    right: max(12px, env(safe-area-inset-right));
    left: 12px;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .viewer-spacer {
    flex: 1;
  }
  .viewer-actions :global(button),
  .viewer-actions :global(a) {
    min-height: 44px;
    min-width: 44px;
    border-radius: 999px;
  }
  @media (max-width: 600px) {
    :global(.media-viewer) {
      width: 100vw;
      max-width: 100vw;
      height: 100dvh;
      max-height: 100dvh;
      border-radius: 0;
    }
    .viewer-stage {
      flex: 1;
    }
  }
</style>
