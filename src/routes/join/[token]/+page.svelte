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
  <Brand href="/login" /><a class="small muted" href="/login"
    >Already here? Sign in</a
  >
</header>
<main class="auth-shell">
  <section class="auth-copy">
    <span class="eyebrow">You’re invited</span>
    <h1>A fresh set<br />of <em>eyes.</em></h1>
    <p>Your next good post starts here.</p>
  </section>
  <section class="auth-card">
    <h2>Create your account.</h2>
    {#if data.xEnabled}
      <form method="POST" action="/auth/x/start" class="social-auth">
        <input type="hidden" name="invite" value={data.invite} />
        <label
          >Account email<Input
            name="email"
            type="email"
            autocomplete="email"
            required
            maxlength={254}
          /></label
        >
        <Button variant="outline" type="submit"
          ><Icon name="x" size={18} />Sign up with X</Button
        >
        <p class="small muted">
          Use your X name, handle and photo. No password needed.
        </p>
      </form>
    {/if}
    <details
      class:password-alternative={data.xEnabled}
      open={!data.xEnabled || Boolean(form?.message)}
    >
      <summary hidden={!data.xEnabled}>Sign up with a password instead</summary>
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
          >Your name<Input
            name="name"
            autocomplete="name"
            required
            maxlength={80}
          /></label
        ><label
          >Email<Input
            name="email"
            type="email"
            autocomplete="email"
            required
          /></label
        ><label
          >Password<Input
            name="password"
            type="password"
            minlength={12}
            maxlength={256}
            autocomplete="new-password"
            required
          /><span class="small muted">At least 12 characters.</span></label
        >
        {#if form?.message}<p class="notice error" role="alert">
            {form.message}
          </p>{/if}<Button variant="default" type="submit" disabled={busy}
          >{busy ? "Making your space…" : "Create account"}</Button
        >
      </form>
    </details>
  </section>
</main>

<style>
  .password-alternative {
    margin-top: 24px;
  }
  .password-alternative > form {
    margin-top: 18px;
  }
</style>
