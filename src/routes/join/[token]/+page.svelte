<script lang="ts">
  import { enhance } from "$app/forms";
  import Brand from "$lib/components/Brand.svelte";
  let { form } = $props();
  let busy = $state(false);
</script>

<header class="topbar">
  <Brand href="/login" /><a class="small muted" href="/login"
    >Already here? Sign in</a
  >
</header>
<main class="auth-shell">
  <section class="auth-copy">
    <span class="eyebrow">You’re invited</span>
    <h1>A little space.<br />A better post.</h1>
    <p>
      Make yourself at home. Your drafts stay yours until you choose to share
      them.
    </p>
  </section>
  <section class="auth-card">
    <h2>Come take a peek.</h2>
    <p class="intro">Create your LastPeek account.</p>
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
        >Your name<input
          name="name"
          autocomplete="name"
          required
          maxlength="80"
        /></label
      ><label
        >Email<input
          name="email"
          type="email"
          autocomplete="email"
          required
        /></label
      ><label
        >Password<input
          name="password"
          type="password"
          minlength="12"
          maxlength="256"
          autocomplete="new-password"
          required
        /><span class="small muted">At least 12 characters.</span></label
      >
      {#if form?.message}<p class="notice error" role="alert">
          {form.message}
        </p>{/if}<button class="primary" disabled={busy}
        >{busy ? "Making your space…" : "Create account"}</button
      >
    </form>
    <p class="auth-footer">
      No connected social account. No automatic posting.
    </p>
  </section>
</main>
