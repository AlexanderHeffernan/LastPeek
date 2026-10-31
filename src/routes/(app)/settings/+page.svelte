<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import { Popover } from "bits-ui";
  import { enhance } from "$app/forms";
  import { beforeNavigate } from "$app/navigation";
  import { page } from "$app/state";
  import { onMount, untrack } from "svelte";
  import { avatarURL } from "$lib/contracts";
  import Icon from "$lib/components/Icon.svelte";
  import PushControl from "$lib/components/PushControl.svelte";
  import { notificationKinds } from "$lib/notifications";
  let { data, form } = $props();
  const sections = [
    { id: "profile", label: "Profile", icon: "users" },
    { id: "connections", label: "Connections", icon: "link" },
    { id: "notifications", label: "Notifications", icon: "bell" },
    { id: "allowances", label: "Allowances", icon: "chart" },
    { id: "password", label: "Password", icon: "lock" },
  ];
  const selected = $derived(
    sections.find((section) => section.id === page.url.searchParams.get("tab"))
      ?.id ||
      (page.url.searchParams.has("/password")
        ? "password"
        : page.url.searchParams.has("x")
          ? "connections"
          : "profile"),
  );
  let hydrated = $state(false);
  onMount(() => {
    hydrated = true;
  });
  let name = $state(untrack(() => data.user.name));
  let handle = $state(untrack(() => data.user.handle));
  let photo = $state<File>();
  let photoInput = $state<HTMLInputElement | null>(null);
  let photoPreview = $state("");
  let removePhoto = $state(false);
  let profileBusy = $state(false);
  let profileError = $state("");
  let profileSaved = $state(false);
  let currentPassword = $state("");
  let newPassword = $state("");
  let passwordBusy = $state(false);
  let passwordError = $state("");
  let passwordSaved = $state(false);
  let preferences = $state(
    untrack(() => ({ ...data.notificationPreferences })),
  );
  let notificationsBusy = $state(false),
    notificationsError = $state("");
  const notificationsDirty = $derived(
    notificationKinds.some(
      (kind) => preferences[kind.id] !== data.notificationPreferences[kind.id],
    ),
  );
  $effect(() => {
    preferences = { ...data.notificationPreferences };
  });
  const profileDirty = $derived(
    name !== data.user.name ||
      handle !== data.user.handle ||
      !!photo ||
      removePhoto,
  );
  const dirty = $derived(
    profileDirty || notificationsDirty || !!currentPassword || !!newPassword,
  );
  $effect(() => {
    name = data.user.name;
    handle = data.user.handle;
  });
  $effect(() => {
    if (!photo) {
      photoPreview = "";
      return;
    }
    const url = URL.createObjectURL(photo);
    photoPreview = url;
    return () => URL.revokeObjectURL(url);
  });
  function canLeave() {
    return (
      !(dirty || profileBusy || passwordBusy || notificationsBusy) ||
      confirm("You have unsaved changes. Discard them and leave settings?")
    );
  }
  function discardEdits() {
    name = data.user.name;
    handle = data.user.handle;
    photo = undefined;
    removePhoto = false;
    if (photoInput) photoInput.value = "";
    currentPassword = "";
    newPassword = "";
    profileError = "";
    passwordError = "";
    preferences = { ...data.notificationPreferences };
  }
  beforeNavigate(({ cancel, type }) => {
    // The browser handles full-page exits through beforeunload.
    if (type !== "leave") {
      if (!canLeave()) cancel();
      else discardEdits();
    }
  });
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
  const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
</script>

<svelte:window
  onbeforeunload={(event) => {
    if (dirty || profileBusy || passwordBusy || notificationsBusy) {
      event.preventDefault();
      event.returnValue = "";
    }
  }}
