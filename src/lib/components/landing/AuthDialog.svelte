<script lang="ts" module>
  export type Auth =
    | { kind: "signin"; xCancelled?: boolean; xUnlinked?: boolean }
    | { kind: "join"; invite: string; email: string; inviter: string | null };
</script>

<script lang="ts">
  import { applyAction, enhance } from "$app/forms";
  import type { SubmitFunction } from "$app/forms";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import Icon from "$lib/components/Icon.svelte";
  import Mascot from "./Mascot.svelte";

  let {
    auth,
    open = $bindable(false),
    xEnabled,
    message: serverMessage = "",
    email: serverEmail = "",
    onclose,
    onwaitlist,
  }: {
    auth: Auth;
    open?: boolean;
    xEnabled: boolean;
    message?: string;
    email?: string;
    onclose: () => void;
    onwaitlist: () => void;
  } = $props();
  let busy = $state(false),
    // A failed client submission replaces the native form's server message.
    failure = $state<{ message: string; email?: string } | null>(null),
    noticeDismissed = $state(false);
  const message = $derived(failure?.message ?? serverMessage);
  const email = $derived(failure?.email ?? serverEmail);
  const action = $derived(
    auth.kind === "signin" ? "/login" : `/join/${auth.invite}`,
  );

  // The form posts to its own route, whichever page opened the dialog.
  const submit: SubmitFunction = () => {
    busy = true;
    failure = null;
    return async ({ result }) => {
      busy = false;
      if (result.type === "failure")
        failure = result.data as { message: string; email?: string };
      else if (result.type === "error")
        failure = {
          message:
            result.status === 429
              ? "Too many tries. Give it a few minutes."
              : (result.error?.message ?? "Something went wrong. Try again."),
        };
      else await applyAction(result);
    };
  };
</script>

<Dialog.Root
  bind:open
  onOpenChange={(next) => {
    if (!next) onclose();
  }}
