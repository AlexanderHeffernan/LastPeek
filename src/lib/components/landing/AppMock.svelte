<script lang="ts" module>
  export const BEFORE = "Huge news: our app launches ";
  export const TYPO = "tomorow";
  export const AFTER = " 🚀";
  export const POST = Array.from(BEFORE + TYPO + AFTER);
  export const THREAD = Array.from("Doors open at 9am. Set a reminder 👇");
  export type Scene = {
    /** Characters typed so far. */
    typed: number;
    /** Characters typed in the thread’s second post. */
    thread: number;
    shared: boolean;
    /** 0–4 group-chat messages, shown on the phone while sharing. */
    chat: number;
    comments: number;
    fixed: boolean;
    photo: boolean;
    /** 0–1 hold-to-post charge. */
    charge: number;
    posted: boolean;
    cursor: "none" | "share" | "word" | "image" | "post";
    camera: "wide" | "draft" | "discussion" | "button";
  };
  export const finished: Scene = {
    typed: POST.length,
    thread: THREAD.length,
    shared: true,
    chat: 0,
    comments: 2,
    fixed: true,
    photo: true,
    charge: 0,
    posted: true,
    cursor: "none",
    camera: "wide",
  };
</script>

<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import Brand from "$lib/components/Brand.svelte";

  let { scene, label }: { scene: Scene; label: string } = $props();

  const text = $derived(POST.slice(0, scene.typed).join(""));
  const second = $derived(THREAD.slice(0, scene.thread).join(""));
  const typoShown = $derived(scene.typed >= BEFORE.length + TYPO.length);
  const count = $derived(
    Array.from(scene.fixed ? text.replace(TYPO, "tomorrow") : text).reduce(
      (total, character) => total + (character.length > 1 ? 2 : 1),
      0,
    ),
  );

  let layer = $state<HTMLElement>(),
    shareButton = $state<HTMLElement>(),
    word = $state<HTMLElement>(),
    imageButton = $state<HTMLElement>(),
    postButton = $state<HTMLElement>(),
    draft = $state<HTMLElement>(),
    discussion = $state<HTMLElement>();
  let width = $state(0),
    height = $state(0);

  // Positions inside the untransformed layer, so camera moves never skew them.
  function offset(element: HTMLElement | undefined) {
    let x = 0,
      y = 0,
      node: HTMLElement | null = element ?? null;
    while (node && node !== layer) {
      x += node.offsetLeft;
      y += node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
    }
    return element
      ? { x, y, w: element.offsetWidth, h: element.offsetHeight }
      : { x: 0, y: 0, w: 0, h: 0 };
  }
  const targets = $derived.by(() => {
    void width;
    void height;
    void scene.photo;
    void scene.typed;
    return {
      share: offset(shareButton),
      word: offset(word),
      image: offset(imageButton),
      post: offset(postButton),
      draft: offset(draft),
      discussion: offset(discussion),
    };
  });
  const pointer = $derived.by(() => {
    if (scene.cursor === "none") return null;
    const box = targets[scene.cursor];
    return { x: box.x + box.w * 0.55, y: box.y + box.h * 0.6 };
  });
  // The camera glides between regions, like the launch film.
  const camera = $derived.by(() => {
    if (!width || scene.camera === "wide") return "none";
    const post = targets.post;
    const region =
      scene.camera === "button"
        ? {
            x: targets.draft.x,
            w: targets.draft.w,
            y: post.y - 230,
            h: post.h + 250,
          }
        : targets[scene.camera];
    // Keep the header in frame so a zoom never crops the page mid-line.
    const box = { ...region, y: 0, h: region.y + region.h };
    if (scene.camera === "button") Object.assign(box, region);
    const limit = scene.camera === "button" ? 1.8 : 1.42;
    const scale = Math.min(limit, width / box.w, height / box.h) * 0.97;
    const x = width / 2 - (box.x + box.w / 2) * scale;
    const y = height / 2 - (box.y + box.h / 2) * scale;
    const clampX = Math.min(0, Math.max(width - width * scale, x));
    const clampY = Math.min(0, Math.max(height - height * scale, y));
    return `translate(${clampX}px, ${clampY}px) scale(${scale})`;
  });
</script>

<div
  class="mock"
  role="img"
  aria-label={label}
  bind:clientWidth={width}
  bind:clientHeight={height}
