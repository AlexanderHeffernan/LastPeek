<script lang="ts">
  import { onDestroy } from "svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import Icon from "./Icon.svelte";

  let {
    text,
    index,
    oncopy,
  }: {
    text: string;
    index: number;
    oncopy: (text: string) => boolean | Promise<boolean>;
  } = $props();
  let copied = $state(false);
  let copying = $state(false);
  let resetTimer: ReturnType<typeof setTimeout>;
  let destroyed = false;

  onDestroy(() => {
    destroyed = true;
    clearTimeout(resetTimer);
  });

  async function copy() {
    copying = true;
    clearTimeout(resetTimer);
    copied = false;
    try {
      if (await oncopy(text)) {
        if (destroyed) return;
        copied = true;
        resetTimer = setTimeout(() => (copied = false), 2200);
      }
    } finally {
      copying = false;
    }
  }
</script>

<Button
  variant="ghost"
  class="icon-button"
  aria-label={`Copy post ${index + 1} text`}
  title={copied ? "Copied!" : "Copy text"}
  disabled={copying}
  onclick={copy}
>
  <span class="copy-feedback" class:copied aria-hidden="true">
    <span class="copy-icon"><Icon name="copy" size={20} /></span>
    <span class="check-icon"><Icon name="check" size={20} /></span>
  </span>
  <span class="sr-only" role="status"
    >{copied ? `Post ${index + 1} text copied` : ""}</span
  >
</Button>

<style>
  .copy-feedback {
    display: grid;
    width: 20px;
    height: 20px;
    place-items: center;
  }
  .copy-feedback > span {
    grid-area: 1 / 1;
    display: flex;
    transition:
      opacity 180ms ease,
      transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .copy-icon {
    opacity: 1;
    transform: scale(1) rotate(0deg);
  }
  .check-icon {
    opacity: 0;
    transform: scale(0.6) rotate(-25deg);
  }
  .copied .copy-icon {
    opacity: 0;
    transform: scale(0.6) rotate(25deg);
  }
  .copied .check-icon {
    opacity: 1;
    transform: scale(1) rotate(0deg);
  }
  @media (prefers-reduced-motion: reduce) {
    .copy-feedback > span {
      transition: none;
      transform: none;
    }
  }
</style>
