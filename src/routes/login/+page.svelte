<script lang="ts">
  import { Input } from "$lib/components/ui/input/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { enhance } from "$app/forms";
  import Brand from "$lib/components/Brand.svelte";
  import Icon from "$lib/components/Icon.svelte";
  let { data, form } = $props();
  let busy = $state(false);
</script>

<header class="topbar">
  <Brand href="/login" /><span class="small muted">A second pair of eyes.</span>
</header>
<main class="auth-shell">
  <section class="auth-copy">
    <span class="eyebrow">Before you tell everyone</span>
    <h1>One last look.<br /><em>Then let it fly.</em></h1>
    <p>Draft for X. Get a second opinion.<br />Post with confidence.</p>
    <div class="auth-decoration">
      <Icon name="eye" /><span>A little perspective goes a long way.</span>
    </div>
  </section>
  <section class="auth-card">
    <h2>Welcome back.</h2>
    <form
      method="POST"
      use:enhance={() => {
        busy = true;
        return async ({ update }) => {
          await update();
          busy = false;
        };
      }}
    >
      <label
        >Email<Input
          name="email"
          type="email"
          autocomplete="email"
          value={form?.email || ""}
          required
        /></label
      >
      <label
        >Password<Input
          name="password"
          type="password"
          autocomplete="current-password"
          required
          maxlength={256}
        /></label
      >
      {#if form?.message}<div class="notice error" role="alert">
          {form.message}
        </div>{/if}
      <Button variant="default" type="submit" disabled={busy}
        >{busy ? "Signing in…" : "Sign in"}<Icon
          name="arrow"
          size={16}
        /></Button
      >
    </form>
    <p class="auth-footer">Invite-only. Have a link? You’re in.</p>
    {#if data.devSignIn}<form
        method="POST"
        action="/login/dev"
        use:enhance
        class="dev-sign-in"
      >
        <Button variant="ghost" type="submit">Dev sign in</Button>
      </form>{/if}
  </section>
</main>
