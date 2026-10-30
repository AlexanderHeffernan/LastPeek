<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { enhance } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import { avatarURL } from "$lib/contracts";
  import Icon from "$lib/components/Icon.svelte";
  let { data, form } = $props();
  let copied = $state(false);
  let avatarBusy = $state(false),
    avatarError = $state(""),
    avatarMessage = $state("");
  async function updateAvatar(file?: File) {
    avatarError = "";
    avatarMessage = "";
    if (file && file.size > 5 * 1024 * 1024) {
      avatarError = "Choose an avatar smaller than 5 MB.";
      return;
    }
    avatarBusy = true;
    try {
      const response = await fetch("/api/profile/avatar", {
        method: file ? "POST" : "DELETE",
        body: file,
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.message || "Avatar upload failed. Try again.");
      await invalidateAll();
      avatarMessage = file ? "Avatar updated." : "Avatar removed.";
    } catch (e) {
      avatarError = (e as Error).message;
    } finally {
      avatarBusy = false;
    }
  }
  const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
</script>

<svelte:head><title>Your account · LastPeek</title></svelte:head>
<main class="page settings">
  <h1>Account.</h1>
  <p class="muted small">{data.user.name} · {data.user.email}</p>
  {#if form?.message}<p class="notice" role="status">{form.message}</p>{/if}
  <section>
    <h2>Profile</h2>
    <p class="small muted">
      Your name, handle and photo are used to preview your posts on X.
    </p>
    <div class="profile-photo row">
      <span class="avatar" aria-hidden="true"
        >{#if data.user.avatar_id}<img
            src={avatarURL(data.user.avatar_id)}
            alt=""
          />{:else}{data.user.name.slice(0, 1).toUpperCase()}{/if}</span
      >
      <div>
        <label class="avatar-upload"
          >{avatarBusy ? "Updating…" : "Change photo"}<Input
            type="file"
            aria-label="Upload avatar"
            disabled={avatarBusy}
            accept="image/jpeg,image/png,image/webp,image/avif"
            onchange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void updateAvatar(file);
              event.currentTarget.value = "";
            }}
          /></label
        >
        <p class="small muted">Up to 5 MB · Cropped to a square</p>
      </div>
      {#if data.user.avatar_id}<Button
          variant="ghost"
          disabled={avatarBusy}
          onclick={() => updateAvatar()}>Remove photo</Button
        >{/if}
    </div>
    {#if avatarError}<p class="notice error" role="alert">{avatarError}</p>{/if}
    {#if avatarMessage}<p class="small muted" role="status">
        {avatarMessage}
      </p>{/if}
    <form method="POST" action="?/profile" use:enhance>
      <label
        >Display name<Input
          name="name"
          value={data.user.name}
          required
          maxlength={80}
          autocomplete="name"
        /></label
      >
      <label
        >X handle<Input
          name="handle"
          value={data.user.handle}
          placeholder="@yourname"
          maxlength={16}
        /></label
      >
      <Button variant="outline" type="submit">Save profile</Button>
    </form>
  </section>
  <section>
    <h2>Media storage</h2>
    <p class="small muted">{mb(data.used)} MB of {mb(data.limit)} MB used.</p>
    <progress value={data.used} max={data.limit} aria-label="Media storage used"
    ></progress>
  </section>
  {#if data.user.is_admin}<section>
      <h2>Invitations</h2>
      <p class="small muted">Single-use · Valid for 7 days</p>
      <form method="POST" action="?/invite" use:enhance>
        <Button variant="default" type="submit"
          ><Icon name="plus" size={15} />Create invitation</Button
        >
      </form>
      {#if form?.inviteURL}<div class="notice" style="margin:16px 0">
          <label
            >Invitation link<Input
              readonly
              value={form.inviteURL}
              onclick={(e) => e.currentTarget.select()}
            /></label
          ><Button
            variant="outline"
            style="margin-top:10px"
            onclick={async () => {
              try {
                await navigator.clipboard.writeText(form.inviteURL!);
                copied = true;
              } catch {
                copied = false;
              }
            }}>{copied ? "Copied" : "Copy invitation"}</Button
          >
          <p class="small muted" style="margin:8px 0 0">
            Save this link. It’s only shown once.
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
                <input type="hidden" name="id" value={invite.id} /><Button
                  variant="destructive"
                  type="submit"
                  class="danger">Revoke invitation</Button
                >
              </form>{/if}
          </div>{/each}
      </div>
    </section>{/if}
  <section>
    <h2>Change your password</h2>
    <form method="POST" action="?/password" use:enhance>
      <label
        >Current password<Input
          type="password"
          name="current"
          autocomplete="current-password"
          required
          maxlength={256}
        /></label
      ><label
        >New password<Input
          type="password"
          name="password"
          minlength={12}
          maxlength={256}
          autocomplete="new-password"
          required
        /></label
      ><span class="small muted"
        >At least 12 characters. Changing it signs out your other sessions.</span
      ><Button variant="outline" type="submit">Update password</Button>
    </form>
  </section>
  <form method="POST" action="?/logout" use:enhance>
    <Button variant="ghost" type="submit">Sign out</Button>
  </form>
</main>
