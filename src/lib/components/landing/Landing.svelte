<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { pushState, replaceState } from "$app/navigation";
  import { Button } from "$lib/components/ui/button/index.js";
  import Brand from "$lib/components/Brand.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import HeroScene from "./HeroScene.svelte";
  import FilmPlayer from "./FilmPlayer.svelte";
  import AuthDialog, { type Auth } from "./AuthDialog.svelte";
  import WaitlistForm, { type Mood } from "./WaitlistForm.svelte";
  import Mascot from "./Mascot.svelte";
  import { reveal } from "./reveal";

  let {
    returning = false,
    xEnabled = false,
    devSignIn = false,
    auth,
    form,
  }: {
    returning?: boolean;
    xEnabled?: boolean;
    devSignIn?: boolean;
    auth?: Auth;
    form?: { message?: string; email?: string } | null;
  } = $props();
  let joined = $state(""),
    scrolled = $state(false),
    time = $state(0),
    film = $state<FilmPlayer>(),
    heroMood = $state<Mood>("idle"),
    closingMood = $state<Mood>("idle"),
    // /login and invitation links open their dialog over the page.
    // svelte-ignore state_referenced_locally
    authOpen = $state(auth !== undefined),
    pushed = false;
  const authView = $derived<Auth>(auth ?? { kind: "signin" });

  const title = "LastPeek: get feedback on your X posts before you post";
  const description =
    "Draft posts and threads exactly as they’ll look on X, send friends one link, and get their feedback before you post. Join the waitlist.";
  const origin = $derived(page.url.origin);
  const chapters = [
    {
      at: 12,
      title: "Write it",
      short: "Write",
      body: "Posts, threads, photos and video, exactly as X will show them.",
    },
    {
      at: 15.5,
      title: "Share it",
      short: "Share",
      body: "Drop a link in the group chat. Friends highlight words and leave notes, no account needed.",
    },
    {
      at: 30,
      title: "Fix it",
      short: "Fix",
      body: "Typo gone, photo added. Same link, latest version.",
    },
    {
      at: 36,
      title: "Post it",
      short: "Post",
      body: "Copy it to X yourself, or let Pro post it for you.",
    },
  ];
  const chapter = $derived(
    Math.max(
      0,
      chapters.findLastIndex(({ at }) => time >= at),
    ),
  );
  const headline = ["Take", "one", "last", "peek", "before", "you", "post."];

  const faqs = [
    {
      q: "Do my friends need an account?",
      a: "No. They open your link and comment with just a name. For something private, share with chosen friends only.",
    },
    {
      q: "Is it free?",
      a: "Yes. The whole feedback workflow is free, with 10 saved drafts. Pro adds posting directly to X, X replies, quotes and @mention search, and optional private AI review.",
    },
    {
      q: "Who can see my drafts?",
      a: "Only you, until you share. Use an unlisted link, or invite chosen friends so a forwarded link won’t work.",
    },
    {
      q: "Does it work on my phone?",
      a: "Yes. Add it to your Home Screen and it works like an app, with notifications when feedback arrives.",
    },
  ];

  const structuredData = $derived(
    JSON.stringify([
      {
        "@context": "https://schema.org",
        "@type": "WebApplication",
        name: "LastPeek",
        url: `${origin}/`,
        description,
        applicationCategory: "SocialNetworkingApplication",
        operatingSystem: "Web, iOS, Android",
        image: `${origin}/landing/og.png`,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        author: {
          "@type": "Person",
          name: "Alexander Heffernan",
          url: "https://x.com/AlexH2035",
        },
      },
      {
        "@context": "https://schema.org",
        "@type": "VideoObject",
        name: "LastPeek: take one last peek before you post",
        description:
          "A friend catches the typo and suggests a photo before the post goes out. See LastPeek in under a minute.",
        thumbnailUrl: `${origin}/landing/film-poster.jpg`,
        contentUrl: `${origin}/landing/lastpeek-film.mp4`,
        uploadDate: "2026-11-04",
        duration: "PT47S",
      },
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqs.map(({ q, a }) => ({
          "@type": "Question",
          name: q,
          acceptedAnswer: { "@type": "Answer", text: a },
        })),
      },
    ]).replace(/</g, "\\u003c"),
  );

  onMount(() => {
    // An installed app opened while signed out goes straight to sign-in.
    if (!auth && matchMedia("(display-mode: standalone)").matches) {
      replaceState("/login", {});
      authOpen = true;
    }
  });

  // Sign in opens over the page; its address is /login so Back closes it.
  function openSignIn(event: MouseEvent) {
    event.preventDefault();
    if (auth?.kind !== "join" && page.url.pathname !== "/login") {
      pushState("/login", { signIn: true });
      pushed = true;
    }
    authOpen = true;
  }
  function closeAuth() {
    authOpen = false;
    if (pushed && page.state.signIn) history.back();
    else if (page.url.pathname !== "/") replaceState("/", {});
    pushed = false;
  }
  $effect(() => {
    if (pushed && !page.state.signIn) {
      pushed = false;
      authOpen = false;
    }
  });
  function focusWaitlist() {
    closeAuth();
    const input = document.getElementById("hero-email");
    input?.scrollIntoView({ behavior: "smooth", block: "center" });
    input?.focus({ preventScroll: true });
  }

  // The header jumps to whichever waitlist form is closest to where the reader is.
  function joinWaitlist(event: MouseEvent) {
    const input = ["hero-email", "closing-email"]
      .map((id) => document.getElementById(id))
      .filter((element) => element !== null)
      .sort(
        (a, b) =>
          Math.abs(a.getBoundingClientRect().top - innerHeight / 2) -
          Math.abs(b.getBoundingClientRect().top - innerHeight / 2),
      )[0];
    if (!input) return;
    event.preventDefault();
    input.scrollIntoView({ behavior: "smooth", block: "center" });
    input.focus({ preventScroll: true });
  }
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  {#if page.route.id === "/"}<meta
      name="robots"
      content="index,follow,max-image-preview:large"
    />{/if}
  <link rel="canonical" href={`${origin}/`} />
  <link rel="stylesheet" href="/landing/fonts.css" />
  <link
    rel="preload"
    href="/landing/outfit.woff2"
    as="font"
    type="font/woff2"
    crossorigin="anonymous"
  />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="LastPeek" />
  <meta property="og:url" content={`${origin}/`} />
  <meta property="og:title" content="Take one last peek before you post." />
  <meta
    property="og:description"
    content="Get a friend’s eyes on your X post before everyone else sees it. One link, honest feedback, no typos."
  />
  <meta property="og:image" content={`${origin}/landing/og.png`} />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta
    property="og:image:alt"
    content="LastPeek: take one last peek before you post."
  />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:creator" content="@AlexH2035" />
  <meta name="twitter:title" content="Take one last peek before you post." />
  <meta
    name="twitter:description"
    content="Get a friend’s eyes on your X post before everyone else sees it."
  />
  <meta name="twitter:image" content={`${origin}/landing/og.png`} />
  <meta
    name="twitter:image:alt"
    content="LastPeek: take one last peek before you post."
  />
  {@html `<script type="application/ld+json">${structuredData}</script>`}
</svelte:head>

<svelte:window onscroll={() => (scrolled = scrollY > 24)} />

<div class="landing">
  <a class="skip" href="#main">Skip to content</a>
  <header class="nav" class:scrolled>
    <div class="nav-inner">
      <Brand href="/" />
      <nav aria-label="Page sections">
        <a href="#how">How it works</a>
        <a href="#faq">FAQ</a>
      </nav>
      <div class="nav-actions">
        {#if devSignIn}<form method="POST" action="/login/dev">
            <Button variant="ghost" type="submit" class="nav-button"
              ><span class="long">Dev sign in</span><span class="short"
                >Dev</span
              ></Button
            >
          </form>{/if}
        <Button
          href="/login"
          variant={returning ? "default" : "ghost"}
          class="nav-button"
          onclick={openSignIn}>Sign in</Button
        >
        <Button
          href="#waitlist"
          variant={returning ? "outline" : "default"}
          class="nav-button nav-join"
          onclick={joinWaitlist}
          ><span class="long">Join waitlist</span><span class="short"
            >Waitlist</span
          ></Button
        >
      </div>
    </div>
  </header>

  <main id="main">
    <section class="hero" aria-labelledby="hero-title">
      <div class="aurora" aria-hidden="true">
        <span></span><span></span><span></span>
      </div>
      <div class="grid-lines" aria-hidden="true"></div>
      <div class="hero-copy">
        <h1 id="hero-title">
          {#each headline as word, index}<span
              class="word"
              class:accent={index === 2 || index === 3}
              style:--i={index}><span>{word}</span></span
            >{" "}{/each}
        </h1>
        <p class="lede">
          Draft it exactly as it’ll look on X. Send friends one link, no account
          needed. Fix what they catch, then post.
        </p>
        <div id="waitlist" class="hero-form">
          <WaitlistForm id="hero-email" bind:joined bind:mood={heroMood} />
        </div>
        <p class="assurances">
          Already have an account?
          <a href="/login" onclick={openSignIn}
            >Sign in <Icon name="arrow" size={14} /></a
          >
        </p>
      </div>
      <div class="hero-visual">
        <HeroScene mood={heroMood} />
      </div>
    </section>

    <section class="problem" aria-labelledby="problem-title" use:reveal>
      <div class="problem-copy">
        <p class="eyebrow-label">Why I built it</p>
        <h2 id="problem-title">Catch the typo before the replies&nbsp;do.</h2>
        <p>
          I often send friends a post for a second opinion before it goes out.
          Usually that meant copying text or taking screenshots, which got messy
          once photos were involved, and their replies got buried in the group
          chat.
        </p>
        <p>
          So I built LastPeek. Send a link, get their thoughts, make a few
          tweaks, then post.
        </p>
        <p class="signed">
          <img src="/landing/alex.webp" alt="" width="36" height="36" /><span
            ><a
              href="https://x.com/AlexH2035"
              target="_blank"
              rel="noopener noreferrer">Alex Heffernan</a
            > made LastPeek</span
          >
        </p>
      </div>
      <div class="oops" aria-hidden="true">
        <div class="tweet">
          <img src="/landing/alex.webp" alt="" width="40" height="40" />
          <div>
            <span class="who"
              ><strong>Alex Heffernan</strong> @AlexH2035 · 1m</span
            >
            <p>Huge news: our app launches <mark>tomorow</mark> 🚀</p>
          </div>
        </div>
        <ol class="replies seq">
          <li style:--i={0}>
            <img src="/landing/matt.webp" alt="" width="32" height="32" /><span
              ><b>Matt</b> @mattbuilds<br />tomorow 💀</span
            >
          </li>
          <li style:--i={1}>
            <img src="/landing/priya.webp" alt="" width="32" height="32" /><span
              ><b>Priya</b> @priyaships<br />screenshotted before the edit 📸</span
            >
          </li>
          <li style:--i={2}>
            <img src="/landing/dev.webp" alt="" width="32" height="32" /><span
              ><b>Dev</b> @devdoesthings<br />proofreading? never heard of her</span
            >
          </li>
        </ol>
        <span class="stamp">Posted. Oops.</span>
      </div>
    </section>

    <section id="how" class="film-section" aria-labelledby="how-title">
      <div class="section-heading" use:reveal>
        <p class="eyebrow-label">How it works</p>
        <h2 id="how-title">
          Write&nbsp;it. Share&nbsp;it. Fix&nbsp;it. Post&nbsp;it.
        </h2>
      </div>
      <div class="player" use:reveal>
        <div class="film-frame">
          <FilmPlayer bind:this={film} bind:time />
        </div>
        <div class="chapter-list">
          <p class="chapters-cue" aria-hidden="true">Jump to a step</p>
          <ol class="chapters" aria-label="Jump to a moment in the film">
            {#each chapters as { at, title, short, body }, index}
              {@const end = chapters[index + 1]?.at ?? 41}
              <li class:active={chapter === index}>
                <button
                  type="button"
                  aria-current={chapter === index ? "step" : undefined}
                  onclick={() => film?.seek(at)}
                >
                  <span class="number">{index + 1}</span>
                  <span class="step"
                    ><strong>{title}</strong><b aria-hidden="true">{short}</b
                    ><span>{body}</span></span
                  >
                  <span
                    class="bar"
                    aria-hidden="true"
                    style:--done={chapter === index
                      ? Math.min(1, Math.max(0, (time - at) / (end - at)))
                      : chapter > index
                        ? 1
                        : 0}
                  ></span>
                </button>
              </li>
            {/each}
          </ol>
        </div>
        <p class="chapter-note" aria-hidden="true">
          {chapters[Math.max(0, chapter)].body}
        </p>
      </div>
    </section>

    <section class="details" aria-labelledby="details-title">
      <div class="section-heading" use:reveal>
        <h2 id="details-title">Small app. Obsessive details.</h2>
      </div>
      <ul class="bento" use:reveal>
        <li class="preview">
          <div class="art art-preview" aria-hidden="true">
            <div class="mini-thread">
              <div class="post">
                <img
                  class="avatar"
                  src="/landing/alex.webp"
                  alt=""
                  width="40"
                  height="40"
                />
                <div class="post-body">
                  <div class="post-author">
                    <strong>Alex Heffernan</strong><span class="handle"
                      >@AlexH2035</span
                    >
                  </div>
                  <p class="post-text">
                    Huge news: our app launches tomorrow 🚀
                  </p>
                  <div class="shot">
                    <Brand markOnly decorative /><b>Launching<br />tomorrow.</b>
                  </div>
                </div>
              </div>
              <div class="post">
                <img
                  class="avatar"
                  src="/landing/alex.webp"
                  alt=""
                  width="40"
                  height="40"
                />
                <div class="post-body">
                  <div class="post-author">
                    <strong>Alex Heffernan</strong><span class="handle"
                      >@AlexH2035</span
                    >
                  </div>
                  <p class="post-text">Doors open at 9am. Set a reminder 👇</p>
                </div>
              </div>
            </div>
          </div>
          <h3>A preview you can trust</h3>
          <p>Posts, threads, photos and video, exactly how X will show them.</p>
        </li>
        <li>
          <div class="art art-guest" aria-hidden="true">
            <span class="field">Jamie</span>
            <span class="go">Continue as guest</span>
          </div>
          <h3>No sign-up to review</h3>
          <p>Friends tap the link and type a name. That’s it.</p>
        </li>
        <li>
          <div class="art art-link" aria-hidden="true">
            <span class="link-pill"
              ><Icon name="link" size={15} />lastpeek…/r/aE0v</span
            >
            <span class="live"
              ><span class="dot"></span>Live · updated just now</span
            >
          </div>
          <h3>One link, always live</h3>
          <p>Keep editing. Friends always see the latest version.</p>
        </li>
        <li class="agent">
          <figure class="art art-agent">
            <blockquote>
              Just hooked LastPeek up to my agents… Asked mine to draft this
              reply straight into LastPeek. Works great, nice one!
            </blockquote>
            <figcaption>
              <img
                src="/landing/galen.webp"
                alt=""
                width="36"
                height="36"
              /><span
                ><b>Galen Green</b>
                <a
                  href="https://x.com/Galen__Green"
                  target="_blank"
                  rel="noopener noreferrer">@Galen__Green</a
                ></span
              >
            </figcaption>
          </figure>
          <h3>Works with your AI agent</h3>
          <p>
            Connect any MCP-compatible agent, like ChatGPT, Claude or Amp, to
            draft posts in LastPeek and get feedback from your friends.
          </p>
        </li>
      </ul>
      <ul class="extras" use:reveal>
        <li>
          <Icon name="x" size={20} /><span
            ><b>Post directly to X.</b> Plus replies, quotes and @mention
            search. <span class="pro">Pro</span></span
          >
        </li>
        <li>
          <Icon name="sparkle" size={20} /><span
            ><b>Private AI review.</b> Spelling, clarity and tone, just for you.
            <span class="pro">Pro</span></span
          >
        </li>
        <li>
          <Icon name="bell" size={20} /><span
            ><b>Made for your phone too.</b> Install it like an app and get notified
            when feedback arrives.</span
          >
        </li>
      </ul>
    </section>

    <section id="faq" class="faq" aria-labelledby="faq-title">
      <div class="section-heading" use:reveal>
        <h2 id="faq-title">Questions &amp; answers</h2>
      </div>
      <dl use:reveal>
        {#each faqs as { q, a }}
          <div>
            <dt>{q}</dt>
            <dd>{a}</dd>
          </div>
        {/each}
      </dl>
    </section>

    <section class="closing" aria-labelledby="closing-title" use:reveal>
      <div class="closing-mascot"><Mascot mood={closingMood} /></div>
      <h2 id="closing-title">
        Your next post deserves <em>one&nbsp;last&nbsp;peek.</em>
      </h2>
      <p>Better posts, with a little help from your friends.</p>
      <div class="closing-form" id="waitlist-end">
        <WaitlistForm id="closing-email" bind:joined bind:mood={closingMood} />
      </div>
      <p class="signin">
        Already have an account? <a href="/login" onclick={openSignIn}
          >Sign in <Icon name="arrow" size={14} /></a
        >
      </p>
    </section>
  </main>

  <footer class="site-footer">
    <Brand href="/" />
    <span>Better posts, with a little help from your friends.</span>
    <nav aria-label="Footer">
      <a href="/login" onclick={openSignIn}>Sign in</a>
      <a
        href="https://x.com/AlexH2035"
        target="_blank"
        rel="noopener noreferrer">@AlexH2035 on X</a
      >
      <a
        href="https://github.com/AlexanderHeffernan/LastPeek"
        target="_blank"
        rel="noopener noreferrer">Source code</a
      >
      <span>© 2026 Alexander Heffernan · AGPLv3</span>
    </nav>
  </footer>
  <AuthDialog
    auth={authView}
    bind:open={authOpen}
    {xEnabled}
    message={form?.message}
    email={form?.email}
    onclose={closeAuth}
    onwaitlist={focusWaitlist}
  />
</div>

<style>
  .landing {
    --display: "Outfit", Arial, Helvetica, sans-serif;
    font-family: var(--display);
    --page: min(1200px, calc(100% - 48px));
    --r-sm: 12px;
    --r-md: 20px;
    --r-lg: 28px;
    --r-xl: 40px;
    --section: calc(clamp(72px, 9vw, 120px) + clamp(72px, 8vw, 112px));
    --surface: light-dark(
      color-mix(in srgb, var(--card) 92%, transparent),
      color-mix(in srgb, #fff 4%, var(--card))
    );
    --edge: color-mix(in srgb, var(--foreground) 9%, var(--border));
    /* Small marketing copy on cream needs more contrast than app chrome. */
    --muted-foreground: light-dark(#66534c, #a3a19d);
    /* Mock metadata keeps X's look but must stay readable at small sizes. */
    --post-muted: light-dark(#6a5852, #9a9fa4);
    --post-subtle: light-dark(#6a5852, #a3a8ad);
    position: relative;
    width: 100%;
    overflow-x: clip;
  }
  /* No single words stranded on a line. Zero specificity, so a block that asks
     for balanced lines keeps them. */
  :global(:where(.landing) :where(p, li, dd, blockquote)) {
    text-wrap: pretty;
  }
  .landing :global(::selection) {
    background: color-mix(in srgb, var(--brand) 35%, transparent);
  }
  h1,
  .landing :global(h2),
  h3,
  dt {
    font-family: var(--display);
    text-wrap: balance;
  }
  .landing :global(h2) {
    margin: 0;
    font-size: clamp(28px, 3.2vw, 42px);
    font-weight: 800;
    line-height: 1.06;
    letter-spacing: -0.032em;
  }
  h3 {
    margin: 0;
    font-size: 21px;
    font-weight: 700;
    line-height: 1.1;
    letter-spacing: -0.02em;
  }
  em {
    color: light-dark(var(--primary), var(--brand));
    font-style: normal;
  }
  /* This stylesheet also loads with the signed-in home; scope page-level rules. */
  :global(html:has(.landing)) {
    scroll-padding-top: 96px;
  }
  @media (prefers-reduced-motion: no-preference) {
    :global(html:has(.landing)) {
      scroll-behavior: smooth;
    }
  }
  .landing :global(.eyebrow-label) {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 18px;
    color: var(--primary);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .landing :global(.eyebrow-label::before) {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--brand);
    box-shadow: 0 0 10px var(--brand);
  }
  .section-heading {
    display: grid;
    justify-items: center;
    max-width: 820px;
    margin: 0 auto clamp(40px, 6vw, 72px);
    text-align: center;
  }
  main > section {
    width: var(--page);
    margin: 0 auto;
  }
  main > section + section {
    margin-top: var(--section);
  }

  /* Reveal */
  :global(.landing [data-reveal]) {
    transition:
      opacity 900ms cubic-bezier(0.16, 1, 0.3, 1),
      transform 900ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  :global(.landing [data-reveal="pending"]) {
    opacity: 0;
    transform: translateY(28px);
  }
  :global(.landing [data-reveal="pending"]) .seq > *,
  :global(.landing [data-reveal="pending"]) .stamp {
    opacity: 0;
  }
  :global(.landing [data-reveal="shown"]) .seq > * {
    animation: slam 700ms cubic-bezier(0.2, 1.4, 0.4, 1) both;
    animation-delay: calc(var(--i) * 450ms + 500ms);
  }
  :global(.landing [data-reveal="shown"]) .stamp {
    animation: stamp 500ms 2.1s cubic-bezier(0.2, 1.6, 0.4, 1) both;
  }
  @keyframes slam {
    from {
      opacity: 0;
      transform: translateY(24px) scale(0.9);
    }
  }
  @keyframes stamp {
    from {
      opacity: 0;
      transform: rotate(-12deg) scale(2.2);
    }
  }

  /* Navigation */
  .skip {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 40;
    padding: 10px 16px;
    border-radius: 999px;
    background: var(--primary-fill);
    color: var(--primary-foreground);
    font-weight: 700;
    transform: translateY(-160%);
  }
  .skip:focus-visible {
    transform: none;
  }
  .nav {
    position: sticky;
    top: 0;
    z-index: 30;
    padding: calc(env(safe-area-inset-top) + 12px) 0 0;
  }
  .short {
    display: none;
  }
  .nav-inner {
    display: flex;
    align-items: center;
    gap: 20px;
    width: var(--page);
    height: 64px;
    margin: 0 auto;
    padding: 0 10px 0 18px;
    border: 1px solid transparent;
    border-radius: 999px;
    transition:
      background 300ms ease,
      border-color 300ms ease,
      box-shadow 300ms ease,
      width 500ms cubic-bezier(0.2, 1, 0.3, 1);
  }
  .nav.scrolled .nav-inner {
    width: min(960px, calc(100% - 24px));
    border-color: var(--edge);
    background: color-mix(in srgb, var(--background) 94%, transparent);
    backdrop-filter: blur(18px) saturate(1.6);
    box-shadow: 0 20px 50px -30px var(--shadow);
  }
  .nav-inner :global(.brand svg) {
    height: 30px;
  }
  .nav nav {
    display: flex;
    gap: 2px;
    margin-left: 8px;
  }
  .nav nav a {
    padding: 10px 14px;
    border-radius: 999px;
    color: var(--muted-foreground);
    font-size: 15px;
    text-decoration: none;
    transition:
      color 150ms ease,
      background 150ms ease;
  }
  .nav nav a:hover {
    background: var(--muted);
    color: var(--foreground);
  }
  .nav-actions {
    display: flex;
    gap: 6px;
    margin-left: auto;
  }
  .nav-actions :global(.nav-button) {
    height: 44px;
    border-radius: 999px;
    padding-inline: 18px;
    font-weight: 700;
  }

  /* Hero */
  .hero {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
    align-items: center;
    gap: clamp(40px, 5vw, 72px);
    width: var(--page);
    margin: 0 auto;
    padding: clamp(32px, 5vw, 64px) 0 0;
  }
  .aurora {
    position: absolute;
    inset: -200px -40vw -100px;
    z-index: -2;
    overflow: hidden;
    pointer-events: none;
    filter: blur(70px);
  }
  .aurora span {
    position: absolute;
    border-radius: 50%;
    opacity: 0.55;
    animation: drift 18s ease-in-out infinite alternate;
  }
  .aurora span:nth-child(1) {
    top: 10%;
    left: 52%;
    width: 640px;
    height: 520px;
    background: color-mix(in srgb, var(--brand) 55%, transparent);
  }
  .aurora span:nth-child(2) {
    top: 45%;
    left: 70%;
    width: 520px;
    height: 420px;
    background: color-mix(in srgb, #ffb36b 45%, transparent);
    animation-duration: 22s;
    animation-delay: -6s;
  }
  .aurora span:nth-child(3) {
    top: 30%;
    left: 30%;
    width: 420px;
    height: 360px;
    background: color-mix(in srgb, #ff87bf 30%, transparent);
    animation-duration: 26s;
    animation-delay: -12s;
  }
  @keyframes drift {
    to {
      transform: translate(-12%, 10%) scale(1.15);
    }
  }
  .grid-lines {
    position: absolute;
    inset: -120px -40vw 0;
    z-index: -1;
    background-image: radial-gradient(
      color-mix(in srgb, var(--foreground) 14%, transparent) 1px,
      transparent 1.5px
    );
    background-size: 28px 28px;
    mask-image: radial-gradient(ellipse 60% 55% at 50% 40%, #000, transparent);
    pointer-events: none;
  }
  h1 {
    margin: 0;
    font-size: clamp(52px, 6.1vw, 92px);
    font-weight: 800;
    line-height: 1;
    letter-spacing: -0.04em;
  }
  .word {
    display: inline-block;
    padding-bottom: 0.06em;
    overflow: hidden;
    vertical-align: top;
  }
  .word > span {
    display: inline-block;
    animation: word 1000ms cubic-bezier(0.16, 1, 0.3, 1) both;
    animation-delay: calc(var(--i) * 70ms + 120ms);
  }
  .word.accent > span {
    color: light-dark(var(--primary), var(--brand));
  }
  @keyframes word {
    from {
      transform: translateY(105%) rotate(4deg);
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(16px);
    }
  }
  .lede {
    max-width: 34em;
    margin: 28px 0 32px;
    color: var(--muted-foreground);
    font-size: clamp(17px, 1.5vw, 20px);
    line-height: 1.55;
    text-wrap: balance;
    animation: rise 900ms 500ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .hero-form {
    animation: rise 900ms 650ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .assurances {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 20px;
    margin: 8px 0 0;
    padding: 0;
    color: var(--muted-foreground);
    font-size: 15px;
    animation: rise 900ms 800ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .assurances a,
  .signin a {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 44px;
    color: var(--primary);
    font-weight: 700;
    text-decoration: none;
  }
  .assurances a:hover,
  .signin a:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  /* Problem */
  .problem {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: center;
    gap: clamp(40px, 7vw, 104px);
  }
  .problem-copy p {
    max-width: 30em;
    margin: 22px 0 0;
    color: var(--muted-foreground);
    font-size: 18px;
    line-height: 1.6;
  }
  .problem-copy .signed {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 28px;
    color: var(--foreground);
    font-size: 15px;
  }
  .signed a {
    color: inherit;
    font-weight: 700;
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--brand) 60%, transparent);
    text-decoration-thickness: 2px;
    text-underline-offset: 3px;
  }
  .signed a:hover {
    text-decoration-color: var(--brand);
  }
  .signed img,
  .replies img,
  .art-agent img {
    flex: none;
    border-radius: 50%;
    object-fit: cover;
  }

  .problem-copy .eyebrow-label {
    margin: 0 0 18px;
    font-size: 13px;
    line-height: 1;
  }
  .oops {
    font-family: Arial, Helvetica, sans-serif;
    position: relative;
    padding: 26px;
    border: 1px solid var(--post-border);
    border-radius: var(--r-lg);
    background: var(--card);
    color: var(--post-foreground);
    box-shadow: 0 50px 100px -60px var(--shadow);
    rotate: 2deg;
  }
  .tweet,
  .replies li {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr);
    gap: 12px;
  }
  .tweet img {
    border-radius: 50%;
  }
  .who {
    color: var(--post-muted);
    font-size: 15px;
  }
  .who strong {
    color: var(--post-foreground);
  }
  .tweet p {
    margin: 4px 0 0;
    font-size: 20px;
    line-height: 1.35;
  }
  mark {
    border-radius: 3px;
    background: color-mix(in srgb, var(--destructive) 20%, transparent);
    box-shadow: 0 2px 0 var(--destructive);
    color: inherit;
  }
  .replies {
    display: grid;
    gap: 16px;
    margin: 20px 0 0;
    padding: 18px 0 0 52px;
    border-top: 1px solid var(--post-border);
    list-style: none;
    font-size: 15px;
    line-height: 1.4;
  }
  .replies li {
    grid-template-columns: 32px minmax(0, 1fr);
  }
  .replies b {
    color: var(--post-foreground);
  }
  .replies li > span:last-child {
    color: var(--post-subtle);
  }
  .stamp {
    position: absolute;
    right: 18px;
    bottom: -18px;
    padding: 8px 16px;
    border: 2px solid var(--primary);
    border-radius: 10px;
    background: var(--background);
    color: var(--primary);
    font-family: var(--display);
    font-size: 20px;
    font-weight: 800;
    letter-spacing: -0.01em;
    rotate: -6deg;
  }

  /* Film */
  .film-frame {
    position: relative;
    max-width: 1040px;
    margin: 0 auto;
    padding: 2px;
    border-radius: calc(var(--r-xl) + 2px);
    background: conic-gradient(
      from var(--spin, 0deg),
      transparent 0 55%,
      var(--brand) 70%,
      #ffd479 78%,
      transparent 90%
    );
    animation: spin 8s linear infinite;
  }
  .film-frame::after {
    content: "";
    position: absolute;
    inset: 10% 6% -8%;
    z-index: -1;
    border-radius: 50%;
    background: radial-gradient(
      closest-side,
      color-mix(in srgb, var(--brand) 30%, transparent),
      transparent
    );
    filter: blur(40px);
  }
  @property --spin {
    syntax: "<angle>";
    inherits: false;
    initial-value: 0deg;
  }
  @keyframes spin {
    to {
      --spin: 360deg;
    }
  }
  .film-frame :global(.film) {
    border-radius: var(--r-xl);
  }

  .player {
    display: grid;
    grid-template-columns: minmax(0, 1.75fr) minmax(260px, 1fr);
    align-items: center;
    gap: clamp(28px, 4vw, 56px);
  }
  .chapters {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .chapters button {
    position: relative;
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr);
    gap: 14px;
    width: 100%;
    padding: 14px 16px 16px;
    overflow: hidden;
    border: 1px solid transparent;
    border-radius: var(--r-md);
    background: none;
    color: var(--muted-foreground);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      background 250ms ease,
      border-color 250ms ease,
      color 250ms ease;
  }
  .chapters button:hover {
    color: var(--foreground);
  }
  .chapters button:focus-visible {
    outline: 3px solid var(--ring);
    outline-offset: 2px;
  }
  .chapters .active button {
    border-color: var(--edge);
    background: var(--surface);
    color: var(--foreground);
  }
  .chapters .number {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 1px solid var(--edge);
    border-radius: 50%;
    font-size: 14px;
    font-weight: 700;
    transition:
      background 250ms ease,
      color 250ms ease;
  }
  .chapters .active .number {
    border-color: transparent;
    background: var(--primary-fill);
    color: var(--primary-foreground);
  }
  .chapters .step {
    display: grid;
    gap: 4px;
    padding-top: 4px;
    text-wrap: balance;
  }
  .chapters strong {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .chapters .step > span {
    font-size: 15px;
    line-height: 1.45;
  }
  .chapters b {
    display: none;
  }
  .chapters .bar {
    position: absolute;
    right: 16px;
    bottom: 0;
    left: 62px;
    height: 2px;
    border-radius: 2px;
    background: var(--brand);
    transform: scaleX(var(--done));
    transform-origin: left;
    opacity: 0;
  }
  .chapters .active .bar {
    opacity: 1;
  }

  .chapter-list {
    display: grid;
    gap: 10px;
  }
  .chapters-cue {
    margin: 0 0 0 16px;
    color: var(--muted-foreground);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .chapter-note {
    display: none;
  }

  /* Details */
  .bento {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .bento > li {
    position: relative;
    display: flex;
    flex-direction: column;
    padding: 18px 18px 26px;
    overflow: hidden;
    border: 1px solid var(--edge);
    border-radius: var(--r-lg);
    background: var(--surface);
  }
  .bento > li.preview {
    grid-column: span 2;
    grid-row: span 2;
  }
  .bento > li.agent {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    column-gap: 24px;
  }
  .agent > .art {
    grid-row: span 2;
    margin-bottom: 0;
  }
  .agent > h3 {
    align-self: end;
  }
  .agent > p {
    align-self: start;
  }
  .bento h3,
  .bento p {
    padding-inline: 8px;
  }
  .bento p {
    margin: 8px 0 0;
    color: var(--muted-foreground);
    font-size: 16px;
    line-height: 1.5;
  }
  .art {
    position: relative;
    display: grid;
    flex: 1;
    place-items: center;
    min-height: 168px;
    margin-bottom: 22px;
    overflow: hidden;
    border-radius: var(--r-md);
    background:
      radial-gradient(
        circle at 50% 120%,
        color-mix(in srgb, var(--brand) 16%, transparent),
        transparent 70%
      ),
      color-mix(in srgb, var(--muted) 70%, transparent);
    font-size: 14px;
  }
  /* One short thread, drawn the way X draws it in the reader's theme. */
  .art-preview {
    height: auto;
    padding: 24px 12px;
  }
  .mini-thread {
    display: grid;
    width: min(100%, 460px);
    border: 1px solid var(--post-border);
    border-radius: 16px;
    background: var(--background);
    color: var(--post-foreground);
    font-family: Arial, Helvetica, sans-serif;
    box-shadow: 0 20px 40px -24px var(--shadow);
  }
  .mini-thread .post-text {
    margin: 0;
    padding: 0;
    color: var(--post-foreground);
    font-size: 15px;
    line-height: 20px;
  }
  .shot {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    width: 100%;
    aspect-ratio: 16 / 9;
    margin-top: 10px;
    padding: 16px;
    border: 1px solid var(--post-border);
    border-radius: 16px;
    background: #fff6ed;
    color: #22191b;
    font-family: "Outfit", Arial, sans-serif;
    font-size: clamp(18px, 2.5vw, 32px);
    line-height: 1.05;
  }
  .shot :global(svg) {
    width: 26%;
    height: auto;
  }
  .art-guest {
    gap: 10px;
    align-content: center;
  }
  .field {
    width: 200px;
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--background);
    text-align: left;
  }
  .go {
    width: 200px;
    padding: 9px;
    border-radius: 12px;
    background: var(--primary-fill);
    color: var(--primary-foreground);
    font-weight: 700;
    text-align: center;
  }
  /* A real reply from an early user, set like a post rather than a testimonial card. */
  .art-agent {
    display: grid;
    align-content: center;
    justify-items: start;
    gap: 14px;
    height: auto;
    min-height: 168px;
    margin: 0 0 22px;
    padding: 24px clamp(20px, 4vw, 40px);
  }
  .art-agent blockquote {
    max-width: 34em;
    margin: 0;
    font-size: clamp(17px, 1.6vw, 20px);
    font-weight: 500;
    line-height: 1.4;
  }
  .art-agent figcaption {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
  }
  .art-agent figcaption span {
    display: grid;
  }
  .art-agent figcaption a {
    color: var(--muted-foreground);
    text-decoration: none;
  }
  .art-agent figcaption a:hover {
    text-decoration: underline;
  }
  .art-link {
    gap: 12px;
    align-content: center;
  }
  .link-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--background);
    color: var(--primary);
    font-weight: 700;
  }
  .live {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--muted-foreground);
    font-size: 13px;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--success);
    box-shadow: 0 0 0 0 var(--success);
    animation: ping 1.6s ease-out infinite;
  }
  @keyframes ping {
    to {
      box-shadow: 0 0 0 8px transparent;
    }
  }

  .extras {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px 32px;
    margin: 32px 0 0;
    padding: 0 8px;
    list-style: none;
  }
  .extras li {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr);
    gap: 12px;
    color: var(--muted-foreground);
    font-size: 15px;
    line-height: 1.5;
  }
  .extras li > :global(svg) {
    margin-top: 1px;
    color: var(--primary);
  }
  .extras b {
    color: var(--foreground);
  }
  .pro {
    display: inline-block;
    margin-left: 4px;
    padding: 1px 7px;
    border-radius: 999px;
    background: light-dark(#ffe1d9, #3a1d19);
    color: light-dark(#8a2a1f, #ff9a85);
    font-size: 12px;
    font-weight: 700;
    vertical-align: 1px;
  }

  /* FAQ */
  .faq dl {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 64px;
    max-width: 1040px;
    margin: 0 auto;
  }
  .faq dl > div {
    padding: 28px 0;
    border-top: 1px solid var(--edge);
  }
  dt {
    font-size: 21px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  dd {
    margin: 10px 0 0;
    color: var(--muted-foreground);
    font-size: 16px;
    line-height: 1.6;
  }

  /* Closing */
  section.closing {
    position: relative;
    display: grid;
    justify-items: center;
    padding: clamp(48px, 6vw, 80px) 24px;
    overflow: hidden;
    border: 1px solid var(--edge);
    border-radius: var(--r-xl);
    background:
      radial-gradient(
        ellipse 70% 60% at 50% 0%,
        color-mix(in srgb, var(--brand) 26%, transparent),
        transparent
      ),
      radial-gradient(
        ellipse 50% 50% at 90% 100%,
        color-mix(in srgb, #ffb36b 14%, transparent),
        transparent
      ),
      var(--surface);
    text-align: center;
  }
  .closing-mascot {
    width: clamp(120px, 14vw, 176px);
    animation: bob 5s ease-in-out infinite;
  }
  @keyframes bob {
    50% {
      transform: translateY(-10px) rotate(-3deg);
    }
  }
  .closing h2 {
    max-width: 12em;
    margin-top: 28px;
    font-size: clamp(44px, 6.4vw, 88px);
  }
  .closing > p {
    margin: 20px 0 34px;
    color: var(--muted-foreground);
    font-size: 18px;
  }
  .closing-form {
    display: grid;
    justify-items: center;
    width: min(480px, 100%);
  }
  .signin {
    margin: 12px 0 0;
    color: var(--muted-foreground);
    font-size: 15px;
  }

  /* Footer */
  .site-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 24px;
    width: var(--page);
    margin: 40px auto 0;
    padding: 28px 0 calc(28px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--edge);
    color: var(--muted-foreground);
    font-size: 14px;
  }
  .site-footer :global(.brand svg) {
    height: 26px;
  }
  .site-footer nav {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 18px;
    margin-left: auto;
  }
  .site-footer a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    color: inherit;
  }
  .site-footer a:hover {
    color: var(--foreground);
  }
  .site-footer nav span {
    display: inline-flex;
    align-items: center;
  }

  /* Responsive */
  @media (max-width: 1000px) {
    .hero {
      grid-template-columns: 1fr;
      gap: 24px;
      padding-top: 32px;
      text-align: center;
    }
    .hero-copy {
      display: grid;
      justify-items: center;
    }
    .lede {
      margin-inline: auto;
    }
    .hero-form {
      display: grid;
      justify-items: center;
      width: min(480px, 100%);
    }
    .assurances {
      justify-content: center;
    }
    .hero-visual {
      width: min(680px, 100%);
      margin: 0 auto;
      text-align: left;
    }
    .problem {
      grid-template-columns: 1fr;
    }
    .player {
      grid-template-columns: 1fr;
    }
    .chapters {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .chapters button {
      grid-template-columns: 1fr;
      justify-items: center;
      gap: 8px;
      padding: 12px 6px 14px;
      text-align: center;
    }
    .chapters .step > span,
    .chapters strong {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .chapters b {
      display: block;
      font-size: 14px;
    }
    .chapters .bar {
      left: 10px;
      right: 10px;
    }
    .chapters-cue {
      margin-left: 0;
      text-align: center;
    }
    .chapter-note {
      display: block;
      min-height: 3em;
      margin: 0;
      font-size: 16px;
      line-height: 1.45;
      text-align: center;
      text-wrap: balance;
    }
    .bento {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .bento > li.preview {
      grid-row: auto;
    }
  }
  @media (max-width: 760px) {
    .nav nav {
      display: none;
    }
    .faq dl {
      grid-template-columns: 1fr;
    }
    .extras {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 600px) {
    .landing {
      --page: calc(100% - 32px);
    }
    .nav {
      padding-top: calc(env(safe-area-inset-top) + 8px);
    }
    .nav-inner {
      height: 56px;
      padding: 0 6px 0 14px;
    }
    .nav.scrolled .nav-inner {
      width: calc(100% - 16px);
    }
    .nav-inner :global(.brand svg) {
      height: 26px;
    }
    .nav-actions :global(.nav-button) {
      height: 44px;
      padding-inline: 12px;
    }
    /* Development adds a third action; keep all three on a 390px screen. */
    .nav-actions:has(form) :global(.nav-button) {
      padding-inline: 8px;
    }
    .nav-actions:has(form) {
      gap: 2px;
    }
    .long {
      display: none;
    }
    .short {
      display: inline;
    }
    .hero {
      padding-top: 20px;
    }
    .lede {
      margin: 18px 0 22px;
      font-size: 16px;
    }
    h1 {
      font-size: clamp(44px, 12.5vw, 60px);
      line-height: 1;
      letter-spacing: -0.035em;
    }
    .bento {
      grid-template-columns: 1fr;
    }
    .bento > li.preview,
    .bento > li.agent {
      grid-column: auto;
    }
    .bento > li.agent {
      display: flex;
    }
    .agent > .art {
      margin-bottom: 22px;
    }
    .agent > h3,
    .agent > p {
      align-self: auto;
    }
    .oops {
      rotate: none;
    }
    .stamp {
      right: 8px;
    }
    .site-footer nav {
      margin-left: 0;
    }
  }
  /* Reduced motion stops every loop and plays entrances as instant end states. */
  @media (prefers-reduced-motion: reduce) {
    .landing :global(*),
    .landing :global(*::before),
    .landing :global(*::after) {
      animation-duration: 0.01ms !important;
      animation-delay: 0s !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .aurora span,
    .word > span,
    .lede,
    .hero-form,
    .assurances,
    .film-frame,
    .closing-mascot,
    .art *,
    .seq > *,
    .stamp {
      animation: none !important;
    }
  }
</style>