/>
<svelte:head><title>Settings · LastPeek</title></svelte:head>
<main class="settings" aria-label="Settings">
  <aside class="settings-sidebar">
    <h1>Settings</h1>
    <nav aria-label="Settings sections">
      {#each sections as section}
        <Button
          variant="ghost"
          href={`?tab=${section.id}`}
          aria-current={selected === section.id ? "page" : undefined}
        >
          <Icon name={section.icon} size={20} />{section.label}<Icon
            name="arrow"
            size={16}
          />
        </Button>
      {/each}
    </nav>
    <form
      method="POST"
      action="?/logout"
      use:enhance={({ cancel }) => {
        if (!canLeave()) {
          cancel();
          return;
        }
        discardEdits();
      }}
    >
      <Button variant="ghost" type="submit">Sign out</Button>
    </form>
  </aside>
  <div class="settings-body">
    <section
      hidden={selected !== "notifications"}
      aria-labelledby="notifications-heading"
    >
      <h2 id="notifications-heading">Notifications</h2>
      <p class="small muted">
        Choose what appears in your inbox and on devices with push enabled.
      </p>
      <form
        method="POST"
        action="?/notifications"
        class="notification-preferences"
        use:enhance={() => {
          notificationsBusy = true;
          notificationsError = "";
          return async ({ result, update }) => {
            try {
              if (result.type === "success")
                await update({ reset: false, navigate: false });
              else notificationsError = "Couldn’t save preferences. Try again.";
            } finally {
              notificationsBusy = false;
            }
          };
        }}
      >
        {#each notificationKinds as kind}
          <label class="notification-preference"
            ><Checkbox
              name={kind.id}
              bind:checked={preferences[kind.id]}
              disabled={notificationsBusy}
            />{kind.label}</label
          >
        {/each}
        {#if notificationsError}<p class="action-error" role="alert">
            {notificationsError}
          </p>{/if}
        <Button type="submit" disabled={notificationsBusy}
          >{notificationsBusy
            ? "Saving…"
            : form?.notificationsSaved && !notificationsDirty
              ? "Saved"
              : "Save preferences"}</Button
        >
      </form>
      {#if selected === "notifications"}<PushControl />{/if}
    </section>
    <section hidden={selected !== "profile"} aria-labelledby="profile-heading">
      <h2 id="profile-heading">Profile</h2>
      <p class="small muted">Your identity in post previews.</p>
      <form
        method="POST"
        action="?/profile"
        enctype="multipart/form-data"
        use:enhance={({ formData }) => {
          if (photo) formData.set("photo", photo);
          profileBusy = true;
          profileError = "";
          profileSaved = false;
          return async ({ result, update }) => {
            try {
              if (result.type === "success") {
                photo = undefined;
                removePhoto = false;
                if (photoInput) photoInput.value = "";
                await update({ reset: false, navigate: false });
                profileSaved = true;
              } else {
                profileError =
                  result.type === "failure"
                    ? String(
                        result.data?.message ||
                          "Couldn’t save your profile. Try again.",
                      )
                    : "Couldn’t save your profile. Try again.";
              }
            } finally {
              profileBusy = false;
            }
          };
        }}
      >
        <fieldset disabled={profileBusy} class="profile-fields">
          <div class="profile-photo">
            <Button
              variant="ghost"
              class="photo-picker"
              type="button"
              aria-label={data.user.avatar_id || photo
                ? "Change photo"
                : "Add photo"}
              onclick={() => photoInput?.click()}
            >
              <span class="avatar" aria-hidden="true"
                >{#if photoPreview || (data.user.avatar_id && !removePhoto)}<img
                    src={photoPreview || avatarURL(data.user.avatar_id!)}
                    alt=""
                  />{:else}{name.slice(0, 1).toUpperCase()}{/if}</span
              >
              <span class="photo-picker-overlay" aria-hidden="true"
                ><Icon name="image" size={26} /></span
              >
            </Button>
            <Input
              bind:ref={photoInput}
              type="file"
              name="photo"
              hidden
              aria-label="Upload avatar"
              accept="image/jpeg,image/png,image/webp,image/avif"
              onchange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (!file) return;
                profileError = "";
                profileSaved = false;
                if (file.size > 5 * 1024 * 1024) {
                  profileError = "Choose an avatar smaller than 5 MB.";
                  event.currentTarget.value = "";
                  return;
                }
                photo = file;
                removePhoto = false;
              }}
            />
            {#if photo || (data.user.avatar_id && !removePhoto)}<Button
                variant="outline"
                type="button"
                onclick={() => {
                  photo = undefined;
                  removePhoto = !!data.user.avatar_id;
                  if (photoInput) photoInput.value = "";
                  profileSaved = false;
                }}>Remove photo</Button
              >{/if}
          </div>
          <input
            type="hidden"
            name="removePhoto"
            value={removePhoto ? "yes" : ""}
          />
          <label
            >Display name<Input
              name="name"
              bind:value={name}
              required
              maxlength={80}
              autocomplete="name"
            /></label
          >
          <label
            >X handle<Input
              name="handle"
              bind:value={handle}
              placeholder="@yourname"
              maxlength={16}
            /></label
          >
        </fieldset>
        {#if profileError || (selected === "profile" && form?.message && page.status >= 400)}<p
            class="action-error"
            role="status"
          >
            {profileError || form?.message}
          </p>{/if}
        {#if data.xPhotoImportFailed && !data.user.avatar_id}<p
            class="action-error"
            role="alert"
          >
            Couldn’t import your X photo. Upload a photo instead.
          </p>{/if}
        <div class="settings-save">
          <span class="small muted" role="status"
            >{profileDirty
              ? "Unsaved changes"
              : profileSaved
                ? "Profile saved."
                : ""}</span
          >
          <Button
            type="submit"
            variant={profileDirty ? "default" : "outline"}
            disabled={(hydrated && !profileDirty) || profileBusy}
            >{profileBusy ? "Saving…" : "Save profile"}</Button
          >
        </div>
      </form>
    </section>
    <section
      class="connections"
      hidden={selected !== "connections"}
      aria-label="Connections"
    >
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
                        await update({ navigate: false });
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
                  Set a password in Password settings before disconnecting X.
                </p>{/if}
              {#if xConnectionError}<p class="action-error" role="alert">
                  {xConnectionError}
                </p>{/if}
            </Popover.Content>
          </Popover.Root>
        {:else if data.xEnabled}
          <form method="POST" action="/auth/x/start">
            <Button variant="outline" type="submit" aria-label="Link X account"
              >Connect</Button
            >
          </form>
        {/if}
      </div>
    </section>
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
          <span class="connection-success"><Icon name="check" size={20} /></span
          >
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
    <section hidden={selected !== "allowances"} aria-label="Allowances">
      <h2>Allowances</h2>
      <h3>{data.usage.plan === "pro" ? "Pro" : "Free"} plan</h3>
      <p>{data.usage.drafts} of {data.usage.limits.drafts} drafts used.</p>
      {#if data.usage.plan === "pro"}
        <p class="small muted">
          Allowance renews {new Date(data.usage.end).toLocaleDateString()}.
        </p>
        {#each [["AI allowance", data.usage.ai, data.usage.limits.ai_usd], ["X allowance", data.usage.x, data.usage.limits.x_usd]] as [label, used, limit]}
          <label>
            {label} · {Number(limit)
              ? Math.round((Number(used) / Number(limit)) * 100)
              : 100}% used
            <progress
              value={Number(used)}
              max={Number(limit) || 1}
              aria-label={String(label)}
            ></progress>
          </label>
        {/each}
        {#if data.usage.downgradeAtEnd}<p>
            Free starts {new Date(data.usage.end).toLocaleDateString()}.
            Existing drafts and feedback stay available.
          </p>{/if}
        {#if JSON.stringify(data.usage.limits) !== JSON.stringify(data.usage.nextLimits)}
          <h3>Next period’s allowances</h3>
          <p>
            {data.usage.nextLimits.drafts} drafts · {data.usage.nextLimits
              .storage_mb} MB storage · {data.usage.nextLimits.upload_mb} MB per upload.
          </p>
          <p>
            AI: US${data.usage.nextLimits.ai_usd} · X: US${data.usage.nextLimits
              .x_usd} per period.
          </p>
        {/if}
      {/if}
      <h3>Media storage</h3>
      <p class="small muted">{mb(data.used)} MB of {mb(data.limit)} MB used.</p>
      <progress
        value={data.used}
        max={data.limit}
        aria-label="Media storage used"
      ></progress>
    </section>
    <section hidden={selected !== "password"} aria-label="Password">
      <h2>{data.hasPassword ? "Change your password" : "Set a password"}</h2>
      <form
        method="POST"
        action="?/password"
        use:enhance={() => {
          passwordBusy = true;
          passwordError = "";
          passwordSaved = false;
          return async ({ result, update }) => {
            try {
              if (result.type === "success") {
                currentPassword = "";
                newPassword = "";
                await update({ reset: false, navigate: false });
                passwordSaved = true;
              } else {
                passwordError =
                  result.type === "failure"
                    ? String(
                        result.data?.message ||
                          "Couldn’t update your password. Try again.",
                      )
                    : "Couldn’t update your password. Try again.";
              }
            } finally {
              passwordBusy = false;
            }
          };
        }}
      >
        <fieldset class="profile-fields" disabled={passwordBusy}>
          {#if data.hasPassword}<label
              >Current password<Input
                type="password"
                name="current"
                bind:value={currentPassword}
                autocomplete="current-password"
                required
                maxlength={256}
              /></label
            >{/if}<label
            >New password<Input
              type="password"
              name="password"
              bind:value={newPassword}
              minlength={12}
              maxlength={256}
              autocomplete="new-password"
              required
            /></label
          >
        </fieldset>
        <span class="small muted"
          >At least 12 characters. Changing it signs out your other sessions.</span
        >
        {#if passwordError || (selected === "password" && form?.message && page.status >= 400)}<p
            class="action-error"
            role="alert"
          >
            {passwordError || form?.message}
          </p>{/if}
        <div class="settings-save">
          <span class="small muted" role="status"
            >{currentPassword || newPassword
              ? "Unsaved changes"
              : passwordSaved ||
                  (page.status === 200 &&
                    form?.message &&
                    selected === "password")
                ? "Password changed. Other sessions have been signed out."
                : ""}</span
          >
          <Button
            type="submit"
            variant={newPassword ? "default" : "outline"}
            disabled={passwordBusy ||
              (hydrated &&
                (!newPassword || (data.hasPassword && !currentPassword)))}
            >{passwordBusy
              ? "Saving…"
              : data.hasPassword
                ? "Update password"
                : "Set password"}</Button
          >
        </div>
      </form>
    </section>
  </div>
</main>
