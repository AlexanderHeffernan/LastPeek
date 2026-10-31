<script lang="ts">
  import { onMount } from "svelte";
  import Brand from "$lib/components/Brand.svelte";
  let dialog = $state<HTMLDialogElement>();

  onMount(() => {
    const element = dialog!;
    const standalone = matchMedia("(display-mode: standalone)");
    const touch = matchMedia("(pointer: coarse)");
    const landscape = matchMedia("(orientation: landscape)");
    const installed = () =>
      standalone.matches ||
      ("standalone" in navigator && navigator.standalone === true);
    let fullscreenMedia = false;

    function update() {
      // Safari cannot lock installed apps to portrait. Preserve the page and
      // its form state underneath a top-layer prompt, including open dialogs.
      const required =
        installed() && touch.matches && landscape.matches && !fullscreenMedia;
      if (required && !element.open) element.showModal();
      else if (!required && element.open) element.close();
    }
    function fullscreen(event: Event) {
      if (event.type === "webkitbeginfullscreen") fullscreenMedia = true;
      else if (event.type === "webkitendfullscreen") fullscreenMedia = false;
      else {
        const media = document.fullscreenElement;
        fullscreenMedia =
          !!media &&
          (media.matches("video,img") || !!media.querySelector("video,img"));
      }
      if (installed() && touch.matches) {
        // Unlocking restores the manifest's portrait default on exit.
        try {
          if (fullscreenMedia)
            screen.orientation
              ?.lock?.("any")
              .then(() => {
                if (!fullscreenMedia) screen.orientation?.unlock?.();
              })
              .catch(() => {});
          else screen.orientation?.unlock?.();
        } catch {
          // Some Safari versions expose the API but reject orientation changes.
        }
      }
      update();
    }
    const queries = [standalone, touch, landscape];
    const events = [
      "fullscreenchange",
      "webkitbeginfullscreen",
      "webkitendfullscreen",
    ];
    queries.forEach((query) => query.addEventListener("change", update));
    events.forEach((event) =>
      document.addEventListener(event, fullscreen, true),
    );
    update();
    return () => {
      queries.forEach((query) => query.removeEventListener("change", update));
      events.forEach((event) =>
        document.removeEventListener(event, fullscreen, true),
      );
      element.close();
    };
  });
</script>

<dialog
  bind:this={dialog}
  class="portrait-dialog"
  aria-labelledby="portrait-title"
  oncancel={(event) => event.preventDefault()}
>
  <div class="portrait-message">
    <Brand markOnly decorative />
    <h2 id="portrait-title">Back to portrait.</h2>
    <p>Turn your device to keep peeking.</p>
  </div>
</dialog>

<style>
  .portrait-dialog {
    width: 100dvw;
    height: 100dvh;
    max-width: none;
    max-height: none;
    margin: 0;
    border: 0;
    border-radius: 0;
    padding: 24px;
    background: var(--background);
    color: var(--foreground);
  }
  .portrait-dialog[open] {
    display: grid;
    place-items: center;
    text-align: center;
  }
  .portrait-message :global(svg) {
    width: 72px;
    height: auto;
  }
  h2 {
    margin: 20px 0 8px;
    font-size: 24px;
  }
  p {
    margin: 0;
    color: var(--muted-foreground);
  }
</style>
