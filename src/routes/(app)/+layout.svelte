<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { page } from "$app/state";
  import { getContext, setContext, onMount } from "svelte";
  import { afterNavigate } from "$app/navigation";
  import Brand from "$lib/components/Brand.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { avatarURL } from "$lib/contracts";
  let { data, children } = $props();
  const openAdmin = getContext<() => void>("open-siteadmin");
  let shell = $state<HTMLDivElement>();
  let header = $state<HTMLElement>();
  const navigation = { reveal: () => {} };
  setContext("mobile-navigation", navigation);
  afterNavigate(() => navigation.reveal());
  onMount(() => {
    const element = shell!;
    const mobile = matchMedia("(max-width: 600px)");
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    let previous = window.scrollY;
    let offset = 0;
    let range = 1;
    let frame = 0;
    let animation = 0;
    let idle: ReturnType<typeof setTimeout>;
    let touching = false;
    function position() {
      return Math.max(
        0,
        Math.min(
          window.scrollY,
          Math.max(0, document.documentElement.scrollHeight - innerHeight),
        ),
      );
    }
    function paint(next: number) {
      offset = Math.max(0, Math.min(next, range));
      element.style.setProperty("--mobile-chrome-offset", `${offset}px`);
      element.style.setProperty(
        "--mobile-chrome-progress",
        `${offset / range}`,
      );
    }
    function reveal() {
      cancelAnimationFrame(animation);
      clearTimeout(idle);
      range = Math.max(
        1,
        header!.offsetHeight +
          (element.querySelector<HTMLElement>(".feed-toolbar")?.offsetHeight ||
            0),
      );
      previous = position();
      paint(0);
    }
    navigation.reveal = reveal;
    function settle() {
      if (touching || frame || offset === 0 || offset === range) return;
      const from = offset;
      const target = offset > range / 2 ? range : 0;
      const start = performance.now();
      if (reducedMotion.matches) return paint(target);
      function animate(now: number) {
        const progress = Math.min(1, (now - start) / 160);
        paint(from + (target - from) * (1 - (1 - progress) ** 3));
        if (progress < 1) animation = requestAnimationFrame(animate);
      }
      animation = requestAnimationFrame(animate);
    }
    function update() {
      frame = 0;
      const y = position();
      const delta = y - previous;
      previous = y;
      const interacting =
        document.activeElement?.closest(
          'input,textarea,[contenteditable="true"],[data-state="open"]',
        ) && document.activeElement !== document.body;
      paint(
        y === 0 || interacting || document.querySelector("dialog[open]")
          ? 0
          : offset + delta,
      );
    }
    function scroll() {
      if (!mobile.matches) return;
      cancelAnimationFrame(animation);
      clearTimeout(idle);
      if (!frame) frame = requestAnimationFrame(update);
      idle = setTimeout(settle, 120);
    }
    function touchStart() {
      touching = true;
      cancelAnimationFrame(animation);
      clearTimeout(idle);
    }
    function touchEnd() {
      touching = false;
      clearTimeout(idle);
      idle = setTimeout(settle, 120);
    }
    reveal();
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("touchstart", touchStart, { passive: true });
    window.addEventListener("touchend", touchEnd, { passive: true });
    window.addEventListener("touchcancel", touchEnd, { passive: true });
    mobile.addEventListener("change", reveal);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(animation);
      clearTimeout(idle);
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("touchstart", touchStart);
      window.removeEventListener("touchend", touchEnd);
      window.removeEventListener("touchcancel", touchEnd);
      mobile.removeEventListener("change", reveal);
    };
  });
</script>

<div class="app-shell" bind:this={shell}>
  <header
    bind:this={header}
    class="mobile-header"
    onfocusin={() => navigation.reveal()}
  >
    {@render account()}
    <Brand
      markOnly
      onlongpress={data.canViewAdmin ? openAdmin : undefined}
      onactivate={() => {
        navigation.reveal();
        window.scrollTo({
          top: 0,
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
        });
      }}
    />
  </header>
  <nav
    class="app-navigation"
    aria-label="Main navigation"
    onfocusin={() => navigation.reveal()}
  >
    <Brand markOnly />
    <Button
      variant="ghost"
      class="icon-button drafts-link"
      href="/"
      aria-current={page.url.pathname === "/" ? "page" : undefined}
      aria-label="Drafts"
      title="Drafts"
      ><Icon
        name="drafts"
        size={30}
        weight={page.url.pathname === "/" ? "fill" : "regular"}
      /></Button
    >
    <Button
      variant="ghost"
      class="icon-button drafts-link"
      href="/feedback"
      aria-current={page.url.pathname === "/feedback" ? "page" : undefined}
      aria-label="Feedback"
      title="Feedback"
      ><Icon
        name="comment"
        size={30}
        weight={page.url.pathname === "/feedback" ? "fill" : "regular"}
      /></Button
    >
    <div class="desktop-account">{@render account()}</div>
  </nav>
  {#key page.url.pathname}{@render children()}{/key}
</div>

{#snippet account()}
  <Button
    variant="ghost"
    class="icon-button account-link"
    href="/settings"
    aria-current={page.url.pathname === "/settings" ? "page" : undefined}
    aria-label="Account settings"
    title="Account settings"
    ><span class="avatar" aria-hidden="true"
      >{#if data.user.avatar_id}<img
          src={avatarURL(data.user.avatar_id)}
          alt=""
        />{:else}{data.user.name.slice(0, 1).toUpperCase()}{/if}</span
    ></Button
  >
{/snippet}
