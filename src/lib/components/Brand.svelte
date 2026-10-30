<script lang="ts">
  let { href = "/" }: { href?: string } = $props();
  const id = $props.id();

  // Eye centres in viewBox units. Pupils rest looking right and follow a
  // nearby mouse within their eye (rx/ry is how far a pupil may travel).
  // The first two are the bubble's eyes, the last two are the "ee" of Peek.
  const eyes = [
    { x: 430, y: -354, rx: 100, ry: 100 },
    { x: 830, y: -354, rx: 100, ry: 100 },
    { x: 4365, y: -326, rx: 76, ry: 28 },
    { x: 4896, y: -326, rx: 76, ry: 28 },
  ];
  const resting = eyes.map((eye) => ({ x: eye.rx * 0.75, y: 0 }));
  const range = 420;
  const viewBox = { x: -20, y: -784, width: 5740, height: 1104 };

  let svg = $state<SVGSVGElement>();
  let offsets = $state(resting);
  let frame = 0;

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

<a class="brand" {href} aria-label="LastPeek home"
  ><svg
    bind:this={svg}
    viewBox="{viewBox.x} {viewBox.y} {viewBox.width} {viewBox.height}"
    aria-hidden="true"
  >
    <mask id="{id}-lids">
      <rect x="4000" y="-784" width="1300" height="1104" fill="#fff" />
      <path
        d="M4268 -189L4614 -202L4614 -130L4412 -153C4381 -102 4278 -96 4268 -189ZM4799 -189L5145 -202L5145 -130L4943 -153C4912 -102 4809 -96 4799 -189Z"
      />
    </mask>
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
      <circle class="brand-eye" cx={eye.x} cy={eye.y} r="215" />
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
    <path
      class="brand-word"
      transform="translate(1481 0)"
      d="M59 0V-712H259V0ZM222 0V-170H555V0ZM794 10Q725 10 672 -23Q619 -56 589 -114Q559 -171 559 -246Q559 -321 589 -379Q619 -437 672 -470Q725 -502 794 -502Q837 -502 874 -488Q910 -473 934 -447Q959 -421 966 -387V-105Q959 -71 934 -45Q910 -19 874 -4Q837 10 794 10ZM838 -162Q875 -162 898 -186Q920 -209 920 -246Q920 -271 910 -290Q900 -308 882 -319Q863 -330 839 -330Q815 -330 796 -319Q778 -308 767 -289Q756 -270 756 -246Q756 -222 766 -203Q777 -184 796 -173Q815 -162 838 -162ZM914 0V-132L941 -252L914 -371V-492H1105V0ZM1365 15Q1319 15 1273 3Q1227 -9 1188 -30Q1148 -51 1121 -78L1224 -184Q1248 -160 1282 -146Q1315 -132 1352 -132Q1369 -132 1378 -136Q1388 -141 1388 -149Q1388 -163 1372 -170Q1355 -177 1330 -183Q1304 -189 1276 -198Q1247 -208 1221 -224Q1195 -241 1179 -270Q1163 -300 1163 -346Q1163 -393 1190 -430Q1216 -466 1264 -488Q1313 -509 1377 -509Q1442 -509 1503 -487Q1564 -465 1600 -421L1496 -315Q1471 -343 1441 -352Q1411 -362 1391 -362Q1372 -362 1364 -356Q1357 -351 1357 -343Q1357 -332 1373 -325Q1389 -318 1414 -312Q1440 -306 1468 -296Q1496 -286 1522 -268Q1547 -250 1563 -220Q1579 -191 1579 -144Q1579 -71 1521 -28Q1463 15 1365 15ZM1689 0V-694H1885V0ZM1584 -332V-492H1990V-332ZM2188 -250V-394H2317Q2340 -394 2360 -404Q2379 -413 2391 -432Q2403 -452 2403 -481Q2403 -510 2391 -530Q2379 -549 2360 -558Q2340 -568 2317 -568H2188V-712H2356Q2425 -712 2480 -684Q2536 -657 2568 -606Q2601 -554 2601 -481Q2601 -409 2568 -357Q2536 -305 2480 -278Q2425 -250 2356 -250ZM2026 0V-712H2226V0ZM3999 0 3862 -259 3998 -492H4209L4033 -229L4038 -293L4219 0ZM3682 0V-732H3878V0Z"
    />
    <g mask="url(#{id}-lids)">
      {#each eyes.slice(2) as eye, index}
        <circle class="brand-word" cx={eye.x - 30} cy="-246" r="258" />
        <circle
          class="brand-iris"
          cx={eye.x}
          cy={eye.y}
          r="80"
          style:transform="translate({offsets[index + 2].x}px, {offsets[
            index + 2
          ].y}px)"
        />
      {/each}
    </g>
  </svg></a
>
