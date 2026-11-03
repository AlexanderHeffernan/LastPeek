<script lang="ts">
  import { onMount } from "svelte";
  let handle: HTMLDivElement;
  let width = $state(600);
  let dragging = $state(false);
  function apply(next: number) {
    const page = handle.closest<HTMLElement>(".draft-page")!;
    width = Math.round(Math.max(460, Math.min(next, 628)));
    page.style.setProperty("--post-column-width", `${width}px`);
  }
  function save() {
    try {
      localStorage.setItem("lastpeek-post-width", String(width));
    } catch {
      /* Storage may be disabled. */
    }
  }
  onMount(() => {
    try {
      const stored = Number(localStorage.getItem("lastpeek-post-width"));
      if (stored >= 460 && stored <= 700) apply(stored);
    } catch {
      /* Use the default split. */
    }
  });
</script>

<!-- A focusable ARIA window splitter supports both pointer and arrow-key resizing. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  bind:this={handle}
  class="discussion-split"
  class:dragging
  role="separator"
  aria-label="Post and discussion column widths"
  aria-orientation="vertical"
  aria-valuemin={460}
  aria-valuemax={628}
  aria-valuenow={width}
  tabindex="0"
  onpointerdown={(event) => {
    if (event.button !== 0) return;
    dragging = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }}
  onpointermove={(event) => {
    if (!dragging) return;
    const page = handle.closest<HTMLElement>(".draft-page")!;
    apply(event.clientX - page.getBoundingClientRect().left - 12);
  }}
  onpointerup={() => {
    dragging = false;
    save();
  }}
  onlostpointercapture={() => (dragging = false)}
  onkeydown={(event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    apply(
      event.key === "Home"
        ? 460
        : event.key === "End"
          ? 628
          : width + (event.key === "ArrowRight" ? 16 : -16),
    );
    save();
  }}
></div>

<style>
  .discussion-split {
    position: absolute;
    top: 0;
    bottom: 0;
    left: var(--post-column-width, 600px);
    width: 24px;
    cursor: col-resize;
    touch-action: none;
    z-index: 21;
  }
  .discussion-split::after {
    content: "";
    position: absolute;
    top: 76px;
    height: 40px;
    width: 3px;
    left: 10px;
    border-radius: 3px;
    background: var(--border);
    transition: background 150ms;
  }
  .discussion-split:hover::after,
  .discussion-split:focus-visible::after,
  .dragging::after {
    background: var(--muted-foreground);
  }
  @media (max-width: 1000px) {
    .discussion-split {
      display: none;
    }
  }
</style>
