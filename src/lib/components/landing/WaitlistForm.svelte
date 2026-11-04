<script lang="ts" module>
  export type Mood = "idle" | "ready" | "charging" | "joined";
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import Icon from "$lib/components/Icon.svelte";
  import { HoldSound } from "$lib/hold-sound";

  let {
    id,
    joined = $bindable(""),
    mood = $bindable("idle"),
  }: { id: string; joined?: string; mood?: Mood } = $props();
  let email = $state(""),
    busy = $state(false),
    error = $state(""),
    charge = $state(0),
    holding = $state(false),
    early = $state(false),
    // Set the moment the server accepts the hold, before the card replaces the form.
    launched = $state(false),
    nudged = $state(false),
    input = $state<HTMLInputElement | null>(null);
  // Joining is a one-second hold, the same gesture as posting in the app.
  const sound = new HoldSound();
  // Sparks fly out from behind the button; sideways ones travel further to clear it.
  const sparks = Array.from({ length: 16 }, (_, index) => {
    const angle = index * 22.5 + (index % 2) * 8;
    return {
      angle,
      reach: Math.round(
        36 +
          96 * Math.abs(Math.cos((angle * Math.PI) / 180)) +
          (index % 3) * 10,
      ),
      hue: ["#ffd889", "#ff9270", "#ff87bf", "#fff0bb"][index % 4],
    };
  });
  const valid = $derived(
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && email.length <= 254,
  );
  $effect(() => {
    mood =
      joined || launched
        ? "joined"
        : holding || busy
          ? "charging"
          : valid
            ? "ready"
            : "idle";
  });
  let frame = 0,
    started = 0,
    step = 0,
    pointer: number | null = null,
    earlyTimer: ReturnType<typeof setTimeout> | undefined,
    revealTimer: ReturnType<typeof setTimeout> | undefined;

  function begin() {
    if (holding || busy || launched) return;
    // Until the address looks right, the button just points back at the field.
    if (!valid) {
      if (email.trim()) error = "That email address doesn’t look right.";
      nudged = false;
      requestAnimationFrame(() => (nudged = true));
      // After the press, so the button doesn't take focus back.
      setTimeout(() => input?.focus());
      return;
    }
    holding = true;
    early = false;
    started = performance.now();
    step = 0;
    sound.start();
    const tick = (now: number) => {
      if (!holding) return;
      charge = Math.min((now - started) / 1000, 1);
      const next = Math.floor(charge * charge * 9);
      if (next > step) sound.detent((step = next));
      if (charge < 1) {
        frame = requestAnimationFrame(tick);
        return;
      }
      stop();
      void join();
    };
    frame = requestAnimationFrame(tick);
  }
  function stop() {
    cancelAnimationFrame(frame);
    holding = false;
    pointer = null;
    sound.stop();
  }
  // Letting go too soon is the most common first try; the button says why.
  function release() {
    if (!holding) return;
    stop();
    charge = 0;
    early = true;
    clearTimeout(earlyTimer);
    earlyTimer = setTimeout(() => (early = false), 2000);
  }

  async function join() {
    if (busy || launched) return;
    if (!valid) {
      error = email.trim()
        ? "That email address doesn’t look right."
        : "Enter your email address.";
      input?.focus();
      return;
    }
    busy = true;
    error = "";
    try {
      const response = await fetch("/api/account-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!response.ok)
        throw new Error(
          response.status === 429
            ? "Too many tries. Give it a few minutes."
            : ((await response.json().catch(() => null))?.message ??
                "Couldn’t join the waitlist. Try again."),
        );
      const address = email.trim().toLowerCase();
      // Let the burst play on the button before the confirmation takes its place.
      sound.celebrate();
      launched = true;
      revealTimer = setTimeout(
        () => (joined = address),
        matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1400,
      );
    } catch (cause) {
      error =
        cause instanceof TypeError
          ? "Couldn’t reach LastPeek. Check your connection."
          : (cause as Error).message;
    } finally {
      busy = false;
      if (!launched) charge = 0;
    }
  }
  onMount(() => () => {
    stop();
    clearTimeout(earlyTimer);
    clearTimeout(revealTimer);
    sound.close();
  });
</script>

{#if joined}
  <!-- The form that joined hands focus to its confirmation, so it is announced. -->
  <p
    class="joined"
    role="status"
    tabindex="-1"
    {@attach (node) => {
      if (launched) node.focus();
    }}
  >
    <span class="tick"><Icon name="check" size={16} /></span>
    <span
      >You’re on the list! We’ll email <strong>{joined}</strong> when your
      invite is ready. Until then,
      <a
        href="https://x.com/AlexH2035"
        target="_blank"
        rel="noopener noreferrer">say hi on X</a
      >.</span
    >
  </p>
{:else}
  <p class="form-title" id={`${id}-title`}>Join the waitlist</p>
  <form
    class="waitlist"
    aria-labelledby={`${id}-title`}
    class:ready={valid}
    class:launched
    class:nudged
    onanimationend={() => (nudged = false)}
    novalidate
    onsubmit={(event) => {
      event.preventDefault();
      void join();
    }}
  >
    <label class="sr-only" for={id}>Email address</label>
    <Input
      {id}
      bind:ref={input}
      type="email"
      name="email"
      autocomplete="email"
      placeholder="you@example.com"
      required
      maxlength={254}
      bind:value={email}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : `${id}-note`}
      oninput={() => (error = "")}
      onblur={() => {
        if (email.trim() && !valid)
          error = "That email address doesn’t look right.";
      }}
    />
    <Button
      type="button"
      class={["join", holding && "holding", busy && "busy"]}
      style={`--charge:${charge}`}
      aria-disabled={!valid || busy || launched ? "true" : undefined}
      aria-describedby={`${id}-note`}
      onpointerdown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        pointer = event.pointerId;
        begin();
      }}
      onpointerup={(event) => {
        if (event.pointerId === pointer) release();
      }}
      onpointerleave={() => holding && release()}
      onpointercancel={() => holding && release()}
      onblur={release}
      onclick={(event) => {
        // Assistive technology activates buttons without a pointer or held key.
        if (event.detail === 0 && !holding) void join();
      }}
      onkeydown={(event) => {
        if ((event.key === " " || event.key === "Enter") && !event.repeat) {
          event.preventDefault();
          begin();
        }
      }}
      onkeyup={(event) => {
        if (event.key === " " || event.key === "Enter") release();
      }}
      oncontextmenu={(event) => event.preventDefault()}
    >
      <span class="charge" aria-hidden="true"></span>
      <span class="sheen" aria-hidden="true"></span>
      {#if launched}<span class="burst" aria-hidden="true"
          >{#each sparks as spark}<i
              style:--angle={`${spark.angle}deg`}
              style:--reach={`${spark.reach}px`}
              style:--hue={spark.hue}
            ></i>{/each}</span
        >{/if}
      <span class="label"
        >{#if launched}You’re in!<Icon
            name="check"
            size={16}
            weight="bold"
          />{:else if busy}Joining…{:else if early}Keep holding…{:else if valid}Hold
          to join<Icon name="arrow" size={16} />{:else}Join waitlist{/if}</span
      >
    </Button>
  </form>
  {#if error}<p class="error" id={`${id}-error`} role="alert">{error}</p>
  {:else}<p class="note" id={`${id}-note`} aria-live="polite">
      {valid
        ? "Hold the button for a second, or press Enter."
        : "We’ll email your invite when a spot opens. Free to use, with Pro included in some invites."}
    </p>{/if}
{/if}

<style>
  .form-title {
    margin: 0 0 10px;
    color: var(--foreground);
    font-size: 16px;
    font-weight: 600;
  }
  .waitlist {
    display: flex;
    gap: 8px;
    width: 100%;
    max-width: 480px;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--card);
    box-shadow: 0 10px 30px -18px var(--shadow);
    transition:
      border-color 160ms ease,
      box-shadow 160ms ease;
  }
  .waitlist:has(:global(input:focus-visible)) {
    border-color: var(--ring);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--ring) 50%, transparent);
  }
  .waitlist :global(input) {
    flex: 1;
    min-width: 0;
    height: 44px;
    border: 0;
    background: transparent;
    box-shadow: none;
    font-size: 16px;
  }
  .waitlist :global(input:focus-visible) {
    box-shadow: none;
    outline: none;
    --tw-ring-shadow: 0 0 #0000;
  }
  .waitlist :global(.join) {
    position: relative;
    isolation: isolate;
    overflow: visible;
    height: 44px;
    min-width: 168px;
    padding-inline: 18px;
    border-radius: 11px;
    font-weight: 700;
    white-space: nowrap;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    transform: scale(calc(1 - var(--charge) * 0.05));
    transition:
      transform 180ms cubic-bezier(0.2, 1.7, 0.4, 1),
      box-shadow 200ms ease,
      background-color 200ms ease,
      color 200ms ease;
  }
  /* Asleep until there is an address to join with. */
  .waitlist:not(.ready) :global(.join) {
    background: var(--secondary);
    color: var(--muted-foreground);
    box-shadow: none;
  }
  .waitlist :global(.join.busy) {
    --charge: 1 !important;
  }
  .waitlist.launched :global(.join) {
    animation: launched 600ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  @keyframes launched {
    0% {
      transform: scale(0.94);
    }
    35% {
      transform: scale(1.07);
    }
  }
  /* A valid email wakes the button up. */
  .waitlist.ready :global(.join) {
    animation: wake 520ms cubic-bezier(0.2, 1.6, 0.4, 1);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--brand) 22%, transparent);
  }
  .waitlist :global(.join.holding) {
    box-shadow:
      0 0 calc(var(--charge) * 30px)
        rgb(255 91 124 / calc(var(--charge) * 0.55)),
      0 0 calc(var(--charge) * 60px) rgb(255 184 85 / calc(var(--charge) * 0.3));
  }
  .charge {
    position: absolute;
    inset: 0;
    z-index: -1;
    background: linear-gradient(
      110deg,
      #ff87bf 0%,
      #ff9270 42%,
      #ffd479 75%,
      #fff0bb 100%
    );
    border-radius: inherit;
    clip-path: inset(0 calc((1 - var(--charge)) * 100%) 0 0 round 11px);
    pointer-events: none;
  }
  .sheen {
    position: absolute;
    inset: 0;
    z-index: -1;
    overflow: hidden;
    border-radius: inherit;
    opacity: var(--charge);
    pointer-events: none;
  }
  .sheen::after {
    content: "";
    position: absolute;
    inset: -50% -30%;
    background: linear-gradient(
      110deg,
      transparent 38%,
      #fff8 48%,
      transparent 58%
    );
    transform: translateX(calc(-85% + var(--charge) * 170%));
  }
  /* Behind the charged face, so sparks appear to burst out from under it. */
  .burst {
    position: absolute;
    inset: 50%;
    z-index: -2;
    pointer-events: none;
  }
  .burst i {
    position: absolute;
    width: 7px;
    height: 4px;
    border-radius: 3px;
    background: var(--hue);
    box-shadow: 0 0 6px #ffad80;
    animation: spark 900ms cubic-bezier(0.1, 0.6, 0.3, 1) both;
  }
  @keyframes spark {
    from {
      opacity: 1;
      transform: rotate(var(--angle)) translateX(16px) scaleX(1.8);
    }
    to {
      opacity: 0;
      transform: rotate(var(--angle)) translateX(var(--reach)) scaleX(0.3);
    }
  }
  .label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  @keyframes wake {
    40% {
      transform: scale(1.06);
    }
  }
  .note,
  .error {
    max-width: 480px;
    margin: 10px 0 0;
    font-size: 14px;
    text-wrap: pretty;
  }
  .note {
    color: var(--muted-foreground);
    text-wrap: balance;
  }
  .error {
    color: var(--destructive);
  }
  .joined:focus {
    outline: none;
  }
  .joined:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 3px;
  }
  .waitlist.nudged {
    animation: nudge 360ms ease;
  }
  @keyframes nudge {
    25% {
      transform: translateX(-6px);
    }
    50% {
      transform: translateX(5px);
    }
    75% {
      transform: translateX(-3px);
    }
  }
  .joined {
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 480px;
    margin: 0;
    padding: 14px 16px;
    border: 1px solid color-mix(in srgb, var(--brand) 40%, var(--border));
    border-radius: 16px;
    background: color-mix(in srgb, var(--brand) 8%, var(--card));
    line-height: 1.4;
    text-align: left;
    animation: celebrate 650ms cubic-bezier(0.2, 1.4, 0.4, 1);
    overflow-wrap: anywhere;
  }
  .joined a {
    color: var(--primary);
    font-weight: 700;
  }
  .tick {
    display: grid;
    flex: none;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--primary-fill);
    color: var(--primary-foreground);
  }
  @keyframes celebrate {
    from {
      opacity: 0;
      transform: scale(0.9) translateY(8px);
    }
  }
  @media (max-width: 420px) {
    .waitlist {
      flex-direction: column;
    }
    .waitlist :global(.join) {
      width: 100%;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .waitlist :global(.join),
    .waitlist.ready :global(.join),
    .waitlist.launched :global(.join),
    .joined {
      transform: none;
      animation: none;
    }
    .sheen,
    .burst {
      display: none;
    }
  }
</style>
