<script lang="ts">
  import { onMount } from "svelte";
  import AppMock, { POST, THREAD, type Scene } from "./AppMock.svelte";
  import Mascot from "./Mascot.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import type { Mood } from "./WaitlistForm.svelte";

  let { mood = "idle" }: { mood?: Mood } = $props();

  let comments = $state(2),
    tilt = $state({ x: 0, y: 0 }),
    scene = $state<HTMLElement>();
  const view = $derived<Scene>({
    typed: POST.length,
    thread: THREAD.length,
    shared: true,
    chat: 0,
    comments,
    fixed: false,
    photo: false,
    charge: 0,
    posted: false,
    cursor: "none",
    camera: "wide",
  });

  onMount(() => {
    if (!matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
    comments = 0;
    const timers = [
      setTimeout(() => (comments = 1), 900),
      setTimeout(() => (comments = 2), 1900),
    ];
    let frame = 0;
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch" || frame) return;
      const { clientX, clientY } = event;
      frame = requestAnimationFrame(() => {
        frame = 0;
        tilt = {
          x: (clientX / innerWidth - 0.5) * 2,
          y: (clientY / innerHeight - 0.5) * 2,
        };
      });
    };
    addEventListener("pointermove", move, { passive: true });
    return () => {
      timers.forEach(clearTimeout);
      cancelAnimationFrame(frame);
      removeEventListener("pointermove", move);
    };
  });
</script>

<div class="scene" bind:this={scene} style:--tx={tilt.x} style:--ty={tilt.y}>
  <div class="rig">
    <div class="peek"><div class="peek-in"><Mascot {mood} /></div></div>
    <div class="window">
      <AppMock
        scene={view}
        label="A LastPeek draft with feedback from two friends: one points out the typo “tomorow”, the other suggests adding a photo."
      />
    </div>
    <span class="chip chip-a" aria-hidden="true"
      ><span class="mini guest"><Icon name="guest" size={16} /></span>Jamie
      joined as a guest · no sign-up</span
    >
  </div>
</div>

<style>
  .scene {
    --tx: 0;
    --ty: 0;
    position: relative;
    perspective: 1600px;
    padding-top: clamp(64px, 9vw, 120px);
  }
  .rig {
    position: relative;
    transform-style: preserve-3d;
    transform: rotateX(calc(8deg - var(--ty) * 4deg))
      rotateY(calc(-14deg + var(--tx) * 6deg)) rotateZ(1deg);
    transition: transform 600ms cubic-bezier(0.2, 0.8, 0.3, 1);
    animation: settle-in 1400ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  @keyframes settle-in {
    from {
      opacity: 0;
      transform: rotateX(24deg) rotateY(-30deg) translateY(60px) scale(0.92);
    }
  }
  /* A flat slot that ends at the window's top edge, so the mascot rises from
     behind it. No depth transform: Safari re-composites 3D layers when an
     animation finishes, which made the mascot jump into place. */
  .peek {
    position: absolute;
    bottom: 100%;
    right: 12%;
    width: clamp(120px, 15vw, 190px);
    aspect-ratio: 1280 / 680;
    clip-path: inset(-200% -60% 0 -60%);
  }
  .peek-in {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    rotate: 6deg;
    animation: peek 900ms 700ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  @keyframes peek {
    from {
      translate: 0 110%;
    }
  }
  .window {
    position: relative;
    height: clamp(380px, 34vw, 460px);
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    background: light-dark(#fffdf9, var(--background));
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--foreground) 7%, transparent),
      0 80px 120px -60px var(--shadow),
      40px 60px 100px -50px color-mix(in srgb, var(--brand) 45%, transparent);
  }
  .chip {
    position: absolute;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: color-mix(in srgb, var(--card) 88%, transparent);
    backdrop-filter: blur(12px);
    box-shadow: 0 20px 40px -20px var(--shadow);
    font-size: 14px;
    font-weight: 700;
    white-space: nowrap;
    animation: float 6s ease-in-out infinite;
  }
  .chip-a {
    bottom: -22px;
    right: -6%;
    transform: translateZ(90px);
  }
  .mini.guest {
    background: var(--secondary);
    color: var(--muted-foreground);
  }
  .mini {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--avatar-background);
    color: var(--avatar-foreground);
    font-size: 12px;
  }
  @keyframes float {
    50% {
      translate: 0 -10px;
    }
  }
  @media (max-width: 1000px) {
    .rig {
      transform: rotateX(6deg) rotateY(-6deg);
    }
    .chip-a {
      bottom: -18px;
      right: -2%;
    }
  }
  @media (max-width: 600px) {
    .window {
      height: 500px;
    }
    .chip {
      display: none;
    }
    .chip {
      font-size: 13px;
      padding: 8px 12px;
    }
    .rig {
      transform: rotateX(4deg) rotateY(-3deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .rig,
    .peek-in,
    .chip {
      animation: none;
      transition: none;
    }
  }
</style>
