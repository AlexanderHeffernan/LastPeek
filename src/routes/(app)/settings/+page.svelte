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
  import AgentConnections from "$lib/components/AgentConnections.svelte";
  import BrowserSessions from "$lib/components/BrowserSessions.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import { notificationKinds } from "$lib/notifications";
  let { data, form } = $props();
  let confirmPhotoRemoval: ConfirmDialog;
  const sections = $derived([
    { id: "profile", label: "Profile", icon: "users" },
    { id: "connections", label: "Connections", icon: "link" },
    ...(data.agentsEnabled
      ? [{ id: "agents", label: "Agents", icon: "agents" }]
      : []),
    { id: "notifications", label: "Notifications", icon: "bell" },
    { id: "allowances", label: "Allowances", icon: "chart" },
    { id: "security", label: "Security", icon: "lock" },
  ]);
  const selected = $derived(
    sections.find((section) => section.id === page.url.searchParams.get("tab"))
      ?.id ||
      sections.find((section) => page.url.searchParams.has(`/${section.id}`))
        ?.id ||
      (page.url.searchParams.has("x") ||
      page.url.searchParams.has("/importX") ||
      page.url.searchParams.has("/disconnectX")
        ? "connections"
        : page.url.searchParams.get("tab") === "password" ||
            page.url.searchParams.has("/password") ||
            page.url.searchParams.has("/revokeSession")
          ? "security"
          : "profile"),
  );
  const detailOpen = $derived(
    [...page.url.searchParams.keys()].some(
      (key) => key === "tab" || key === "x" || key.startsWith("/"),
    ),
  );
  let hydrated = $state(false);
  onMount(() => {
    hydrated = true;
  });
  let name = $state(untrack(() => data.user.name));
  let photo = $state<File>();
  let photoInput = $state<HTMLInputElement | null>(null);
  let photoPreview = $state("");
  let photoFailed = $state(false);
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
    name !== data.user.name || !!photo || removePhoto,
  );
  const dirty = $derived(
    profileDirty || notificationsDirty || !!currentPassword || !!newPassword,
  );
  $effect(() => {
    name = data.user.name;
  });
  $effect(() => {
    photoFailed = false;
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
  const mb = (bytes: number) =>
    (bytes / 1024 / 1024).toLocaleString("en-NZ", {
      maximumFractionDigits: 1,
    });
  const periodDate = (date: string) =>
    new Date(date).toLocaleDateString("en-NZ", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  const usagePercent = (used: number, limit: number) =>
    limit ? `${Math.round((used / limit) * 100)}% used` : "No allowance";
</script>

<ConfirmDialog bind:this={confirmPhotoRemoval} />

<svelte:window
  onbeforeunload={(event) => {
    if (dirty || profileBusy || passwordBusy || notificationsBusy) {
      event.preventDefault();
      event.returnValue = "";
    }
  }}
/>
<svelte:head><title>Settings · LastPeek</title></svelte:head>
<main class="settings" class:detail-open={detailOpen} aria-label="Settings">
  <aside class="settings-sidebar">
    <header class="settings-index-heading">
      <Button
        variant="ghost"
        class="icon-button"
        href="/"
        aria-label="Back to drafts"><Icon name="back" size={24} /></Button
      >
      <h1>Settings</h1>
    </header>
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
      <Button variant="outline" type="submit">Sign out</Button>
    </form>
  </aside>
  <div class="settings-body">
    <header class="settings-detail-heading">
      <Button
        variant="ghost"
        class="icon-button"
        href={selected === "agents" && page.url.searchParams.has("edit")
          ? "/settings?tab=agents"
          : "/settings"}
        aria-label={selected === "agents" && page.url.searchParams.has("edit")
          ? "Back to agents"
          : "Back to settings"}><Icon name="back" size={24} /></Button
      >
      <h2 id={`${selected}-heading`}>
        {selected === "agents" && page.url.searchParams.has("edit")
          ? "Permissions"
          : sections.find((section) => section.id === selected)?.label}
      </h2>
      {#if selected === "allowances"}<span class="allowance-plan"
          >{data.usage.plan === "pro" ? "Pro" : "Free"} plan</span
        >{/if}
    </header>
    {#if selected === "agents" && data.agentConnections}
      <AgentConnections data={data.agentConnections} {form} />
    {/if}
    <section
      hidden={selected !== "notifications"}
      aria-labelledby="notifications-heading"
    >
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
      {#if selected === "notifications"}<PushControl
          devices={data.pushDevices}
        />{/if}
    </section>
    <section hidden={selected !== "profile"} aria-labelledby="profile-heading">
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
        <fieldset
          disabled={profileBusy}
          class="profile-fields profile-identity"
        >
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
                >{#if !photoFailed && (photoPreview || (data.user.avatar_id && !removePhoto))}<img
                    src={photoPreview || avatarURL(data.user.avatar_id!)}
                    alt=""
                    onerror={() => {
                      photoFailed = true;
                    }}
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
                variant="secondary"
                class="remove-photo"
                aria-label="Remove photo"
                title="Remove photo"
                type="button"
                onclick={async () => {
                  if (
                    !(await confirmPhotoRemoval.ask({
                      title: "Remove profile photo?",
                      description:
                        "Your initial will replace your photo when you save your profile.",
                      confirmLabel: "Remove photo",
                      cancelLabel: "Keep photo",
                    }))
                  )
                    return;
                  photo = undefined;
                  removePhoto = !!data.user.avatar_id;
                  if (photoInput) photoInput.value = "";
                  profileSaved = false;
                }}><Icon name="close" size={16} /></Button
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
              placeholder="Your display name"
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
    <section
      class="allowances"
      hidden={selected !== "allowances"}
      aria-label="Allowances"
    >
      <div
        class="allowance-group"
        role="group"
        aria-labelledby="capacity-heading"
      >
        <h3 id="capacity-heading">Saved capacity</h3>
        {#each [{ label: "Saved drafts", icon: "drafts", used: data.usage.drafts, limit: data.usage.limits.drafts, value: `${data.usage.drafts} / ${data.usage.limits.drafts}` }, { label: "Media storage", icon: "image", used: data.used, limit: data.limit, value: `${mb(data.used)} / ${mb(data.limit)} MB` }] as item}
          <div class="allowance-row" class:at-limit={item.used >= item.limit}>
            <Icon name={item.icon} size={22} />
            <div class="allowance-meter">
              <div class="allowance-label">
                <span>{item.label}</span><span class="allowance-value"
                  >{item.value}</span
                >
              </div>
              <progress
                value={Math.min(item.used, item.limit)}
                max={item.limit || 1}
                aria-label={`${item.label} used`}
                aria-valuetext={`${item.value} used`}
              ></progress>
              {#if item.used >= item.limit}
                <p class="allowance-hint">
                  {item.label === "Saved drafts"
                    ? "Delete a draft to make room."
                    : "Delete drafts with media to make room."}
                  <a href="/">View drafts</a>
                </p>
              {/if}
            </div>
          </div>
        {/each}
      </div>
      {#if data.usage.plan === "pro"}
        <div
          class="allowance-group"
          role="group"
          aria-labelledby="monthly-heading"
        >
          <h3 id="monthly-heading">Monthly usage</h3>
          <p class="allowance-period">
            {periodDate(data.usage.start)} – {periodDate(data.usage.end)} · UTC
          </p>
          {#each [{ label: "AI feedback", icon: "sparkle", used: data.usage.ai, limit: data.usage.limits.ai_usd }, { label: "X features", icon: "x", used: data.usage.x, limit: data.usage.limits.x_usd }] as item}
            <div class="allowance-row" class:at-limit={item.used >= item.limit}>
              <Icon name={item.icon} size={22} />
              <div class="allowance-meter">
                <div class="allowance-label">
                  <span>{item.label}</span>
                  <span class="allowance-value"
                    >{usagePercent(item.used, item.limit)}</span
                  >
                </div>
                <progress
                  value={Math.min(item.used, item.limit)}
                  max={item.limit || 1}
                  aria-label={`${item.label} used`}
                  aria-valuetext={usagePercent(item.used, item.limit)}
                ></progress>
                {#if item.limit > 0 && item.used >= item.limit}<p
                    class="allowance-hint"
                  >
                    Allowance used for this period.
                  </p>{/if}
              </div>
            </div>
          {/each}
          {#if data.usage.downgradeAtEnd}<p class="allowance-change">
              Free starts {periodDate(data.usage.end)}. Existing drafts and
              feedback stay available.
            </p>{:else if JSON.stringify(data.usage.limits) !== JSON.stringify(data.usage.nextLimits)}
            <p class="allowance-change">
              Your allowances change on {periodDate(data.usage.end)}.
            </p>
          {/if}
        </div>
      {/if}
    </section>
    <section hidden={selected !== "security"} aria-label="Security">
      <BrowserSessions
        sessions={data.browserSessions}
        confirmation={form?.sessionConfirmation}
        error={form?.sessionError}
        errorTarget={form?.sessionTarget}
      />
      <h3 class="security-password-heading">Password</h3>
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
                placeholder="Enter your current password"
                required
                maxlength={256}
              /></label
            >{/if}<label
            >New password<Input
              type="password"
              name="password"
              bind:value={newPassword}
              placeholder="At least 12 characters"
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
        {#if passwordError || (selected === "security" && form?.message && page.status >= 400)}<p
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
                    selected === "security")
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
