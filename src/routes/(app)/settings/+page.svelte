<script lang="ts">
  import { enhance } from "$app/forms";
  import Icon from "$lib/components/Icon.svelte";
  let { data, form } = $props();
  let copied = $state(false);
  const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
</script>

<svelte:head><title>Your account · LastPeek</title></svelte:head>
<main class="page settings">
  <a class="breadcrumb row" href="/"
    ><Icon name="back" size={14} />Your drafts</a
  >
  <h1 style="margin-top:24px">Your little corner.</h1>
  <p class="muted small">{data.user.name} · {data.user.email}</p>
  {#if form?.message}<p class="notice" role="status">{form.message}</p>{/if}
  <section>
    <h2>Media storage</h2>
    <p class="small muted">{mb(data.used)} MB of {mb(data.limit)} MB used.</p>
    <progress value={data.used} max={data.limit} aria-label="Media storage used"
    ></progress>
    <p class="small muted" style="margin:8px 0 0">
      Shared versions keep their attachments. Delete an old draft to free space.
      Unattached uploads are cleaned up after 24 hours by maintenance.
    </p>
  </section>
  {#if data.user.is_admin}<section>
      <h2>Bring a friend.</h2>
      <p class="small muted">
        Invite someone to make their own drafts. Reviewing is always
        account-free. Invitations are single-use and expire in seven days.
      </p>
      <form method="POST" action="?/invite" use:enhance>
        <button class="primary"
          ><Icon name="plus" size={15} />Create invitation</button
        >
      </form>
      {#if form?.inviteURL}<div class="notice" style="margin:16px 0">
          <label
            >Invitation link<input
              readonly
              value={form.inviteURL}
              onclick={(e) => e.currentTarget.select()}
            /></label
          ><button
            style="margin-top:10px"
            onclick={async () => {
              try {
                await navigator.clipboard.writeText(form.inviteURL!);
                copied = true;
              } catch {
                copied = false;
              }
            }}>{copied ? "Copied" : "Copy invitation"}</button
          >
          <p class="small muted" style="margin:8px 0 0">
            Copy this now. For privacy, it won’t be displayed again.
          </p>
        </div>{/if}
      <div style="margin-top:20px">
        {#each data.invites as invite}<div class="invite-row">
            <span
              >{invite.used_at
                ? "Accepted"
                : invite.revoked_at
                  ? "Revoked"
                  : new Date(invite.expires_at) < new Date()
                    ? "Expired"
                    : `Expires ${new Date(invite.expires_at).toLocaleDateString()}`}</span
            >{#if !invite.used_at && !invite.revoked_at && new Date(invite.expires_at) > new Date()}<form
                method="POST"
                action="?/revoke"
                use:enhance
              >
                <input type="hidden" name="id" value={invite.id} /><button
                  class="quiet danger"
                  style="font-size:10px;min-height:28px"
                  >Revoke invitation</button
                >
              </form>{/if}
          </div>{/each}
      </div>
    </section>{/if}
  <section>
    <h2>Change your password</h2>
    <form method="POST" action="?/password" use:enhance>
      <label
        >Current password<input
          type="password"
          name="current"
          autocomplete="current-password"
          required
          maxlength="256"
        /></label
      ><label
        >New password<input
          type="password"
          name="password"
          minlength="12"
          maxlength="256"
          autocomplete="new-password"
          required
        /></label
      ><span class="small muted"
        >At least 12 characters. Changing it signs out your other sessions.</span
      ><button>Update password</button>
    </form>
  </section>
  <form method="POST" action="?/logout">
    <button class="quiet">Sign out</button>
  </form>
</main>
