<script lang="ts">
  import { enhance } from "$app/forms";
  import Brand from "$lib/components/Brand.svelte";
  import Icon from "$lib/components/Icon.svelte";
  let { form } = $props();
  let busy = $state(false);
</script>

<header class="topbar">
  <Brand href="/login" /><span class="small muted">A second pair of eyes.</span>
</header>
<main class="auth-shell">
  <section class="auth-copy">
    <span class="eyebrow">Before you tell everyone</span>
    <h1>Good posts start<br />with a little peek.</h1>
    <p>
      A quiet space to work on your words, share with a friend, and get that
      second opinion.
    </p>
    <div class="auth-decoration">
      <Icon name="eye" /><span>Your words. Your people. Your call.</span>
    </div>
  </section>
  <section class="auth-card">
    <h2>Welcome back.</h2>
    <p class="intro">Something on your mind? Let’s give it a look.</p>
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
        >Email<input
          name="email"
          type="email"
          autocomplete="email"
          value={form?.email || ""}
          required
        /></label
      >
      <label
        >Password<input
          name="password"
          type="password"
          autocomplete="current-password"
          required
          maxlength="256"
        /></label
      >
      {#if form?.message}<div class="notice error" role="alert">
          {form.message}
        </div>{/if}
      <button class="primary" disabled={busy}
        >{busy ? "Signing in…" : "Sign in"}<Icon
          name="arrow"
          size={16}
        /></button
      >
    </form>
    <p class="auth-footer">
      LastPeek is invite-only for now.<br />Have an invite? Open the link your
      friend sent you.
    </p>
  </section>
</main>