>
  <div
    class="layer"
    bind:this={layer}
    style:transform={camera}
    aria-hidden="true"
  >
    <div class="bar">
      <span class="title"><Icon name="back" size={18} />Post</span>
      <span class="share" class:copied={scene.shared} bind:this={shareButton}>
        <span class="share-face" class:out={scene.shared}
          ><Icon name="link" size={16} />Share link</span
        >
        <span class="share-face" class:out={!scene.shared}
          ><Icon name="check" size={16} />Link copied</span
        >
      </span>
    </div>
    <div class="columns">
      <div class="draft" bind:this={draft}>
        <div class="identity">
          <img src="/landing/alex.webp" alt="" width="40" height="40" />
          <span><strong>Alex Heffernan</strong><small>@AlexH2035</small></span>
        </div>
        <p class="text">
          {#if typoShown}{BEFORE}<span
              class="word"
              class:flagged={scene.comments > 0 && !scene.fixed}
              class:corrected={scene.fixed}
              bind:this={word}>{scene.fixed ? "tomorrow" : TYPO}</span
            >{text.slice(BEFORE.length + TYPO.length)}{:else}{text}{/if}<span
            class="caret"
            class:idle={scene.typed >= POST.length}
          ></span>
        </p>
        <div class="photo" class:shown={scene.photo}>
          <span class="mascot"><Brand markOnly decorative /></span>
          <span class="photo-copy"
            ><small>Launching</small><span>tomorrow<em>.</em></span></span
          >
        </div>
        {#if scene.thread > 0}
          <div class="reply">
            <img src="/landing/alex.webp" alt="" width="32" height="32" />
            <p>
              {second}<span
                class="caret"
                class:idle={scene.thread >= THREAD.length}
              ></span>
            </p>
          </div>
        {/if}
        <div class="tools">
          <span
            class="tool"
            class:pressed={scene.cursor === "image"}
            bind:this={imageButton}><Icon name="image" size={19} /></span
          >
          <span class="tool"><Icon name="thread" size={19} /></span>
          <span class="count">
            <svg viewBox="0 0 20 20">
              <circle cx="10" cy="10" r="8" />
              <circle
                class="meter"
                cx="10"
                cy="10"
                r="8"
                style:stroke-dashoffset={50.27 * (1 - count / 280)}
              />
            </svg>
            {count}
          </span>
          <span class="plus"><Icon name="plus" size={16} /></span>
          <span
            class="publish"
            class:posted={scene.posted}
            class:holding={scene.charge > 0}
            style:--charge={scene.charge}
            bind:this={postButton}
          >
            <span class="charge"></span>
            <span class="label"
              >{#if scene.posted}View on{:else}Post to{/if}
              <Icon name="x" size={14} weight="bold" /></span
            >
            {#if scene.posted}<span class="burst"
                >{#each Array(12) as _, index}<i
                    style:--angle={`${index * 30}deg`}
                  ></i>{/each}</span
              >{/if}
          </span>
        </div>
      </div>
      <div class="discussion" bind:this={discussion}>
        <span class="heading">Discussion</span>
        <span class="quiet" class:gone={scene.comments > 0}
          >Waiting for a second opinion…</span
        >
        <div
          class="comment"
          class:shown={scene.comments > 0}
          class:resolved={scene.fixed}
        >
          <span class="face">S</span>
          <div>
            <span class="meta"><strong>Sam</strong> · now</span>
            <span class="quote">“tomorow”</span>
            <span class="body">tomorrow* 👀</span>
            <span class="done" class:shown={scene.fixed}
              ><Icon name="check" size={13} />Fixed</span
            >
          </div>
        </div>
        <div
          class="comment"
          class:shown={scene.comments > 1}
          class:resolved={scene.photo}
        >
          <span class="face guest"><Icon name="guest" size={20} /></span>
          <div>
            <span class="meta"
              ><strong>Jamie</strong><span class="pill">Guest</span> · now</span
            >
            <span class="body">Love it! Maybe add a pic of the app?</span>
            <span class="done" class:shown={scene.photo}
              ><Icon name="check" size={13} />Added</span
            >
          </div>
        </div>
      </div>
    </div>
    <div class="phone" class:shown={scene.chat > 0}>
      <span class="island"></span>
      <span class="group"
        ><span class="dot">S</span><span class="dot">J</span>Launch crew</span
      >
      <div class="link-card" class:shown={scene.chat > 0}>
        <span class="art"><Brand markOnly decorative /></span>
        <span class="link-text"
          ><strong>Alex Heffernan · Post for review</strong
          >lastpeek.alexheffernan.dev</span
        >
      </div>
      <span class="bubble out" class:shown={scene.chat > 1}
        >Quick look before I post? 👀</span
      >
      <span class="bubble in" class:shown={scene.chat > 2}
        ><b>Sam</b>on it 👀</span
      >
      <span class="bubble in" class:shown={scene.chat > 3}
        ><b>Jamie</b>ooh yes, one sec!</span
      >
    </div>
    {#if pointer}
      <span
        class="cursor"
        class:click={scene.cursor === "post" ? scene.charge > 0 : false}
        style:transform={`translate(${pointer.x}px, ${pointer.y}px)`}
      >
        <Icon name="pointer" size={30} weight="fill" />
      </span>
    {/if}
  </div>
</div>

<style>
  .mock {
    position: relative;
    font-family: Arial, Helvetica, sans-serif;
    overflow: hidden;
    width: 100%;
    height: 100%;
    border-radius: inherit;
    background: var(--background);
    container-type: inline-size;
  }
  .layer {
    position: relative;
    height: 100%;
    transform-origin: 0 0;
    transition: transform 1100ms cubic-bezier(0.65, 0, 0.25, 1);
    will-change: transform;
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    height: 60px;
    padding: 0 14px 0 20px;
    border-bottom: 1px solid var(--border);
  }
  .title {
    display: inline-flex;
    align-items: center;
    gap: 14px;
    font-size: 18px;
    font-weight: 700;
  }
  .share {
    position: relative;
    display: inline-grid;
    height: 36px;
    border: 1px solid var(--border);
    border-radius: 999px;
    overflow: hidden;
    font-size: 14px;
    font-weight: 700;
    transition:
      background 300ms ease,
      border-color 300ms ease,
      color 300ms ease;
  }
  .share.copied {
    border-color: color-mix(in srgb, var(--success) 45%, var(--border));
    background: color-mix(in srgb, var(--success) 12%, transparent);
    color: var(--success);
  }
  .share-face {
    grid-area: 1 / 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 0 14px;
    transition:
      opacity 280ms ease,
      transform 380ms cubic-bezier(0.2, 1.4, 0.4, 1);
  }
  .share-face.out {
    opacity: 0;
    transform: translateY(10px);
  }
  .columns {
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
    height: calc(100% - 60px);
  }
  .draft {
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: 20px 20px 16px;
    border-right: 1px solid var(--border);
    color: var(--post-foreground);
  }
  .identity {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .identity img {
    width: 40px;
    height: 40px;
    border-radius: 50%;
  }
  .identity span {
    display: grid;
    font-size: 15px;
    line-height: 20px;
  }
  .identity small {
    color: var(--post-muted);
    font-size: 15px;
  }
  .text {
    min-height: 48px;
    margin: 12px 0 0;
    font-size: 18px;
    line-height: 24px;
  }
  .word {
    border-radius: 3px;
    transition:
      background 300ms ease,
      box-shadow 300ms ease;
  }
  .word.flagged {
    background: color-mix(in srgb, var(--brand) 24%, transparent);
    box-shadow: 0 2px 0 var(--brand);
  }
  .word.corrected {
    animation: corrected 900ms ease;
  }
  @keyframes corrected {
    25% {
      background: color-mix(in srgb, var(--success) 32%, transparent);
    }
  }
  .caret {
    display: inline-block;
    width: 0;
    height: 1.15em;
    margin-left: 1px;
    vertical-align: text-bottom;
    box-shadow: 0 0 0 1px var(--brand);
    animation: blink 1s steps(1) infinite;
  }
  .caret.idle {
    visibility: hidden;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
  .reply {
    position: relative;
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr);
    gap: 10px;
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid var(--post-border);
    font-size: 16px;
    line-height: 22px;
    animation: arrive 500ms cubic-bezier(0.2, 1.3, 0.4, 1);
  }
  .reply img {
    width: 32px;
    height: 32px;
    border-radius: 50%;
  }
  .reply p {
    margin: 4px 0 0;
  }
  .photo {
    display: flex;
    align-items: center;
    gap: 6%;
    max-height: 0;
    margin-top: 0;
    padding: 0 6%;
    overflow: hidden;
    border: 1px solid transparent;
    border-radius: 18px;
    background:
      radial-gradient(circle at 85% 15%, #ffd9cc 0, transparent 55%), #fff6ed;
    color: #22191b;
    opacity: 0;
    transform: scale(0.94);
    transform-origin: top left;
    transition:
      max-height 600ms cubic-bezier(0.2, 1, 0.3, 1),
      margin 600ms ease,
      opacity 400ms ease,
      transform 600ms cubic-bezier(0.2, 1.4, 0.4, 1);
  }
  .photo.shown {
    max-height: 260px;
    aspect-ratio: 16 / 8;
    margin-top: 14px;
    border-color: var(--post-border);
    opacity: 1;
    transform: none;
  }
  .mascot {
    flex: none;
    width: 34%;
  }
  .mascot :global(.brand svg) {
    width: 100%;
    height: auto;
  }
  .photo-copy {
    display: grid;
    font-family: var(--display, Arial);
    font-size: clamp(18px, 5.5cqw, 34px);
    font-weight: 800;
    line-height: 1;
    letter-spacing: -0.02em;
  }
  .photo-copy small {
    color: #78665f;
    font-size: 0.5em;
    font-weight: 600;
    letter-spacing: 0;
  }
  .photo-copy em {
    color: #e05c4b;
    font-style: normal;
  }
  .tools {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: auto;
    padding-top: 14px;
    color: var(--primary);
  }
  .tool {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    transition: background 200ms ease;
  }
  .tool.pressed {
    background: color-mix(in srgb, var(--brand) 16%, transparent);
  }
  .count {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: 6px;
    color: var(--muted-foreground);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .count svg {
    width: 20px;
    height: 20px;
    transform: rotate(-90deg);
  }
  .count circle {
    fill: none;
    stroke: var(--border);
    stroke-width: 2.5;
  }
  .count .meter {
    stroke: var(--brand);
    stroke-dasharray: 50.27;
  }
  .plus {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    margin-left: auto;
    border: 1px solid var(--border);
    border-radius: 50%;
  }
  .publish {
    position: relative;
    isolation: isolate;
    display: inline-flex;
    align-items: center;
    height: 36px;
    margin-left: 8px;
    padding: 0 15px;
    border-radius: 999px;
    background: var(--primary-fill);
    color: var(--primary-foreground);
    font-size: 14px;
    font-weight: 700;
    transform: scale(calc(1 - var(--charge) * 0.07));
    transition: background 300ms ease;
  }
  .publish.holding {
    box-shadow:
      0 0 0 calc(var(--charge) * 4px)
        rgb(255 172 103 / calc(var(--charge) * 0.25)),
      0 0 calc(var(--charge) * 30px) rgb(255 91 124 / calc(var(--charge) * 0.6)),
      0 0 calc(var(--charge) * 60px) rgb(255 184 85 / calc(var(--charge) * 0.3));
  }
  .publish.posted {
    background: transparent;
    color: var(--foreground);
    box-shadow: inset 0 0 0 1px var(--border);
    animation: settle 600ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  @keyframes settle {
    0% {
      transform: scale(0.9);
    }
    40% {
      transform: scale(1.1);
    }
  }
  .charge {
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    background: linear-gradient(
      110deg,
      #ff87bf 0%,
      #ff9270 42%,
      #ffd479 75%,
      #fff0bb 100%
    );
    clip-path: inset(0 calc((1 - var(--charge)) * 100%) 0 0 round 999px);
  }
  .label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
  }
  .burst {
    position: absolute;
    inset: 50%;
  }
  .burst i {
    position: absolute;
    width: 6px;
    height: 3px;
    border-radius: 3px;
    background: #ffd889;
    box-shadow: 0 0 6px #ffad80;
    animation: spark 800ms cubic-bezier(0.1, 0.6, 0.3, 1) both;
  }
  @keyframes spark {
    from {
      opacity: 1;
      transform: rotate(var(--angle)) translateX(18px) scaleX(1.8);
    }
    to {
      opacity: 0;
      transform: rotate(var(--angle)) translateX(76px) scaleX(0.3);
    }
  }
  .discussion {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    padding: 20px 16px;
    background: color-mix(in srgb, var(--muted) 55%, transparent);
  }
  .heading {
    font-size: 15px;
    font-weight: 700;
  }
  .quiet {
    color: var(--muted-foreground);
    font-size: 14px;
    transition: opacity 300ms ease;
  }
  .quiet.gone {
    display: none;
  }
  .comment {
    display: none;
    grid-template-columns: 32px minmax(0, 1fr);
    gap: 10px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--card);
    font-size: 14px;
    line-height: 19px;
  }
  .comment.shown {
    display: grid;
    animation: arrive 600ms cubic-bezier(0.2, 1.3, 0.4, 1);
  }
  @keyframes arrive {
    from {
      opacity: 0;
      transform: translateY(18px) scale(0.96);
    }
  }
  .comment > div {
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  .face {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--avatar-background);
    color: var(--avatar-foreground);
    font-weight: 700;
  }
  .face.guest {
    background: var(--secondary);
    color: var(--muted-foreground);
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--muted-foreground);
    font-size: 13px;
    white-space: nowrap;
  }
  .meta strong {
    color: var(--foreground);
  }
  .pill {
    padding: 0 6px;
    border-radius: 999px;
    background: var(--secondary);
    font-size: 11px;
    line-height: 17px;
  }
  .quote {
    justify-self: start;
    padding: 1px 7px;
    border-left: 2px solid var(--brand);
    border-radius: 4px;
    background: color-mix(in srgb, var(--brand) 12%, transparent);
    color: var(--muted-foreground);
    font-size: 13px;
  }
  .done {
    display: none;
    align-items: center;
    gap: 4px;
    color: var(--success);
    font-size: 12px;
    font-weight: 700;
  }
  .done.shown {
    display: inline-flex;
    animation: arrive 400ms ease;
  }
  .phone {
    position: absolute;
    top: 78px;
    right: 26px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: min(44%, 290px);
    height: calc(100% - 96px);
    padding: 44px 12px 14px;
    border: 6px solid #2a2a2e;
    border-radius: 38px;
    background: #050505;
    color: #f2f0ec;
    box-shadow: 0 40px 80px -20px #000a;
    font-size: 14px;
    opacity: 0;
    transform: translateX(120%) rotate(6deg);
    transition:
      transform 800ms cubic-bezier(0.2, 1, 0.3, 1),
      opacity 400ms ease;
  }
  .phone.shown {
    opacity: 1;
    transform: none;
  }
  .island {
    position: absolute;
    top: 10px;
    left: 50%;
    width: 84px;
    height: 24px;
    border-radius: 999px;
    background: #000;
    transform: translateX(-50%);
  }
  .group {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding-bottom: 8px;
    border-bottom: 1px solid #222;
    color: #b9b6b0;
    font-size: 12px;
  }
  .dot {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #2b2b2e;
    color: #ffc2ba;
    font-size: 10px;
    font-weight: 700;
  }
  .link-card,
  .bubble {
    opacity: 0;
    transform: translateY(14px) scale(0.95);
    transition:
      opacity 300ms ease,
      transform 500ms cubic-bezier(0.2, 1.4, 0.4, 1);
  }
  .link-card.shown,
  .bubble.shown {
    opacity: 1;
    transform: none;
  }
  .link-card {
    align-self: flex-end;
    width: 82%;
    margin-top: 6px;
    overflow: hidden;
    border-radius: 16px;
    background: #1c1c1f;
  }
  .art {
    display: grid;
    place-items: center;
    height: 64px;
    background: #fff6ed;
  }
  .art :global(.brand svg) {
    height: 34px;
  }
  .link-text {
    display: grid;
    padding: 7px 10px;
    color: #9a9894;
    font-size: 10px;
  }
  .link-text strong {
    color: #f2f0ec;
    font-size: 11px;
  }
  .bubble {
    max-width: 82%;
    padding: 7px 12px;
    border-radius: 18px;
    line-height: 1.3;
  }
  .bubble b {
    display: block;
    color: #9a9894;
    font-size: 10px;
    font-weight: 400;
  }
  .bubble.out {
    align-self: flex-end;
    background: #0b6bd3;
  }
  .bubble.in {
    align-self: flex-start;
    background: #262629;
  }
  .cursor {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 5;
    color: #fff;
    filter: drop-shadow(0 0 1px #000) drop-shadow(0 3px 6px #0007);
    transition: transform 700ms cubic-bezier(0.45, 0, 0.2, 1);
  }
  .cursor :global(svg) {
    display: block;
    transform: translate(-11px, -3px);
    transition: transform 120ms ease;
  }
  .cursor.click :global(svg) {
    transform: translate(-11px, -3px) scale(0.85);
  }
  @container (max-width: 560px) {
    .columns {
      grid-template-columns: 1fr;
      grid-template-rows: auto minmax(0, 1fr);
    }
    .draft {
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }
    .text {
      font-size: 16px;
      line-height: 22px;
    }
    .photo.shown {
      max-height: 104px;
    }
    .discussion {
      gap: 8px;
      padding: 12px;
    }
    .comment {
      padding: 9px 10px;
    }
    .reply {
      display: none;
    }
    .phone {
      width: 64%;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .layer,
    .cursor,
    .phone,
    .photo {
      transition: none;
    }
    .comment.shown,
    .done.shown,
    .burst {
      animation: none;
    }
    .burst {
      display: none;
    }
  }
</style>
