<script lang="ts">
  import { onMount } from "svelte";
  // The LastPeek mark (same geometry as Brand.svelte), scaled up as a character
  // whose eyes follow the pointer anywhere on the page and blink now and then.
  import type { Mood } from "./WaitlistForm.svelte";
  // Moods follow the nearest waitlist form: alert, straining, then delighted.
  let {
    surprised = false,
    mood = "idle",
  }: { surprised?: boolean; mood?: Mood } = $props();
  const eyes = [
    { x: 430, y: -354 },
    { x: 830, y: -354 },
  ];
  const reach = 100;
  let svg = $state<SVGSVGElement>();
  let look = $state({ x: reach * 0.75, y: 0 }),
    blinking = $state(false);

  onMount(() => {
    const motion = matchMedia("(prefers-reduced-motion: no-preference)");
    if (!motion.matches) return;
    let frame = 0,
      blinkTimer: ReturnType<typeof setTimeout>;
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch" || frame) return;
      const { clientX, clientY } = event;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!svg) return;
        const box = svg.getBoundingClientRect();
        const dx = clientX - (box.left + box.width * 0.49);
        const dy = clientY - (box.top + box.height * 0.39);
        const distance = Math.hypot(dx, dy) || 1;
        const pull = Math.min(1, distance / 260);
        look = {
          x: (dx / distance) * reach * pull,
          y: (dy / distance) * reach * pull,
        };
      });
    };
    const blink = () => {
      blinking = true;
      setTimeout(() => (blinking = false), 200);
      blinkTimer = setTimeout(blink, 2600 + Math.random() * 3200);
    };
    blinkTimer = setTimeout(blink, 1800);
    addEventListener("pointermove", move, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(blinkTimer);
      removeEventListener("pointermove", move);
    };
  });
</script>

<svg
  bind:this={svg}
  class:blinking
  class:surprised={surprised || mood === "charging"}
  class={["mascot", mood]}
  viewBox="-20 -784 1280 1104"
  aria-hidden="true"
>
  <rect class="bubble" x="0" y="-764" width="1240" height="820" rx="300" />
  <path
    class="bubble"
    d="M190 -20L120 250L470 40Z"
    stroke-width="50"
    stroke-linejoin="round"
  />
  {#each eyes as eye}
    <g class="eye" style:transform-origin={`${eye.x}px ${eye.y}px`}>
      <circle class="white" cx={eye.x} cy={eye.y} r="215" />
    </g>
  {/each}
  {#each eyes as eye}
    <g class="eye" style:transform-origin={`${eye.x}px ${eye.y}px`}>
      <circle
        class="pupil"
        cx={eye.x}
        cy={eye.y}
        r="100"
        style:transform={`translate(${look.x}px, ${look.y}px)`}
      />
      <path
        class="happy"
        d={`M${eye.x - 120} ${eye.y + 50}Q${eye.x} ${eye.y - 170} ${eye.x + 120} ${eye.y + 50}`}
      />
    </g>
  {/each}
</svg>

<style>
  .mascot {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
  }
  .bubble {
    fill: var(--brand);
    stroke: var(--brand);
  }
  .white {
    fill: #f2f0ec;
  }
  .pupil {
    fill: #0b0b0c;
    transition: transform 180ms cubic-bezier(0.2, 0.8, 0.3, 1);
  }
  /* An animation, not a held state, so the eyes always reopen even if a timer is throttled. */
  .blinking .eye {
    animation: blink 180ms ease-in-out;
  }
  @keyframes blink {
    50% {
      transform: scaleY(0.08);
    }
  }
  .surprised .pupil {
    r: 70;
  }
  .mascot {
    transform-origin: 50% 90%;
    transition: transform 300ms cubic-bezier(0.2, 1.4, 0.4, 1);
  }
  .ready {
    transform: translateY(-4%) scale(1.04);
  }
  .charging {
    animation: strain 90ms linear infinite;
  }
  .joined {
    animation: hop 900ms cubic-bezier(0.2, 1.4, 0.4, 1);
  }
  /* Joining earns a beaming ^^ face before the eyes go back to watching. */
  .happy {
    fill: none;
    stroke: #f2f0ec;
    stroke-width: 72;
    stroke-linecap: round;
    opacity: 0;
  }
  .joined .happy {
    animation: beam 2400ms both;
  }
  .joined :is(.white, .pupil) {
    animation: unbeam 2400ms both;
  }
  @keyframes beam {
    0%,
    85% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }
  @keyframes unbeam {
    0%,
    85% {
      opacity: 0;
    }
    100% {
      opacity: 1;
    }
  }
  @keyframes strain {
    25% {
      transform: translate(-1%, -3%) rotate(-1.5deg) scale(1.05);
    }
    75% {
      transform: translate(1%, -3%) rotate(1.5deg) scale(1.05);
    }
  }
  @keyframes hop {
    35% {
      transform: translateY(-20%) rotate(-6deg) scale(1.08);
    }
    65% {
      transform: translateY(0) rotate(4deg) scale(0.98, 1.02);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .mascot {
      transition: none;
      animation: none !important;
    }
  }
</style>
