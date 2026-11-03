<script lang="ts">
  import { onDestroy } from "svelte";
  let {
    href = "/",
    markOnly = false,
    decorative = false,
    onactivate,
    onlongpress,
  }: {
    href?: string;
    markOnly?: boolean;
    decorative?: boolean;
    onactivate?: () => void;
    onlongpress?: () => void;
  } = $props();
  // Eye centres in viewBox units. Pupils rest looking right and follow a
  // nearby mouse within their eye (rx/ry is how far a pupil may travel).
  const eyes = [
    { x: 430, y: -354, rx: 100, ry: 100 },
    { x: 830, y: -354, rx: 100, ry: 100 },
  ];
  const resting = eyes.map((eye) => ({ x: eye.rx * 0.75, y: 0 }));
  const range = 420;
  const viewBox = $derived({
    x: -20,
    y: -784,
    width: markOnly ? 1280 : 5740,
    height: 1104,
  });

  let svg = $state<SVGSVGElement>();
  let offsets = $state(resting);
  let reacting = $state(false);
  let frame = 0;
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let pressOrigin = { x: 0, y: 0 };
  let longPressed = false;

  function cancelPress() {
    clearTimeout(pressTimer);
  }
  function startPress(event: PointerEvent) {
    if (!onlongpress || !event.isPrimary || event.button !== 0) return;
    cancelPress();
    longPressed = false;
    pressOrigin = { x: event.clientX, y: event.clientY };
    pressTimer = setTimeout(() => {
      longPressed = true;
      onlongpress?.();
    }, 600);
  }
  onDestroy(cancelPress);

  function react(event: PointerEvent | MouseEvent) {
    if (
      markOnly &&
      (event.type === "click" ||
        ("pointerType" in event &&
          event.pointerType !== "touch" &&
          matchMedia("(hover: hover) and (pointer: fine)").matches)) &&
      matchMedia("(prefers-reduced-motion: no-preference)").matches
    )
      reacting = true;
  }

  function finishReaction(event: AnimationEvent) {
    if (event.animationName === "mascot-double-take-eyes") reacting = false;
  }

  $effect(() => {
    const element = svg;
    if (!element) return;
    element.addEventListener("animationcancel", finishReaction);
    return () => element.removeEventListener("animationcancel", finishReaction);
  });

  function look(event: PointerEvent) {
    if (event.pointerType === "touch" || !svg || frame) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const { clientX, clientY } = event;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!svg) return;
      const box = svg.getBoundingClientRect();
      const scale = box.width / viewBox.width;
      offsets = eyes.map((eye, index) => {
        const dx = clientX - (box.left + (eye.x - viewBox.x) * scale);
        const dy = clientY - (box.top + (eye.y - viewBox.y) * scale);
        const distance = Math.hypot(dx, dy);
        if (distance > range || distance === 0) return resting[index];
        const reach = Math.min(1, distance / 80);
        return {
          x: (dx / distance) * eye.rx * reach,
          y: (dy / distance) * eye.ry * reach,
        };
      });
    });
  }

  function rest(event: MouseEvent) {
    if (!event.relatedTarget) offsets = resting;
  }
</script>

<svelte:window onpointermove={look} onmouseout={rest} />

