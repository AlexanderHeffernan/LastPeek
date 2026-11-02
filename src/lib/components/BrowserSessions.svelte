<script lang="ts">
  import { enhance } from "$app/forms";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { relativeTime } from "$lib/contracts";
  import type { PageData } from "../../routes/(app)/settings/$types";

  let {
    sessions,
    confirmation,
    error = "",
    errorTarget,
  }: {
    sessions: PageData["browserSessions"];
    confirmation?: string;
    error?: string;
    errorTarget?: string;
  } = $props();
  let confirm: ConfirmDialog;
  let busy = $state("");
  let localError = $state("");
  let localTarget = $state("");
  const otherSessions = $derived(
    sessions.filter((session) => !session.current),
  );
  const targetLabel = (target: string) =>
    sessions.find((session) => session.id === target)?.label || "this browser";
  const description = (target: string) =>
    target === "others"
      ? "Your other browsers will need to sign in again. This session stays signed in."
      : `${targetLabel(target)} will need to sign in again. This session stays signed in.`;
  const title = (target: string) =>
    target === "others"
      ? "Sign out other sessions?"
      : `Sign out ${targetLabel(target)}?`;
</script>

<ConfirmDialog bind:this={confirm} />
<div
  class="browser-sessions"
  role="group"
  aria-label="Signed-in browsers"
  aria-busy={!!busy}
>
  <h3>Signed-in browsers</h3>
  <form
    class="session-actions"
    method="POST"
    action="?/revokeSession"
    use:enhance={async ({ formData, cancel }) => {
      const target = String(formData.get("session") || "");
      if (busy) {
        cancel();
        return;
      }
      if (
        !(await confirm.ask({
          title: title(target),
          description: description(target),
          confirmLabel:
            target === "others" ? "Sign out others" : "Sign out browser",
        }))
      ) {
        cancel();
        return;
      }
      formData.set("confirmed", "yes");
      busy = target;
      localError = "";
      localTarget = target;
      return async ({ result, update }) => {
        try {
          if (result.type === "error")
            localError = "Couldn’t sign out this session. Try again.";
          else await update({ reset: false, navigate: false });
        } finally {
          busy = "";
        }
      };
    }}
  >
    <ul class="session-list">
      {#each sessions as session (session.id)}
        <li>
          <div class="session-row">
            <Icon
              name={/iOS|Android/.test(session.label) ? "mobile" : "monitor"}
              size={20}
            />
            <div class="session-details">
              <div class="session-name">
                <strong>{session.label}</strong>
                {#if session.current}<Badge variant="outline"
                    >This session</Badge
                  >{/if}
              </div>
              <span class="small muted">
                {#if session.current && session.createdAt}
                  Signed in {relativeTime(session.createdAt).replace(
                    "Just now",
                    "just now",
                  )}
                {:else if session.lastUsedAt}
                  Last used {relativeTime(session.lastUsedAt).replace(
                    "Just now",
                    "just now",
                  )}
                {:else}
                  Last used unknown
                {/if}
              </span>
            </div>
            {#if !session.current}
              <Button
                type="submit"
                name="session"
                value={session.id}
                variant="outline"
                disabled={!!busy}
                aria-label={`Sign out ${session.label}`}
                >{busy === session.id ? "Signing out…" : "Sign out"}</Button
              >
            {/if}
          </div>
          {#if (localError && localTarget === session.id) || (error && errorTarget === session.id)}
            <p class="action-error" role="alert">{localError || error}</p>
          {/if}
        </li>
      {/each}
    </ul>
    {#if otherSessions.length}
      <Button
        type="submit"
        name="session"
        value="others"
        variant="outline"
        class="session-revoke-all"
        disabled={!!busy}
        >{busy === "others"
          ? "Signing out…"
          : "Sign out other sessions"}</Button
      >
    {/if}
    {#if (localError && localTarget === "others") || (error && !sessions.some((session) => session.id === errorTarget))}
      <p class="action-error" role="alert">{localError || error}</p>
    {/if}
  </form>
  {#if confirmation}
    <form method="POST" action="?/revokeSession" class="session-confirmation">
      <h4>{title(confirmation)}</h4>
      <p class="small muted">{description(confirmation)}</p>
      <input type="hidden" name="session" value={confirmation} />
      <input type="hidden" name="confirmed" value="yes" />
      <div>
        <Button variant="outline" href="?tab=security">Cancel</Button>
        <Button type="submit" variant="destructive"
          >Sign out {confirmation === "others" ? "others" : "browser"}</Button
        >
      </div>
    </form>
  {/if}
</div>

<style>
  h3 {
    margin: 0 0 16px;
    font-size: 16px;
    font-weight: 600;
  }
  :global(.settings) form.session-actions {
    display: block;
  }
  .session-list {
    list-style: none;
    padding: 0;
    margin: 0 0 16px;
  }
  .session-list li {
    border-bottom: 1px solid var(--border);
    padding: 16px 0;
  }
  .session-list li:first-child {
    border-top: 1px solid var(--border);
  }
  .session-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .session-details {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 4px;
  }
  .session-name {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 8px;
  }
  strong {
    font-size: 14px;
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .session-row :global(button) {
    min-height: 44px;
    flex-shrink: 0;
  }
  .session-row :global(svg) {
    flex-shrink: 0;
  }
  :global(.session-revoke-all) {
    color: var(--destructive);
    min-height: 44px;
  }
  .session-confirmation {
    margin-top: 20px;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: 12px;
  }
  .session-confirmation h4 {
    margin: 0 0 8px;
  }
  .session-confirmation > div {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }
  @media (max-width: 600px) {
    :global(.session-revoke-all) {
      width: 100%;
    }
  }
</style>
