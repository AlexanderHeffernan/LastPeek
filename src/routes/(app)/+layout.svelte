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
  const navigation = $state({ hidden: false });
  setContext("mobile-navigation", navigation);
  let previous = 0;
  let travel = 0;
  afterNavigate(() => {
    navigation.hidden = false;
    previous = window.scrollY;
    travel = 0;
  });
  onMount(() => {
    function scroll() {
      const y = Math.max(
        0,
        Math.min(
          window.scrollY,
          document.documentElement.scrollHeight - innerHeight,
        ),
      );
      const delta = y - previous;
      previous = y;
      if (Math.sign(delta) !== Math.sign(travel)) travel = 0;
      travel += delta;
      if (y < 12 || travel < -8) navigation.hidden = false;
      else if (
        y > 100 &&
        travel > 16 &&
        !document.activeElement?.closest(
          'input,textarea,[contenteditable="true"]',
        ) &&
        !document.querySelector('[data-state="open"], dialog[open]')
      )
        navigation.hidden = true;
    }
    window.addEventListener("scroll", scroll, { passive: true });
    return () => window.removeEventListener("scroll", scroll);
  });
</script>

<header
  class="mobile-header"
  class:chrome-hidden={navigation.hidden}
  onfocusin={() => (navigation.hidden = false)}
>
  {@render account()}
  <Brand
    markOnly
    onlongpress={data.canViewAdmin ? openAdmin : undefined}
    onactivate={() => {
      navigation.hidden = false;
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
  class:chrome-hidden={navigation.hidden}
  aria-label="Main navigation"
  onfocusin={() => (navigation.hidden = false)}
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
