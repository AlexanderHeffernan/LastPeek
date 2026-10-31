<script lang="ts">
  import { goto } from "$app/navigation";
  import { tick, untrack } from "svelte";
  import { Popover } from "bits-ui";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import Icon from "$lib/components/Icon.svelte";
  import type { Feature } from "$lib/features";
  import type { AdminData, AdminView } from "$lib/admin";
  import { avatarURL } from "$lib/contracts";

  let {
    initialData,
    active = true,
    onclose,
  }: {
    initialData?: AdminData;
    active?: boolean;
    onclose?: () => void;
  } = $props();
  let data = $state<AdminData | undefined>(untrack(() => initialData));
  let refreshing = $state(false),
    saving = $state(false),
    refreshError = $state(""),
    saveError = $state("");
  let openAccount = $state<string | null>(null);
  let confirmation = $state<HTMLDialogElement>(),
    content = $state<HTMLElement>();
  let selected = $state<{
    id: string | null;
    email: string;
    enabled: boolean;
    feature?: Feature;
  } | null>(null);
  const id = $props.id();
  const views = [
    ["overview", "Overview", "overview"],
    ["accounts", "Accounts", "users"],
    ["features", "Feature flags", "flags"],
    ["usage", "API usage", "chart"],
    ["history", "Access history", "history"],
  ] as const;
  const date = (value: string) =>
    new Date(value).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  const storage = (bytes: number) =>
    `${(bytes / 1024 / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;
  const money = (value: number) =>
    `US$${value.toLocaleString("en-US", { maximumFractionDigits: 6 })}`;
  const joined = (value: string) =>
    new Date(value).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  $effect(() => {
    if (initialData) data = initialData;
  });
  $effect(() => {
    if (active && !initialData)
      untrack(() => {
        void refresh();
      });
  });

  async function refresh(
    search = data?.directory?.search || "",
    page = data?.directory?.page || 1,
    view: AdminView = data?.view || "overview",
    userId = data?.usage?.userId || "",
    period = data?.usage?.period || "month",
  ) {
    if (refreshing) return;
    refreshing = true;
    refreshError = "";
    const previous = data?.view;
    try {
      if (
        !onclose &&
        initialData &&
        (view !== data?.view ||
          search !== data.directory?.search ||
          page !== data.directory?.page ||
          userId !== (data.usage?.userId || "") ||
          period !== data.usage?.period)
      ) {
        await goto(
          `/siteadmin${view === "overview" ? "" : `/${view}`}?${new URLSearchParams({ search, page: String(page), userId, period })}`,
          { refreshAll: true, reset: false },
        );
        return;
      }
      const response = await fetch(
        `/siteadmin/snapshot?${new URLSearchParams({ search, page: String(page), view, userId, period })}`,
      );
      if (!response.ok) {
        if (response.status === 404) data = undefined;
        throw new Error();
      }
      data = await response.json();
      if (previous !== view) content?.scrollTo(0, 0);
    } catch {
      refreshError =
        "Couldn’t load site admin. Check your access and try again.";
    } finally {
      refreshing = false;
    }
  }
  async function send(command: object) {
    const response = await fetch("/siteadmin/snapshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        result.message || "Couldn’t save this change. Try again.",
      );
    await refresh();
  }
  async function updateAccess(event: SubmitEvent) {
    event.preventDefault();
    if (!selected || saving) return;
    saving = true;
    saveError = "";
    try {
      await send(
        selected.feature
          ? {
              action:
                selected.id === null ? "all-feature-access" : "feature-access",
              ...(selected.id === null ? {} : { userId: selected.id }),
              feature: selected.feature,
              enabled: selected.enabled,
              reason: String(
                new FormData(event.currentTarget as HTMLFormElement).get(
                  "reason",
                ) || "",
              ),
            }
          : {
              action: "admin-access",
              userId: selected.id,
              enabled: selected.enabled,
            },
      );
      confirmation?.close();
      selected = null;
    } catch (error) {
      saveError =
        error instanceof Error
          ? error.message
          : "Couldn’t save this change. Try again.";
    } finally {
      saving = false;
    }
  }
  async function confirm(change: NonNullable<typeof selected>) {
    openAccount = null;
    await tick();
    selected = change;
    saveError = "";
    confirmation?.showModal();
  }
</script>

<div class:standalone={!onclose} class="admin-shell">
  <header class="admin-toolbar">
    <h1>Site admin.</h1>
    {#if data?.overview}<span
        class="small muted updated"
        title={date(data.overview.captured_at)}
        >Updated {new Date(data.overview.captured_at).toLocaleTimeString(
          undefined,
          { hour: "2-digit", minute: "2-digit" },
        )}</span
      >{/if}
    <div class="row toolbar-actions">
      <Button
        variant="ghost"
        aria-label={refreshing ? "Refreshing…" : "Refresh"}
        onclick={() => refresh()}
        disabled={refreshing}><Icon name="refresh" /></Button
      >
      {#if onclose}<Button
          variant="ghost"
          aria-label="Close site admin"
          onclick={onclose}><Icon name="close" /></Button
        >{/if}
    </div>
  </header>
  <div class="admin-body">
    <nav class="admin-nav" aria-label="Site admin pages">
      {#each views as [view, label, icon]}
        <Button
          variant={data?.view === view ? "secondary" : "ghost"}
          href={`/siteadmin/${view === "overview" ? "" : view}`}
          aria-current={data?.view === view ? "page" : undefined}
          onclick={(event) => {
            if (
              onclose &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.shiftKey &&
              !event.altKey
            ) {
              event.preventDefault();
              void refresh("", 1, view, "", "month");
            }
          }}
        >
          <Icon name={icon} size={18} />{label}
        </Button>
      {/each}
    </nav>
    <main class="admin-content" bind:this={content}>
      {#if refreshError}<p class="notice error" role="alert">
          {refreshError}
        </p>{/if}
      {#if !data && refreshing}<p role="status" class="muted">
          Loading site admin…
        </p>{/if}
      {#if data?.invalidQuery}
        <p class="notice error" role="alert">
          Choose a search up to 200 characters and valid page and usage filters.
        </p>
        <Button
          variant="outline"
          onclick={() => refresh("", 1, "overview", "", "month")}
          >Clear filters</Button
        >
      {:else if data?.overview && data.directory && data.usage}
        {@const overview = data.overview}
        {#if data.view === "overview"}
          <dl class="admin-metrics">
            {#each [["Registered accounts", overview.accounts], ["Joined in the last 7 days", overview.new_accounts], ["Admin team", overview.administrators], ["Pending invitations", overview.pending_invites], ["Accepted invitations", overview.accepted_invites], ["Drafts", overview.drafts], ["Active review links", overview.review_links], ["Feedback", overview.feedback], ["Media storage", storage(overview.media_bytes)]] as [label, value]}
              <div>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            {/each}
          </dl>
          <div class="provider-grid overview-usage">
            {#each overview.usage as usage}
              <section
                class="provider"
                aria-label={`${usage.provider === "openai" ? "OpenAI" : "X"} usage this month`}
              >
                <h3>{usage.provider === "openai" ? "OpenAI" : "X"}</h3>
                <p class="cost">{money(usage.estimated_usd)}</p>
                <p class="small muted">Estimated USD · this month</p>
                <div class="row between">
                  <span class="small muted"
                    >{usage.requests.toLocaleString()} requests{#if usage.unpriced}
                      · {usage.unpriced} unpriced{/if}</span
                  >
                  <Button
                    variant="ghost"
                    aria-label={`View ${usage.provider === "openai" ? "OpenAI" : "X"} usage`}
                    onclick={() => refresh("", 1, "usage", "", "month")}
                    ><Icon name="arrow" size={18} /></Button
                  >
                </div>
              </section>
            {/each}
          </div>
          <section aria-labelledby={`${id}-service`}>
            <h3 id={`${id}-service`}>Service</h3>
            <div class="row service">
              <Badge variant="outline">Database healthy</Badge><span
                class="small muted">Revision</span
              ><code>{overview.service.revision}</code>
            </div>
          </section>
        {:else if data.view === "accounts"}
          <form
            class="admin-search"
            role="search"
            onsubmit={(event) => {
              event.preventDefault();
              void refresh(
                String(new FormData(event.currentTarget).get("search") || ""),
                1,
              );
            }}
          >
            <Input
              name="search"
              aria-label="Search accounts"
              placeholder="Search name or email"
              value={data.directory.search}
              maxlength={200}
            />
            <Button type="submit" variant="outline" disabled={refreshing}
              >Search</Button
            >
            {#if data.directory.search}<Button
                variant="ghost"
                onclick={() => refresh("", 1)}
                disabled={refreshing}>Clear</Button
              >{/if}
          </form>
          <p class="small muted" role="status">
            {data.directory.total}
            {data.directory.total === 1 ? "account" : "accounts"}
          </p>
          {#if !data.directory.users.length}<p class="muted empty">
              No accounts match this search.
            </p>{/if}
          <table class="accounts-table">
            <caption class="sr-only">Accounts</caption>
            <thead
              ><tr
                ><th scope="col">Name</th><th scope="col">Email</th><th
                  scope="col">Joined</th
                ><th scope="col">Role</th><th scope="col"
                  >API costs <span class="small muted">/ month</span></th
                ><th scope="col"><span class="sr-only">Actions</span></th></tr
              ></thead
            >
            <tbody>
              {#each data.directory.users as account (account.id)}
                <tr>
                  <th scope="row" class="account-name"
                    ><div class="row">
                      <span class="avatar" aria-hidden="true"
                        >{#if account.avatar_id}<img
                            src={avatarURL(account.avatar_id)}
                            alt=""
                            loading="lazy"
                          />{:else}{account.name
                            .slice(0, 1)
                            .toUpperCase()}{/if}</span
                      >
                      <strong>{account.name}</strong>
                    </div></th
                  >
                  <td class="account-email">{account.email}</td>
                  <td class="account-joined"
                    ><span class="mobile-label muted">Joined </span><time
                      datetime={account.created_at}
                      >{joined(account.created_at)}</time
                    ></td
                  >
                  <td class="account-role">
                    <Badge variant="outline"
                      >{account.role === "owner"
                        ? "Owner"
                        : account.role === "admin"
                          ? "Admin"
                          : "Author"}</Badge
                    >
                  </td>
                  <td class="account-costs">
                    <Button
                      variant="ghost"
                      class="account-cost-button"
                      aria-label={`API usage for ${account.email}`}
                      onclick={() => refresh("", 1, "usage", account.id)}
                    >
                      {#each account.usage as usage}<span
                          class="row between small"
                          >{usage.provider === "openai" ? "OpenAI" : "X"}
                          <strong>{money(usage.estimated_usd)}</strong
                          >{#if usage.unpriced}
                            · {usage.unpriced} unpriced{/if}</span
                        >{/each}
                    </Button>
                  </td>
                  <td class="account-actions">
                    <Popover.Root
                      open={openAccount === account.id}
                      onOpenChange={(open) => {
                        openAccount = open ? account.id : null;
                      }}
                    >
                      <Popover.Trigger
                        >{#snippet child({ props })}<Button
                            {...props}
                            variant="ghost"
                            size="icon"
                            aria-label={`Actions for ${account.email}`}
                            ><Icon name="more" /></Button
                          >{/snippet}</Popover.Trigger
                      >
                      <Popover.Content
                        class="share-menu"
                        align="end"
                        sideOffset={6}
                        aria-label={`Account actions for ${account.email}`}
                      >
                        <Button
                          variant="ghost"
                          aria-label={`Feature flags for ${account.email}`}
                          onclick={() => {
                            openAccount = null;
                            void refresh("", 1, "features", account.id);
                          }}
                          ><Icon name="flags" size={16} />Feature flags</Button
                        >
                        {#if data.isOwner && account.role !== "owner"}<Button
                            variant="ghost"
                            aria-label={`${account.is_admin ? "Remove admin access from" : "Grant admin access to"} ${account.email}`}
                            onclick={() =>
                              confirm({
                                id: account.id,
                                email: account.email,
                                enabled: !account.is_admin,
                              })}
                            >{account.is_admin
                              ? "Remove admin"
                              : "Make admin"}</Button
                          >{/if}
                      </Popover.Content>
                    </Popover.Root>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
          <nav class="row between pagination" aria-label="Account pages">
            <Button
              variant="outline"
              onclick={() =>
                refresh(undefined, (data?.directory?.page || 1) - 1)}
              disabled={refreshing || data.directory.page <= 1}>Previous</Button
            ><span class="small muted"
              >Page {data.directory.page} of {data.directory.pages}</span
            ><Button
              variant="outline"
              onclick={() =>
                refresh(undefined, (data?.directory?.page || 1) + 1)}
              disabled={refreshing ||
                data.directory.page >= data.directory.pages}>Next</Button
            >
          </nav>
        {:else if data.view === "features" && data.flags}
          {@const flags = data.flags}
          <form
            class="admin-search"
            role="search"
            onsubmit={(event) => {
              event.preventDefault();
              void refresh(
                String(new FormData(event.currentTarget).get("search") || ""),
                1,
                "features",
                "",
              );
            }}
          >
            <Input
              name="search"
              aria-label="Search users for feature flags"
              placeholder="Find a user by name or email"
              value={data.directory.search}
              maxlength={200}
            />
            <Button type="submit" variant="outline" disabled={refreshing}
              >Search</Button
            >
            {#if flags.account || data.directory.search}<Button
                variant="ghost"
                onclick={() => refresh("", 1, "features", "")}
                disabled={refreshing}>All users</Button
              >{/if}
          </form>
          {#if data.directory.search && !flags.account}
            <div class="user-results" aria-label="Matching users">
              {#each data.directory.users as account}
                <Button
                  variant="ghost"
                  onclick={() =>
                    refresh(undefined, undefined, "features", account.id)}
                  aria-label={`Select ${account.email}`}
                >
                  <span class="identity"
                    ><strong>{account.name}</strong><span class="small muted"
                      >{account.email}</span
                    ></span
                  ><Icon name="arrow" size={18} />
                </Button>
              {:else}<p class="small muted">
                  No users match this search.
                </p>{/each}
              {#if data.directory.pages > 1}<nav
                  class="row between pagination"
                  aria-label="Matching user pages"
                >
                  <Button
                    variant="outline"
                    disabled={refreshing || data.directory.page <= 1}
                    onclick={() =>
                      refresh(undefined, (data?.directory?.page || 1) - 1)}
                    >Previous</Button
                  >
                  <span class="small muted"
                    >Page {data.directory.page} of {data.directory.pages}</span
                  >
                  <Button
                    variant="outline"
                    disabled={refreshing ||
                      data.directory.page >= data.directory.pages}
                    onclick={() =>
                      refresh(undefined, (data?.directory?.page || 1) + 1)}
                    >Next</Button
                  >
                </nav>{/if}
            </div>
          {/if}
          <div class="flag-scope identity" aria-live="polite">
            <strong>{flags.account ? flags.account.name : "All users"}</strong>
            <span class="small muted"
              >{flags.account
                ? flags.account.email
                : `${flags.total} registered accounts`}</span
            >
          </div>
          <table class="flags-table">
            <caption class="sr-only"
              >Feature flags {flags.account
                ? `for ${flags.account.email}`
                : "for all users"}</caption
            >
            <thead
              ><tr
                ><th scope="col">Feature</th><th scope="col"
                  >{flags.account ? "Status" : "Enabled"}</th
                >{#if data.isOwner}<th scope="col">Actions</th>{/if}</tr
              ></thead
            >
            <tbody>
              {#each flags.flags as flag}
                <tr>
                  <th scope="row">{flag.feature}</th>
                  <td
                    >{#if flags.account}<Badge
                        variant={flag.enabled ? "secondary" : "outline"}
                        >{flag.enabled ? "Enabled" : "Disabled"}</Badge
                      >{:else}<span class="flag-count"
                        >{flag.active}
                        <span class="muted">/ {flags.total}</span></span
                      >{/if}</td
                  >
                  {#if data.isOwner}<td
                      ><div class="flag-actions">
                        {#each flags.account ? [!flag.enabled] : [true, false] as enabled}
                          <Button
                            variant="outline"
                            disabled={refreshing ||
                              (!flags.account &&
                                (enabled
                                  ? flag.active === flags.total
                                  : flag.active === 0))}
                            aria-label={`${enabled ? "Enable" : "Disable"} ${flag.feature} for ${flags.account?.email || "all users"}`}
                            onclick={() =>
                              confirm({
                                id: flags.account?.id || null,
                                email:
                                  flags.account?.email ||
                                  "All existing accounts",
                                enabled,
                                feature: flag.feature,
                              })}
                            >{enabled ? "Enable" : "Disable"}{flags.account
                              ? ""
                              : " all"}</Button
                          >
                        {/each}
                      </div></td
                    >{/if}
                </tr>
              {/each}
            </tbody>
          </table>
        {:else if data.view === "usage"}
          <div class="row between usage-filter">
            <strong class="account-filter"
              >{data.usage.account || "All accounts"}</strong
            >
            <div class="row">
              <Button
                variant={data.usage.period === "month" ? "secondary" : "ghost"}
                onclick={() =>
                  refresh(undefined, undefined, "usage", undefined, "month")}
                >This month</Button
              ><Button
                variant={data.usage.period === "all" ? "secondary" : "ghost"}
                onclick={() =>
                  refresh(undefined, undefined, "usage", undefined, "all")}
                >All time</Button
              >{#if data.usage.userId}<Button
                  variant="outline"
                  onclick={() => refresh(undefined, undefined, "usage", "")}
                  >All accounts</Button
                >{/if}
            </div>
          </div>
          <div class="provider-grid">
            {#each data.usage.providers as usage}
              <section
                class="provider"
                aria-label={`${usage.provider === "openai" ? "OpenAI" : "X"} usage`}
              >
                <h3>{usage.provider === "openai" ? "OpenAI" : "X"}</h3>
                <p class="cost">{money(usage.estimated_usd)}</p>
                <p class="small muted">
                  Estimated USD{#if usage.unpriced}
                    · {usage.unpriced} unpriced requests{/if}
                </p>
                <dl class="usage-stats">
                  <div>
                    <dt>Requests</dt>
                    <dd>{usage.requests}</dd>
                  </div>
                  <div>
                    <dt>Successful</dt>
                    <dd>{usage.successful}</dd>
                  </div>
                  <div>
                    <dt>Failed / incomplete</dt>
                    <dd>{usage.failed}</dd>
                  </div>
                  <div>
                    <dt>Pending / interrupted</dt>
                    <dd>{usage.pending}</dd>
                  </div>
                  {#if usage.provider === "openai"}<div>
                      <dt>Input tokens</dt>
                      <dd>{usage.input_tokens.toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>Cached input tokens</dt>
                      <dd>{usage.cached_input_tokens.toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>Cache write tokens</dt>
                      <dd>{usage.cache_write_tokens.toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>Output tokens</dt>
                      <dd>{usage.output_tokens.toLocaleString()}</dd>
                    </div>{:else}<div>
                      <dt>Budget reserved</dt>
                      <dd>{money(usage.reserved_usd)}</dd>
                    </div>{/if}
                </dl>
              </section>
            {/each}
          </div>
          {#if data.usage.legacyXReservedUsd}<p class="notice">
              {money(data.usage.legacyXReservedUsd)} of earlier X budget reservations
              have no per-user attribution. They are not included in estimated costs.
            </p>{/if}
        {:else}
          {#if !data.history.length}<p class="muted empty">
              No access changes recorded yet.
            </p>{:else}<ul class="history">
              {#each data.history as change}<li>
                  <strong>{change.account || "Deleted account"}</strong><span
                    >{change.kind === "admin" ? "Admin access" : change.feature} ·
                    {change.enabled ? "Granted" : "Removed"}</span
                  >{#if change.reason}<span class="small">{change.reason}</span
                    >{/if}<span class="small muted"
                    >By {change.actor || "Deleted account"} · {date(
                      change.created_at,
                    )}</span
                  >
                </li>{/each}
            </ul>{/if}
        {/if}
      {/if}
    </main>
  </div>
</div>

<dialog
  bind:this={confirmation}
  class="confirm-dialog"
  aria-labelledby={`${id}-confirmation`}
  onclose={() => {
    if (!saving) selected = null;
  }}
>
  {#if selected}<h2 id={`${id}-confirmation`}>
      {selected.feature
        ? `${selected.enabled ? "Enable" : "Disable"} ${selected.feature}?`
        : selected.enabled
          ? "Grant admin access?"
          : "Remove admin access?"}
    </h2>
    <p>{selected.email}</p>
    <p class="muted">
      {selected.feature
        ? selected.id === null
          ? "This changes the flag for all existing accounts immediately. Future signups are unchanged. Each changed account is recorded in access history."
          : "This changes the account’s feature grant immediately."
        : selected.enabled
          ? "They will be able to see account emails, usage, feature grants and access history, and manage invitations."
          : "They will lose access to site administration and invitation management. Their drafts and feature grants will stay unchanged."}
    </p>
    {#if saveError}<p class="notice error" role="alert">{saveError}</p>{/if}
    <form onsubmit={updateAccess} class="stack">
      {#if selected.feature}<label
          >Reason{selected.enabled ? " (optional)" : ""}<Input
            aria-label="Reason"
            name="reason"
            maxlength={500}
            required={!selected.enabled}
          /></label
        >{/if}
      <div class="row">
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onclick={() => confirmation?.close()}>Cancel</Button
        ><Button
          type="submit"
          variant={selected.enabled ? "default" : "destructive"}
          disabled={saving}
          >{saving
            ? "Updating…"
            : selected.feature
              ? "Confirm change"
              : selected.enabled
                ? "Grant access"
                : "Remove access"}</Button
        >
      </div>
    </form>
  {/if}
</dialog>

<style>
  .admin-shell {
    height: 100%;
    min-height: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
  }
  .standalone {
    max-width: 1200px;
    height: calc(100dvh - 150px);
    min-height: 400px;
    margin: 20px auto;
    border: 1px solid var(--line);
    border-radius: 14px;
    overflow: hidden;
  }
  .admin-toolbar {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 10px 18px;
    border-bottom: 1px solid var(--line);
    min-width: 0;
  }
  h1 {
    font-size: 20px;
    line-height: 1.3;
    margin: 0;
    white-space: nowrap;
  }
  .toolbar-actions {
    margin-left: auto;
    gap: 4px;
  }
  .admin-body {
    display: grid;
    grid-template-columns: 176px minmax(0, 1fr);
    min-height: 0;
  }
  .admin-nav {
    border-right: 1px solid var(--line);
    padding: 18px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .admin-nav :global(a) {
    justify-content: flex-start;
    gap: 10px;
  }
  .admin-content {
    overflow: auto;
    overscroll-behavior: contain;
    padding: 24px;
    min-width: 0;
  }
  h2 {
    font-size: 26px;
    margin: 0 0 24px;
  }
  h3 {
    font-size: 18px;
    margin: 0 0 16px;
  }
  section {
    border-top: 1px solid var(--line);
    padding-top: 24px;
    margin-top: 24px;
  }
  .admin-metrics {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    margin: 0;
  }
  .admin-metrics > div,
  .provider {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 18px;
  }
  dt {
    color: var(--muted-foreground);
    font-size: 13px;
  }
  dd {
    margin: 10px 0 0;
    font-size: 27px;
    font-weight: 600;
  }
  .service {
    flex-wrap: wrap;
  }
  code {
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .admin-search {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .admin-search :global(input) {
    flex: 1;
  }
  .history {
    list-style: none;
    padding: 0;
    margin: 18px 0;
  }
  .identity {
    display: grid;
    gap: 5px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .accounts-table {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    text-align: left;
    font-size: 13px;
  }
  .accounts-table th,
  .accounts-table td {
    padding: 14px 8px;
    border-bottom: 1px solid var(--line);
    overflow-wrap: anywhere;
  }
  .accounts-table thead th {
    color: var(--muted-foreground);
    font-size: 12px;
    font-weight: 400;
  }
  .accounts-table th:first-child {
    width: 24%;
  }
  .accounts-table th:nth-child(2) {
    width: 25%;
  }
  .accounts-table th:nth-child(3) {
    width: 14%;
  }
  .accounts-table th:nth-child(4) {
    width: 12%;
  }
  .accounts-table th:last-child {
    width: 44px;
  }
  .account-name .row {
    gap: 10px;
  }
  .account-name strong {
    min-width: 0;
  }
  .account-costs :global(.account-cost-button) {
    display: grid;
    height: auto;
    width: 100%;
    padding: 6px;
    gap: 4px;
    border-radius: 8px;
    white-space: normal;
  }
  .account-costs .row {
    gap: 8px;
  }
  .account-actions {
    padding-right: 0;
  }
  .mobile-label {
    display: none;
  }
  .pagination {
    margin-top: 20px;
  }
  .empty {
    padding: 20px 0;
  }
  .history li {
    display: grid;
    gap: 7px;
    padding: 18px 0;
    border-bottom: 1px solid var(--line);
    overflow-wrap: anywhere;
  }
  .usage-filter {
    gap: 12px;
    flex-wrap: wrap;
  }
  .usage-filter > .row {
    flex-wrap: wrap;
    gap: 4px;
  }
  .account-filter {
    overflow-wrap: anywhere;
    min-width: 0;
  }
  .provider-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    margin: 24px 0;
  }
  .provider {
    margin: 0;
  }
  .cost {
    font-size: 28px;
    font-weight: 600;
    margin: 0;
  }
  .usage-stats {
    margin: 20px 0 0;
    display: grid;
    gap: 12px;
  }
  .usage-stats > div {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .usage-stats dd {
    font-size: 14px;
    margin: 0;
  }
  .flag-scope {
    margin: 24px 0 16px;
  }
  .flags-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
    text-align: left;
  }
  .flags-table th,
  .flags-table td {
    padding: 16px 10px;
    border-bottom: 1px solid var(--line);
    overflow-wrap: anywhere;
  }
  .flags-table thead th {
    color: var(--muted-foreground);
    font-size: 12px;
    font-weight: 400;
  }
  .flag-actions {
    display: flex;
    flex-wrap: nowrap;
    gap: 8px;
  }
  .flags-table td:last-child {
    width: 1%;
  }
  .flag-actions :global(button) {
    white-space: nowrap;
  }
  .user-results {
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 8px;
    margin-top: 12px;
  }
  .user-results :global(button) {
    width: 100%;
    height: auto;
    min-height: 44px;
    justify-content: space-between;
    text-align: left;
    white-space: normal;
  }
  .user-results .identity {
    gap: 3px;
  }
  .user-results .pagination :global(button) {
    width: auto;
  }
  dialog p {
    overflow-wrap: anywhere;
  }
  @media (max-width: 1000px) {
    .accounts-table thead {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    .accounts-table tbody,
    .accounts-table tr {
      display: block;
    }
    .accounts-table tbody tr {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas: "identity actions" "email email" "joined role" "costs costs";
      gap: 10px;
      padding: 16px 0;
      border-bottom: 1px solid var(--line);
    }
    .accounts-table th:nth-child(n),
    .accounts-table td {
      width: auto;
      padding: 0;
      border: 0;
      min-width: 0;
    }
    .account-name {
      grid-area: identity;
    }
    .account-email {
      grid-area: email;
      color: var(--muted-foreground);
    }
    .account-joined {
      grid-area: joined;
      align-self: center;
    }
    .account-role {
      grid-area: role;
      justify-self: end;
    }
    .account-costs {
      grid-area: costs;
    }
    .account-actions {
      grid-area: actions;
    }
    .account-costs :global(.account-cost-button) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 18px;
    }
    .mobile-label {
      display: inline;
      margin-right: 4px;
    }
  }
  @media (max-width: 750px) {
    .flag-actions {
      flex-wrap: wrap;
    }
    .admin-body {
      grid-template-columns: 148px minmax(0, 1fr);
    }
    .admin-metrics {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .provider-grid {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 600px) {
    .standalone {
      margin: 12px 8px;
      height: calc(100dvh - 125px);
    }
    .admin-toolbar {
      gap: 8px;
      padding: 8px 10px;
      flex-wrap: wrap;
    }
    h1 {
      font-size: 18px;
    }
    .updated {
      font-size: 11px;
    }
    .admin-body {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 1fr);
    }
    .admin-nav {
      border-right: 0;
      border-bottom: 1px solid var(--line);
      padding: 8px;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 4px;
    }
    .admin-content {
      padding: 18px 14px;
    }
    .admin-metrics {
      gap: 8px;
    }
    .admin-metrics > div {
      padding: 13px;
    }
    dd {
      font-size: 24px;
    }
    h2 {
      font-size: 23px;
      margin-bottom: 20px;
    }
    .admin-search {
      flex-wrap: wrap;
    }
    .admin-search :global(input) {
      flex-basis: 100%;
    }
    .flags-table th,
    .flags-table td {
      padding: 14px 5px;
    }
    .flags-table {
      font-size: 13px;
    }
  }
  @media (max-width: 350px) {
    .updated {
      order: 3;
      flex-basis: 100%;
    }
    .admin-toolbar {
      row-gap: 0;
    }
  }
</style>
