<script lang="ts">
  import { onMount } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  let { time = $bindable(0) }: { time?: number } = $props();
  let video = $state<HTMLVideoElement>(),
    figure = $state<HTMLElement>();
  let watching = $state(false),
    paused = $state(true),
    ended = $state(false),
    duration = $state(46.5),
    // The poster stays on top until real frames are playing, so the film never flashes black.
    started = $state(false),
    muted = $state(true),
    // While the film plays with sound, its controls step aside until the pointer moves.
    idle = $state(false),
    idleTimer: ReturnType<typeof setTimeout> | undefined,
    restartSound = false,
    // A reader who pauses the preview keeps it paused while scrolling.
    held = false;
  // The muted preview loops the product story inside the app.
  const previewStart = 11;
  // Captions follow the playhead in our own layer, clear of the controls.
  const cues: [number, string][] = [
    [0, "[Typing] Alex posts straight to X: “our app launches tomorow 🚀”"],
    [3.5, "[Pings] The replies pile up: “tomorow 💀”"],
    [7.5, "[Music lifts] LastPeek. Take one last peek."],
    [11.5, "[Typing] This time, Alex drafts it in LastPeek first."],
    [
      15.5,
      "[Click] The link goes to the group chat: “Quick look before I post?”",
    ],
    [24, "[Pop] Sam spots the typo. Jamie, a guest, suggests a photo."],
    [30, "[Click] Alex fixes the typo and adds a launch photo."],
    [36, "[Rising tone] Alex holds Post to X. [Chime] Posted."],
    [41, "“Congrats!! 🎉” No typos. No regrets."],
    [45, "[Music ends] LastPeek."],
  ];
  const cue = $derived(cues.findLast(([at]) => time >= at)?.[1] ?? "");

  // The film loads before it scrolls into view and plays, muted, only while visible.
  // Sound always needs a deliberate click.
  onMount(() => {
    if (
      !video ||
      !matchMedia("(prefers-reduced-motion: no-preference)").matches
    )
      return;
    const element = video;
    const near = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        near.disconnect();
        element.preload = "auto";
        if (!watching && element.currentTime < previewStart)
          element.currentTime = previewStart;
      },
      { rootMargin: "150% 0px" },
    );
    const visible = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return element.pause();
        if (watching || held) return;
        void element.play().catch(() => {});
      },
      { threshold: 0.4 },
    );
    near.observe(element);
    visible.observe(element);
    return () => {
      near.disconnect();
      visible.disconnect();
      clearTimeout(idleTimer);
    };
  });

  // Chapters jump within whichever mode is playing: the muted preview or the film.
  export function seek(seconds: number) {
    if (!video) return;
    restartSound = false;
    held = false;
    ended = false;
    video.preload = "auto";
    video.currentTime = seconds;
    void video.play().catch(() => {});
  }

  function toggle() {
    if (!video) return;
    restartSound = false;
    if (video.paused) {
      held = false;
      if (ended) video.currentTime = 0;
      ended = false;
      void video.play().catch(() => {});
    } else {
      held = true;
      video.pause();
    }
  }

  // Small screens get the film at full size; iPhone only allows the video itself to go full screen.
  function expand() {
    if (!video || !figure) return;
    if (document.fullscreenElement) return void document.exitFullscreen();
    if (!watching) watch();
    if (figure.requestFullscreen)
      void figure.requestFullscreen().catch(() => {});
    else
      (
        video as HTMLVideoElement & { webkitEnterFullscreen?: () => void }
      ).webkitEnterFullscreen?.();
  }

  function watch() {
    if (!video) return;
    watching = true;
    ended = false;
    // Keep the old preview audio silent until the opening frame is ready.
    video.pause();
    video.muted = true;
    video.currentTime = 0;
    restartSound = video.seeking || video.readyState < 2;
    if (!restartSound) video.muted = false;
    // Start playback in the click gesture, preserving mobile autoplay permission.
    void video.play().catch(() => {});
    wake();
  }

  function finishSoundRestart() {
    if (video && restartSound && !video.seeking && video.readyState >= 2) {
      restartSound = false;
      video.muted = false;
    }
  }

  function wake() {
    idle = false;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => (idle = watching && !paused), 2500);
  }