>
  <Dialog.Content
    class="auth-dialog"
    portalProps={{ disabled: true }}
    interactOutsideBehavior={busy ? "ignore" : "close"}
  >
    <div class="peek" aria-hidden="true"><Mascot /></div>
    {#if auth.kind === "signin"}
      <Dialog.Header>
        <Dialog.Title class="auth-title">Welcome back.</Dialog.Title>
        <Dialog.Description class="auth-lede"
          >Pick up where you left off.</Dialog.Description
        >
      </Dialog.Header>
      {#if auth.xCancelled}<p class="auth-notice" role="status">
          X sign-in cancelled. You can try again or use your password.
        </p>{/if}
      {#if xEnabled}
        <form method="POST" action="/auth/x/start">
          <Button variant="outline" type="submit" class="auth-x"
            ><Icon name="x" size={18} />Sign in with X</Button
          >
        </form>
        {#if auth.xUnlinked && !noticeDismissed}
          <div class="auth-notice with-close" role="status">
            <p>
              This X account isn’t linked yet. Try another X account, sign in
              with your password to link it from Account, or use an invitation
              to join.
            </p>
            <Button
              variant="ghost"
              size="icon"
              class="size-10 text-muted-foreground"
              aria-label="Dismiss X sign-in notice"
              onclick={() => (noticeDismissed = true)}
              ><Icon name="close" size={16} /></Button
            >
          </div>
        {/if}
        <p class="auth-divider"><span>or use your password</span></p>
      {/if}
      <form method="POST" {action} use:enhance={submit} class="auth-form">
        <label
          >Email<Input
            name="email"
            type="email"
            autocomplete="email"
            value={email}
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
        {#if message}<p class="auth-error" role="alert">{message}</p>{/if}
        <Button type="submit" disabled={busy} class="auth-submit"
          >{busy ? "Signing in…" : "Sign in"}<Icon
            name="arrow"
            size={16}
          /></Button
        >
      </form>
      <p class="auth-foot">
        Not invited yet? <a
          href="/#waitlist"
          onclick={(event) => {
            event.preventDefault();
            onwaitlist();
          }}>Join the waitlist</a
        >
      </p>
    {:else}
      <Dialog.Header>
        <Dialog.Title class="auth-title">You’re in. 👀</Dialog.Title>
        <Dialog.Description class="auth-lede"
          >{auth.inviter?.split(" ")[0] ?? "Someone"} saved you a spot. Create your
          account to start drafting.</Dialog.Description
        >
      </Dialog.Header>
      {#if xEnabled}
        <form method="POST" action="/auth/x/start">
          <input type="hidden" name="invite" value={auth.invite} />
          <input type="hidden" name="email" value={auth.email} />
          <Button variant="outline" type="submit" class="auth-x"
            ><Icon name="x" size={18} />Sign up with X</Button
          >
        </form>
        <p class="auth-divider"><span>or use a password</span></p>
      {/if}
      <form method="POST" {action} use:enhance={submit} class="auth-form">
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
            value={auth.email}
            readonly
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
          /><span class="auth-hint">At least 12 characters.</span></label
        >
        {#if message}<p class="auth-error" role="alert">{message}</p>{/if}
        <Button type="submit" disabled={busy} class="auth-submit"
          >{busy ? "Making your space…" : "Create account"}</Button
        >
      </form>
      <p class="auth-foot">
        Already have an account? <a href="/login">Sign in</a>
      </p>
    {/if}
  </Dialog.Content>
</Dialog.Root>

<style>
  :global(.auth-dialog) {
    gap: 18px !important;
    max-width: min(420px, calc(100% - 32px)) !important;
    padding: 28px !important;
    overflow: visible;
    border-radius: 28px !important;
    background: var(--card) !important;
    box-shadow:
      0 40px 80px -30px var(--shadow),
      0 30px 70px -40px color-mix(in srgb, var(--brand) 55%, transparent);
    font-family: var(--display);
  }
  :global(.auth-dialog[data-state="open"]),
  :global(.landing [data-slot="dialog-overlay"][data-state="open"]) {
    animation: auth-in 240ms ease-out both !important;
  }
  :global(.auth-dialog[data-state="closed"]),
  :global(.landing [data-slot="dialog-overlay"][data-state="closed"]) {
    animation: auth-out 180ms ease-in both !important;
  }
  @keyframes auth-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes auth-out {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }
  :global(.auth-dialog [data-slot="dialog-close"]) {
    top: 12px !important;
    right: 12px !important;
    width: 44px !important;
    height: 44px !important;
    border-radius: 50% !important;
  }
  /* Clipped at the card's edge, so the mascot peeks from behind it. */
  .peek {
    position: absolute;
    bottom: 100%;
    left: 32px;
    width: 88px;
    height: 50px;
    overflow: hidden;
  }
  .peek :global(.mascot) {
    animation: peek 600ms 120ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  @keyframes peek {
    from {
      transform: translateY(100%);
    }
  }
  :global(.auth-title) {
    font-family: var(--display);
    font-size: 30px !important;
    font-weight: 800 !important;
    letter-spacing: -0.03em;
  }
  :global(.auth-lede) {
    font-size: 15px !important;
    text-wrap: balance;
  }
  .auth-form {
    display: grid;
    gap: 14px;
  }
  label {
    display: grid;
    gap: 6px;
    font-size: 14px;
    font-weight: 600;
  }
  label :global(input) {
    height: 44px;
    font-size: 16px;
  }
  .auth-hint {
    color: var(--muted-foreground);
    font-weight: 400;
    font-size: 13px;
  }
  :global(.auth-dialog .auth-x),
  :global(.auth-dialog .auth-submit) {
    width: 100%;
    height: 46px;
    border-radius: 12px;
    font-weight: 700;
  }
  .auth-divider {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 0;
    color: var(--muted-foreground);
    font-size: 13px;
  }
  .auth-divider::before,
  .auth-divider::after {
    content: "";
    flex: 1;
    height: 1px;
    background: var(--border);
  }
  .auth-notice {
    margin: 0;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--muted);
    font-size: 14px;
  }
  .with-close {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  .with-close p {
    flex: 1;
    margin: 0;
  }
  .auth-error {
    margin: 0;
    color: var(--destructive);
    font-size: 14px;
  }
  .auth-foot {
    margin: 0;
    color: var(--muted-foreground);
    font-size: 14px;
    text-align: center;
  }
  .auth-foot a {
    color: var(--primary);
    font-weight: 700;
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.auth-dialog[data-state]),
    :global(.landing [data-slot="dialog-overlay"][data-state]),
    .peek :global(.mascot) {
      animation: none !important;
    }
  }
</style>