<svelte:element
  this={decorative ? "span" : onactivate ? "button" : "a"}
  type={onactivate ? "button" : undefined}
  class="brand"
  class:brand-mark={markOnly && !decorative}
  class:brand-mascot={markOnly}
  class:reacting
  href={decorative || onactivate ? undefined : href}
  aria-label={decorative
    ? undefined
    : onactivate
      ? "Back to top"
      : "LastPeek home"}
  aria-hidden={decorative ? true : undefined}
  onpointerenter={react}
  onpointerdown={startPress}
  onpointerup={cancelPress}
  onpointercancel={cancelPress}
  onpointerleave={cancelPress}
  onpointermove={(event: PointerEvent) => {
    if (
      Math.hypot(event.clientX - pressOrigin.x, event.clientY - pressOrigin.y) >
      10
    )
      cancelPress();
  }}
  oncontextmenu={(event: MouseEvent) => {
    if (onlongpress) event.preventDefault();
  }}
  onclick={(event: MouseEvent) => {
    if (longPressed) {
      longPressed = false;
      event.preventDefault();
      return;
    }
    if (onactivate) {
      react(event);
      onactivate();
    }
  }}
  onanimationend={finishReaction}
  ><svg
    bind:this={svg}
    viewBox="{viewBox.x} {viewBox.y} {viewBox.width} {viewBox.height}"
    aria-hidden="true"
  >
    <rect
      class="brand-bubble"
      x="0"
      y="-764"
      width="1240"
      height="820"
      rx="300"
    />
    <path
      class="brand-bubble"
      d="M190 -20L120 250L470 40Z"
      stroke-width="50"
      stroke-linejoin="round"
    />
    {#each eyes.slice(0, 2) as eye}
      <ellipse class="brand-eye" cx={eye.x} cy={eye.y} rx="215" ry="215" />
    {/each}
    {#each eyes.slice(0, 2) as eye, index}
      <circle
        class="brand-pupil"
        cx={eye.x}
        cy={eye.y}
        r="100"
        style:transform="translate({offsets[index].x}px, {offsets[index].y}px)"
      />
    {/each}
    {#if !markOnly}<path
        class="brand-word"
        transform="translate(1481 0)"
        d="M59 0V-712H259V0ZM222 0V-170H555V0ZM794 10Q725 10 672 -23Q619 -56 589 -114Q559 -171 559 -246Q559 -321 589 -379Q619 -437 672 -470Q725 -502 794 -502Q837 -502 874 -488Q910 -473 934 -447Q959 -421 966 -387V-105Q959 -71 934 -45Q910 -19 874 -4Q837 10 794 10ZM838 -162Q875 -162 898 -186Q920 -209 920 -246Q920 -271 910 -290Q900 -308 882 -319Q863 -330 839 -330Q815 -330 796 -319Q778 -308 767 -289Q756 -270 756 -246Q756 -222 766 -203Q777 -184 796 -173Q815 -162 838 -162ZM914 0V-132L941 -252L914 -371V-492H1105V0ZM1365 15Q1319 15 1273 3Q1227 -9 1188 -30Q1148 -51 1121 -78L1224 -184Q1248 -160 1282 -146Q1315 -132 1352 -132Q1369 -132 1378 -136Q1388 -141 1388 -149Q1388 -163 1372 -170Q1355 -177 1330 -183Q1304 -189 1276 -198Q1247 -208 1221 -224Q1195 -241 1179 -270Q1163 -300 1163 -346Q1163 -393 1190 -430Q1216 -466 1264 -488Q1313 -509 1377 -509Q1442 -509 1503 -487Q1564 -465 1600 -421L1496 -315Q1471 -343 1441 -352Q1411 -362 1391 -362Q1372 -362 1364 -356Q1357 -351 1357 -343Q1357 -332 1373 -325Q1389 -318 1414 -312Q1440 -306 1468 -296Q1496 -286 1522 -268Q1547 -250 1563 -220Q1579 -191 1579 -144Q1579 -71 1521 -28Q1463 15 1365 15ZM1689 0V-694H1885V0ZM1584 -332V-492H1990V-332ZM2188 -250V-394H2317Q2340 -394 2360 -404Q2379 -413 2391 -432Q2403 -452 2403 -481Q2403 -510 2391 -530Q2379 -549 2360 -558Q2340 -568 2317 -568H2188V-712H2356Q2425 -712 2480 -684Q2536 -657 2568 -606Q2601 -554 2601 -481Q2601 -409 2568 -357Q2536 -305 2480 -278Q2425 -250 2356 -250ZM2026 0V-712H2226V0ZM3999 0 3862 -259 3998 -492H4209L4033 -229L4038 -293L4219 0ZM3682 0V-732H3878V0Z"
      />
      <path
        class="brand-word"
        transform="translate(1481 0)"
        d="M2876 12Q2790 12 2725 -20Q2660 -53 2624 -112Q2587 -170 2587 -246Q2587 -321 2622 -379Q2658 -437 2720 -470Q2782 -504 2860 -504Q2937 -504 2996 -472Q3055 -441 3088 -385Q3122 -329 3122 -257Q3122 -242 3120 -226Q3119 -209 3114 -187L2670 -184V-304L3041 -307L2950 -254Q2950 -294 2940 -320Q2931 -345 2912 -358Q2893 -371 2864 -371Q2834 -371 2812 -356Q2790 -341 2778 -313Q2767 -285 2767 -245Q2767 -204 2780 -176Q2792 -149 2816 -135Q2840 -121 2876 -121Q2911 -121 2938 -132Q2964 -144 2986 -169L3084 -72Q3047 -30 2995 -9Q2943 12 2876 12ZM3407 12Q3321 12 3256 -20Q3191 -53 3154 -112Q3118 -170 3118 -246Q3118 -321 3154 -379Q3189 -437 3251 -470Q3313 -504 3391 -504Q3468 -504 3527 -472Q3586 -441 3620 -385Q3653 -329 3653 -257Q3653 -242 3652 -226Q3650 -209 3645 -187L3201 -184V-304L3572 -307L3481 -254Q3481 -294 3472 -320Q3462 -345 3443 -358Q3424 -371 3395 -371Q3365 -371 3343 -356Q3321 -341 3310 -313Q3298 -285 3298 -245Q3298 -204 3310 -176Q3323 -149 3347 -135Q3371 -121 3407 -121Q3442 -121 3468 -132Q3495 -144 3517 -169L3615 -72Q3578 -30 3526 -9Q3474 12 3407 12Z"
      />{/if}
  </svg></svelte:element
>