</script>

<figure
  bind:this={figure}
  class="film"
  class:watching
  class:idle={idle && !paused && !ended}
  aria-describedby="film-description"
  onpointermove={wake}
  onfocusin={wake}
>
  <!-- Phones get a portrait cut framed around the action, on the same timeline. -->
  <video
    bind:this={video}
    bind:currentTime={time}
    bind:paused
    bind:duration
    width="1280"
    height="960"
    preload="metadata"
    muted
    playsinline
    onclick={toggle}
    onplaying={() => {
      started = true;
      finishSoundRestart();
    }}
    onseeked={finishSoundRestart}
    onvolumechange={() => video && (muted = video.muted)}
    onended={() => {
      if (!video) return;
      if (watching) {
        ended = true;
        return;
      }
      video.currentTime = previewStart;
      void video.play().catch(() => {});
    }}
    aria-label="LastPeek walkthrough film"
  >
    <source
      media="(max-width: 600px)"
      src="/landing/lastpeek-film-mobile.mp4"
      type="video/mp4"
    />
    <source src="/landing/lastpeek-film.mp4" type="video/mp4" />
  </video>
  <picture class="cover" class:hidden={started}>
    <source
      media="(max-width: 600px)"
      srcset="/landing/film-poster-mobile.jpg"
    />
    <img
      src="/landing/film-poster.jpg"
      alt="Alex’s fixed post, live on X, with a friend replying “Congrats!!”"
      width="1280"
      height="960"
    />
  </picture>
  {#if ended}
    <div class="end">
      <Button href="#waitlist-end" class="end-join">Join the waitlist</Button>
      <Button variant="outline" class="end-replay" onclick={watch}
        ><Icon name="play" size={16} weight="fill" />Replay</Button
      >
    </div>
  {/if}
  {#if watching && cue && !ended}<p class="caption" aria-hidden="true">
      {cue}
    </p>{/if}
  <div class="controls">
    <button
      type="button"
      class="icon"
      aria-label={paused ? "Play film" : "Pause film"}
      onclick={toggle}
      ><Icon name={paused ? "play" : "pause"} size={18} weight="fill" /></button
    >
    <input
      class="seek"
      type="range"
      min="0"
      max={duration || 46.5}
      step="0.1"
      value={time}
      aria-label="Seek film"
      aria-valuetext={`${Math.round(time)} of ${Math.round(duration || 46.5)} seconds`}
      style:--done={time / (duration || 46.5)}
      oninput={(event) => seek(Number(event.currentTarget.value))}
    />
    {#if watching}
      <button
        type="button"
        class="icon"
        aria-label={muted ? "Unmute film" : "Mute film"}
        onclick={() => video && (video.muted = !video.muted)}
        ><Icon name={muted ? "muted" : "sound"} size={18} /></button
      >
    {:else}
      <Button class="sound" onclick={watch}
        ><Icon name="sound" size={16} /><span class="long"
          >Watch with sound</span
        ><span class="short">Sound</span></Button
      >
    {/if}
    <button
      type="button"
      class="icon"
      aria-label="Watch full screen"
      onclick={expand}><Icon name="expand" size={18} /></button
    >
  </div>
  <figcaption id="film-description" class="sr-only">
    Alex writes “Huge news: our app launches tomorow” in LastPeek, copies a
    share link and sends it to a group chat. Sam points out the typo and Jamie,
    a guest, suggests adding a picture of the app. Alex fixes the typo, adds the
    photo and holds the button to post it to X. The film has music and sound
    effects but no speech. Captions describe them when you watch with sound.
  </figcaption>
</figure>

<style>
  .film {
    position: relative;
    margin: 0;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 28px;
    background: #0b0b0c;
    box-shadow:
      0 50px 100px -50px var(--shadow),
      0 30px 60px -40px color-mix(in srgb, var(--brand) 35%, transparent);
  }
  .film:fullscreen {
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 0;
  }
  .film:fullscreen video,
  .film:fullscreen .cover img {
    height: 100%;
    object-fit: contain;
  }
  video {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: 4 / 3;
    object-fit: contain;
    cursor: pointer;
  }
  .cover img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
    transition: opacity 300ms ease;
  }
  .cover.hidden img {
    opacity: 0;
  }
  /* Controls sit on a scrim along the bottom edge, never over the middle of the picture. */
  .controls {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 28px 14px 12px;
    background: linear-gradient(transparent, #0b0b0cc0);
    transition:
      opacity 300ms ease,
      transform 300ms ease;
  }
  .idle {
    cursor: none;
  }
  .idle .controls {
    opacity: 0;
    transform: translateY(8px);
  }
  .icon {
    display: grid;
    flex: none;
    place-items: center;
    width: 40px;
    height: 40px;
    border: 0;
    border-radius: 50%;
    background: #0b0b0cb3;
    color: #f2f0ec;
    cursor: pointer;
    backdrop-filter: blur(8px);
  }
  .icon:focus-visible,
  .seek:focus-visible,
  .film :global(.sound:focus-visible) {
    outline: 3px solid var(--brand);
    outline-offset: 2px;
  }
  .film :global(.sound) {
    flex: none;
    gap: 8px;
    height: 40px;
    padding-inline: 16px;
    border-radius: 999px;
    font-weight: 700;
  }
  .short {
    display: none;
  }
  .seek {
    flex: 1;
    min-width: 0;
    height: 40px;
    margin: 0;
    background: transparent;
    cursor: pointer;
    appearance: none;
  }
  .seek::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 4px;
    background: linear-gradient(
      90deg,
      var(--brand) calc(var(--done) * 100%),
      #ffffff40 0
    );
  }
  .seek::-moz-range-track {
    height: 4px;
    border-radius: 4px;
    background: linear-gradient(
      90deg,
      var(--brand) calc(var(--done) * 100%),
      #ffffff40 0
    );
  }
  .seek::-webkit-slider-thumb {
    width: 14px;
    height: 14px;
    margin-top: -5px;
    border: 0;
    border-radius: 50%;
    background: #f2f0ec;
    appearance: none;
  }
  .seek::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border: 0;
    border-radius: 50%;
    background: #f2f0ec;
  }
  .end {
    position: absolute;
    left: 50%;
    bottom: 72px;
    display: flex;
    gap: 10px;
    transform: translateX(-50%);
  }
  .end :global(a),
  .end :global(button) {
    height: 48px;
    padding-inline: 20px;
    border-radius: 999px;
    font-weight: 700;
    white-space: nowrap;
  }
  .end :global(.end-replay) {
    border-color: #0003;
    background: #fffdf9;
    color: #22191b;
  }
  .caption {
    position: absolute;
    right: 50%;
    bottom: 72px;
    width: max-content;
    max-width: calc(100% - 32px);
    margin: 0;
    padding: 6px 12px;
    border-radius: 10px;
    background: #0b0b0cd9;
    color: #f2f0ec;
    font-size: clamp(13px, 1.6vw, 17px);
    line-height: 1.35;
    text-align: center;
    text-wrap: balance;
    transform: translateX(50%);
    pointer-events: none;
    transition: bottom 300ms ease;
  }
  .idle .caption {
    bottom: 16px;
  }
  @media (max-width: 600px) {
    video {
      aspect-ratio: 4 / 5;
    }
    .long {
      display: none;
    }
    .short {
      display: inline;
    }
    .controls {
      gap: 6px;
      padding: 24px 8px 8px;
    }
    .film :global(.sound) {
      padding-inline: 12px;
    }
  }
</style>
