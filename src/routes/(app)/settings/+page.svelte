<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import { Popover } from "bits-ui";
  import { enhance } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import { avatarURL } from "$lib/contracts";
  import Icon from "$lib/components/Icon.svelte";
  let { data, form } = $props();
  let copied = $state(false);
  let avatarBusy = $state(false),
    avatarError = $state(""),
    avatarMessage = $state("");
  let xDialog = $state<HTMLDialogElement>();
  let xForm = $state<HTMLFormElement>();
  let xKeep = $state<HTMLButtonElement | null>(null);
  let xBusy = $state(false),
    xError = $state("");
  let xPhoto = $state(false);
  let xPhotoFailed = $state(false);
  let xActionsOpen = $state(false);
  let xDisconnectBusy = $state(false);
  let xConnectionError = $state("");
  $effect(() => {
    if (xDialog && data.xImportPending && !xDialog.matches(":modal")) {
      xDialog.close();
      xDialog.showModal();
    }
  });
  function keepProfile() {
    if (!xBusy && xKeep) xForm?.requestSubmit(xKeep);
  }
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
    {#if avatarError || (data.xPhotoImportFailed && !data.user.avatar_id)}<p
        class="action-error"
        role="alert"
      >
        {avatarError || "Couldn’t import your X photo. Upload a photo instead."}
      </p>{/if}
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
  {#if data.xEnabled || data.xProfile}
    <section class="connections">
      <h2>Connections</h2>
      <div class="connection-row">
        <span class="connection-provider"><Icon name="x" size={24} /></span>
        <div class="connection-identity">
          <strong>X</strong>
          <span class="small muted"
            >{data.xProfile
              ? `@${data.xProfile.username}`
              : "Not connected"}</span
          >
          {#if data.xProfile}
            <span
              class="connection-status small"
              class:muted={data.xNeedsReconnect}
            >
              <Icon name={data.xNeedsReconnect ? "link" : "check"} size={16} />
              {data.xNeedsReconnect ? "Reconnect needed" : "Connected"}
            </span>
          {/if}
        </div>
        {#if data.xProfile}
          <Popover.Root bind:open={xActionsOpen}>
            <Popover.Trigger>
              {#snippet child({ props })}
                <Button
                  {...props}
                  variant="ghost"
                  class="icon-button"
                  aria-label="X account actions"
                  aria-busy={xDisconnectBusy}
                  ><Icon name="more" size={24} /></Button
                >
              {/snippet}
            </Popover.Trigger>
            <Popover.Content
              class="share-menu"
              align="end"
              sideOffset={8}
              aria-label="X account actions"
            >
              {#if data.xEnabled && data.xNeedsReconnect}<form
                  method="POST"
                  action="/auth/x/start"
                >
                  <Button variant="ghost" type="submit"
                    ><Icon name="link" size={16} />Reconnect X</Button
                  >
                </form>{/if}
              <form
                method="POST"
                action="?/disconnectX"
                use:enhance={() => {
                  xDisconnectBusy = true;
                  xConnectionError = "";
                  return async ({ result, update }) => {
                    try {
                      if (result.type === "error") {
                        xConnectionError = result.error.message;
                      } else {
                        await update();
                        xActionsOpen = false;
                      }
                    } finally {
                      xDisconnectBusy = false;
                    }
                  };
                }}
              >
                <Button
                  variant="ghost"
                  class="danger"
                  type="submit"
                  disabled={!data.hasPassword || xDisconnectBusy}
                  ><Icon name="link" size={16} />{xDisconnectBusy
                    ? "Disconnecting…"
                    : "Disconnect X"}</Button
                >
              </form>
              {#if !data.hasPassword}<p class="small muted">
                  Set a password below before disconnecting X.
                </p>{/if}
              {#if xConnectionError}<p class="action-error" role="alert">
                  {xConnectionError}
                </p>{/if}
            </Popover.Content>
          </Popover.Root>
        {:else}
          <form method="POST" action="/auth/x/start">
            <Button variant="outline" type="submit" aria-label="Link X account"
              >Connect</Button
            >
          </form>
        {/if}
      </div>
    </section>
  {/if}
  {#if data.xProfile && data.xImportPending}
    <dialog
      bind:this={xDialog}
      open
      class="confirm-dialog x-connected"
      aria-labelledby="x-connected-title"
      aria-describedby="x-connected-description"
      aria-busy={xBusy}
      oncancel={(event) => {
        event.preventDefault();
        keepProfile();
      }}
    >
      <div class="x-connected-heading">
        <span class="connection-success"><Icon name="check" size={20} /></span>
        <h2 id="x-connected-title">
          <span>Connected to</span><Icon name="x" size={24} /><span
            class="sr-only">X</span
          >
        </h2>
        <Button
          variant="ghost"
          class="icon-button"
          aria-label="Keep current profile and close"
          disabled={xBusy}
          onclick={keepProfile}><Icon name="close" size={20} /></Button
        >
      </div>
      <p id="x-connected-description">
        Choose what to use for your LastPeek profile.
      </p>
      <form
        bind:this={xForm}
        method="POST"
        action="?/importX"
        use:enhance={() => {
          xBusy = true;
          xError = "";
          return async ({ result, update }) => {
            try {
              if (result.type === "failure") {
                xError =
                  typeof result.data?.xImportError === "string"
                    ? result.data.xImportError
                    : "Couldn’t update your profile. Try again.";
              } else if (result.type === "error") {
                xError = "Couldn’t update your profile. Try again.";
              } else {
                await update({ reset: false });
              }
            } finally {
              xBusy = false;
            }
          };
        }}
      >
        <fieldset class="x-profile-options" disabled={xBusy}>
          <legend class="sr-only">Profile fields to update</legend>
          <label class="profile-choice">
            <span class="row">
              <span class="avatar x-photo-preview">
                {#if data.xPhotoURL && !xPhotoFailed}<img
                    src={data.xPhotoURL}
                    alt="Avatar from X"
                    referrerpolicy="no-referrer"
                    onerror={() => {
                      xPhotoFailed = true;
                      xPhoto = false;
                    }}
                  />{:else}<Icon name="image" size={24} />{/if}
              </span>
              <span
                >Profile photo{#if !data.xPhotoURL || xPhotoFailed}<span
                    class="small muted">Unavailable</span
                  >{/if}</span
              >
            </span>
            <Checkbox
              name="photo"
              aria-label="Profile photo"
              bind:checked={xPhoto}
              disabled={xBusy || !data.xPhotoURL || xPhotoFailed}
            />
          </label>
          <label class="profile-choice">
            <span
              ><span class="small muted">Display name</span><strong
                >{data.xProfile.name}</strong
              ></span
            >
            <Checkbox name="name" disabled={xBusy} />
          </label>
          <label class="profile-choice">
            <span
              ><span class="small muted">X handle</span><strong
                >@{data.xProfile.username}</strong
              ></span
            >
            <Checkbox name="handle" disabled={xBusy} />
          </label>
        </fieldset>
        {#if xError || form?.xImportError}<div
            class="action-error"
            role="alert"
          >
            {xError || form?.xImportError}
          </div>{/if}
        <div class="row x-dialog-actions">
          <Button
            bind:ref={xKeep}
            variant="ghost"
            type="submit"
            name="intent"
            value="keep"
            disabled={xBusy}>Keep current profile</Button
          >
          <Button type="submit" disabled={xBusy}
            >{xBusy ? "Saving…" : "Apply selection"}</Button
          >
        </div>
      </form>
    </dialog>
  {/if}
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
    <h2>{data.hasPassword ? "Change your password" : "Set a password"}</h2>
    <form method="POST" action="?/password" use:enhance>
      {#if data.hasPassword}<label
          >Current password<Input
            type="password"
            name="current"
            autocomplete="current-password"
            required
            maxlength={256}
          /></label
        >{/if}<label
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
      ><Button variant="outline" type="submit"
        >{data.hasPassword ? "Update password" : "Set password"}</Button
      >
    </form>
  </section>
  <form method="POST" action="?/logout" use:enhance>
    <Button variant="ghost" type="submit">Sign out</Button>
  </form>
</main>
