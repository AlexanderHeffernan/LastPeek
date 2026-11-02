# Plans, feature access and agent operations

AI review and X source previews are released Pro capabilities, not experimental flags. Migration 014 migrates all existing accounts to Pro, removes the two active grants (retaining audit history), and revokes pending bearer-only invitations. Future accounts default Free, or inherit Pro from an email-bound invitation. There is no billing integration.

The owner manages account plans from `/siteadmin/accounts` and creates email/plan invitations from `/siteadmin/invitations`. Invitations have a searchable, status-filtered table covering Pending, Accepted, Expired and Revoked. Links are single-use for seven days and must be sent manually. Issuing another invitation for an email revokes pending links for that email. Password and X signup enforce the invited email transactionally; the link is a registration capability, not mailbox verification. Invitations no longer appear in Account settings.

`/siteadmin/plans` controls allowances. Free changes immediately. Pro increases immediately; reductions apply at each account's next calendar-month renewal. Monthly periods are anchored in UTC to account creation/migration and do not reset on plan toggles. Plan changes can downgrade immediately or at period end. Over-quota content is preserved. Account details show current/next limits, renewal date and period usage. Plan, allowance and invitation writes require owner authentication, same origin and are audited. Admin team members can read these controls but cannot change them.

`/siteadmin/model` models hypothetical revenue, fees, tax, API utilisation, storage, database/backup/transfer assumptions and fixed hosting. **Save model** persists the owner's assumptions in PostgreSQL (migration 015), shared across browsers and admin sessions; unsaved edits remain local. API budgets are USD and the NZD scenario uses an editable exchange-rate assumption. Complimentary Pro accounts incur costs without revenue. Full-allowance profit and average-use profit are estimates, not invoices or a live price. No simulation changes live entitlements. Saving requires same-origin owner access and is audited.

X publishing is a released Pro capability. It requires a connected account with explicit `tweet.write` permission (`media.write` for attachments) and sufficient existing X allowance. Existing connections upgrade through Allow posting in the draft. Text posting reserves US$0.015 (US$0.20 with URLs, media or a native quote); each upload/processing API call conservatively reserves US$0.05. These are safety reservations, not provider charges; see API accounting below for tariffs. The global safety budget rounds up to cents. Threads retain confirmed post IDs; Continue posting advances only unfinished posts in the same revision/account. Unknown tweet results block retries; do not clear their records to retry without independently confirming the X state. Native quotes may be rejected without Enterprise access. Deploying the code never publishes a post automatically. Plan downgrade affects subsequent requests; already-running provider calls are not cancelled. X cache reads require the draft owner's Pro plan; reviewers need no account. Provider credentials and instance budgets remain independent safety requirements.

Mention suggestions are also a released Pro capability and require a connected X account with `users.read`. Suggestions start after three characters and a 650 ms pause, with at most five results (US$0.05 reserved per uncached search). Completed handles are checked when the editor loses focus (US$0.01 reserved each). Per-author caches last 15 minutes for results, five minutes for confirmed missing handles and one minute for failures/in-flight requests. Selected suggestions reuse the search result without another user read. Thirty uncached attempts per 15 minutes, the account's X allowance and the existing instance cap all apply. Costs reconcile through the existing user-read ledger; unknown responses keep their reservation. Live search access, ranking and billing still need an authorised real-account smoke test. Provider outages, access errors and exhausted allowances never mark handles invalid or block posting.

Migration 027 retires `x-publishing` and `x-mentions`, removes their grants and preserves their audit history. Retired flag commands are rejected.

`agents` controls the private MCP trial and defaults off for every account. Grant it individually through Feature flags or the confirmed `set_feature_access` operator tool. The initial hosted rollout is restricted to heffernan.alexander@icloud.com. It gates Settings access, OAuth consent, code/refresh exchanges and every MCP request/tool call; removing the grant blocks existing tokens on their next request without deleting the user's connections. OAuth discovery and public-client registration remain available so clients can initiate authorization, but confer no account access. General Settings improvements are not trial-gated.

## Site administration

Set `LASTPEEK_OWNER_ID` to the existing owner's stable account UUID in the web
container environment. Missing or invalid configuration disables `/siteadmin`
and its operator reads; never infer ownership from an email address or the first
account. The owner can always access administration. Existing `is_admin`
accounts form the admin team: they can read administration, but only the owner
can issue invitations, change plans or allowances, or grant or revoke admin
membership. This is authorization, not a feature flag. Pro never confers admin access.

There is no visible Admin navigation button. `~` toggles a modal overlay on desktop;
on mobile, hold the centered mascot for 600ms to open it. An ordinary mascot tap
reacts and scrolls to the top. Moving away or starting a scroll cancels the hold.
Both entry points require existing admin access; the gesture is not authorization.
Opening the overlay never navigates away from the current page.
Closing with `~`, Escape, the backdrop or the close button preserves the page,
form state and scroll position underneath. Typing `~` in an input or editor
does not open it. `/siteadmin` remains available as a full page, including on
mobile. Overview contains key figures, global monthly API costs/requests and service health. Accounts, Feature flags, API usage
and Access history have their own sidebar sections and full-page URLs under
`/siteadmin/accounts`, `/siteadmin/features`, `/siteadmin/usage` and `/siteadmin/history`. The overlay and page use the same component and authenticated snapshot
endpoint. Reads are private/no-store; role writes require same-origin owner
authentication and a confirmation, and are transactionally audited in migration
`012_admin_access_audit.sql`. Owner access cannot be revoked in this interface.

`admin_overview` and `admin_users` use the same server queries as the website.
They expose aggregate account/invitation/draft/review/feedback counts, media bytes,
database health, image revision, the latest 20 admin access changes, and paginated
account identity/current avatar/role/registration/last-online activity/current draft count/storage/feature grants. Admins
can read current profile avatars, but gain no access to historical avatars or draft media. Directory search is a
literal, case-insensitive name/email substring (200 characters maximum); pages
contain at most 25 accounts. No passwords, session tokens, draft contents, review
capabilities or raw request logs are returned. Media bytes count database-tracked
uploads and avatars, not filesystem, database or backup disk usage. Registered
accounts and seven-day registrations are not live-user or recent-activity counts.
Migration `015_user_activity.sql` adds a nullable `last_seen_at` timestamp, updated
by authenticated requests at most once per minute. Accounts shows it as Last
online, or Not recorded until the account next uses the site. There is no
historical backfill, heartbeat or claim that an idle tab is still online.

```json
{ "action": "admin_overview" }
```

```json
{ "action": "admin_users", "search": "", "page": 1 }
```

`admin_usage` accepts optional `userId` and `period` (`month` or `all`) and reads
the same global/per-account usage as the website. `admin_flags` accepts an optional
`userId` and returns every registered flag, activation counts and the selected
account's enabled/disabled status. `admin_history`
reads the latest 50 combined membership and feature-grant changes. The owner can
manage feature grants from Feature flags, with user search and confirmation; a
reason is optional when enabling and required when disabling. Team members
can inspect them but cannot change them. The existing agent flag-write role still
permits confirmed feature changes.

Bulk grants/revocations affect existing accounts only, lock accounts in UUID order,
and audit each actual change in the same transaction. Future accounts still default
to off. Individual and bulk writes serialize against the same user-row locks.

The operator credentials can read these views, but cannot change admin membership or perform bulk writes.
The existing flag-write credential remains limited to feature grants.

### API accounting

Migration `013_api_usage.sql` records content-free usage metadata attributed to the
draft owner. OpenAI returns token usage, not the dollar charge. The app automatically
snapshots published Standard rates for its default `gpt-6-luna` model: $0.10 input,
$0.01 cached input and $0.50 output per million tokens, with cache writes at 1.25× input.
Requests explicitly select the default service tier. Inputs above 272K tokens use
2× input/cache and 1.5× output rates. Source, verified 31 October 2026:
https://developers.openai.com/api/docs/models/gpt-6-luna . Rates live in server code;
changing models requires adding its verified rates, not an admin form. Missing rates or missing
token counts stay explicitly unpriced, including failed/interrupted requests.
Historical OpenAI usage cannot be reconstructed from this ledger.

Migration `023_x_cost_accounting.sql` snapshots X tariffs before HTTP. Standard
PPU post creation costs $0.015, or $0.200 when the submitted text contains a URL.
One completed media object adds $0.015, not one charge per initialize/append/finalize/status
request. Append, finalize and status transport entries carry zero additional cost.
The initialization entry receives its snapshotted object price after a confirmed
successful finalization. An abandoned/failed initialization remains unsettled:
X has not documented when those objects are billed. Failed writes/timeouts also
remain unsettled instead of assuming that a failed publication was free.
Native quotes require Enterprise and retain an unsettled cost rather than
borrowing a standard PPU rate for a negotiated contract.

Source reads cost $0.005 per post; connection/sign-in profile reads cost $0.010
per user. Profile reads are now recorded even for Free accounts; token exchange
is not treated as a paid content request. New/login identities are attributed
after resolving their LastPeek account; unsuccessful unlinked identities remain
unattributed app costs. Source cache hits, denied lookups and exhausted budgets
create no new event. Expansion charging begins 22 November 2026 ($0.010 per user,
$0.005 per media/poll/place/post). Returned-resource hashes and UTC dates apply
X's daily payer-wide deduplication, including concurrent reads and shared resources
across LastPeek users. The first recorded resource consumer bears its cost; later
consumers that day cost zero. No post/profile text or raw resource IDs enter the
accounting tables. X calls deduplication a soft guarantee, not an invoice promise.

Admin shows one **Billable estimate** figure, never a cost plus a provision. The
`cost_usd` aggregate is null if any included event lacks a price or an explicit non-billable decision; admin displays
**Needs reconciliation**, not an incomplete subtotal or a guessed billable total.
`estimated_usd` remains the backward-compatible known subtotal for diagnostics,
and `reserved_usd` remains safety metadata, not an alternative spending measure.
Operation-level counts/outcomes identify what needs investigation. Legacy
`media-upload` entries lack stage information and are not silently backfilled.
Month filters use UTC; all-time covers tracked events. Account allowance checks
continue to reserve conservatively; this does not turn on customer billing.

Every five minutes, the existing web process uses the optional app bearer token
to read `/2/usage/credits`. It saves prepaid/free balances separately (including
negative prepaid balances), a grant fingerprint and the corresponding global
ledger totals. A stable interval matches only when its balance debit agrees with
the ledger and neither endpoint has unsettled activity. Top-ups, grant changes,
concurrent activity and unexplained differences require review, never arbitrary
allocations to users. Review remains sticky: a later quiet interval cannot erase
an earlier discrepancy. Failed checks leave the last snapshot stale; admin shows
the check timestamp/overdue state. No balance is available when credentials are
missing. This is a payer-wide cross-check, not an itemized bill or proof of each
user's charges; other apps on the payer, adjustments and historical gaps need
provider-console evidence before billing. There is no automatic adjustment.

Migration `025_usage_reconciliation.sql` adds an immutable decision overlay, not
an update to the original provider ledger. In API usage, the owner selects up to
50 exact unresolved IDs and records a reason plus either a confirmed USD amount
**per request** with itemized evidence, or a non-billable exception with no invented
price. Choose requests separately when verified amounts differ. Non-billable costs
stay unknown in the original ledger and are explicitly excluded from the billable
estimate. This does not turn on billing, release safety reservations, retry posts,
or change publication outcomes. Active requests cannot be settled until ten minutes
after their creation; old interrupted requests can then be resolved explicitly.
Stale/mixed/already-resolved selections fail atomically. Reconciliation history
retains actor, time, reason, evidence, affected IDs/decision and agent thread.

After resolving all payer-wide outstanding X calls, wait for the next five-minute
balance snapshot, refresh, and use **Review X balance checkpoint**. Review the
credits and ledger subtotal, then record why the historical discrepancy is accepted.
Only the exact latest snapshot, less than ten minutes old and covering an unchanged
settled ledger, can become a new baseline. The previous mismatch and unknown
provider costs remain in history; this is not a claim that the old totals matched.
New discrepancies still require review. Owner browser writes require same-origin
authentication; ordinary admins have read-only access.

Agents use `admin_usage` to obtain exact unresolved IDs, decision history and the
balance snapshot ID, then `reconcile_usage` or `reconcile_x_balance`. Both require
explicit user authorization and human confirmation in the plugin. The existing
write credential (`LASTPEEK_OPS_FLAGS_KEY`, host role `flags`) is now also permitted
these two bounded accounting commands; the read credential cannot reconcile.
The server revalidates every command and records the trusted SSH actor and thread.
Install the reviewed updated `scripts/operator-gateway.py` as root-owned 0755 at
`/usr/local/sbin/lastpeek-operator` after the compatible application is deployed.
An image update alone does not update this host allowlist. Do not reinstall keys,
change SSH, grant shell/SQL access or rerun the installation script. A missing or
old gateway is a blocker, not a reason to bypass it.

Tariff sources checked 31 October 2026:

- https://docs.x.com/x-api/getting-started/pricing (prices and daily UTC deduplication)
- https://console.x.com/api/credits/pricing (current tariff catalog)
- https://devcommunity.x.com/t/undocumented-postcreate-usage-for-media-uploads-please-clarify-pay-per-use-billing/274646/2 (X staff's per-media-object clarification; supersedes the conflicting calculator's older ContentCreate mapping)
- https://docs.x.com/x-api/usage/get-usage-credits (payer balance schema, not individual charges)

Historical seven-call gaps cannot be priced accurately from counts alone. Do not
charge customers a reservation, a partial subtotal or an unexplained balance delta.

### Production activation

An image update alone cannot enable the new host-gateway commands. With explicit
approval, add the owner UUID to the Pi deployment environment **and** map
`LASTPEEK_OWNER_ID` into the web container's Compose environment, then apply that
container configuration with the deployment lock held. The operator CLI runs in
web and inherits this setting. The checked-in `compose.yaml` includes the mapping;
the Pi's operator-local Compose file must be updated separately. Do not print the
full rendered Compose configuration or its environment.

Install the reviewed `scripts/operator-gateway.py` as root-owned mode 0755 at
`/usr/local/sbin/lastpeek-operator` to allow the five new read commands. A gateway
replacement does not require reinstalling keys or restarting SSH. Do not rerun
the full installation script for this update. Verify all five reads after the
compatible image and migrations are deployed; no arbitrary SQL or shell access
is needed.

## Local operator CLI

From a trusted checkout or inside web, send JSON on stdin to `npm run --silent
operator`. Read requests need no write role. Writes require
`LASTPEEK_OPERATOR_ROLE=flags` and `LASTPEEK_OPERATOR_ACTOR` set by the trusted
operator environment. These are not security boundaries against someone who
already has database credentials or Docker access.

```json
{ "action": "feature_access", "email": "author@example.com" }
```

```json
{
  "action": "set_feature_access",
  "email": "author@example.com",
  "feature": "future-experiment-name",
  "enabled": true,
  "reason": "Example only: register an experiment before granting it"
}
```

Unknown commands/flags/fields, missing accounts and malformed inputs fail closed.
Only actual changes append audit entries. `feature_access` returns current grants
and the last 20 changes, not drafts, password hashes or session information.

## Pi gateway: one-time installation

The official Pi uses ordinary OpenSSH on **100.124.28.78:2222**, not Tailscale SSH.
The separate `lastpeek-operator.service` does not modify existing SSH or Tailscale
SSH settings. Review `scripts/install-operator.sh`, then run it once as root with
`scripts/operator-gateway.py` and two distinct Ed25519 public keys. Never send
private keys to the Pi. Re-running preserves the pinned host key; restart the
operator service deliberately after configuration updates.

Root-owned authorized keys force each key into its read or flag-write role.
Forwarding, TTY, passwords and user-supplied commands are disabled. The account
has no Docker-group access; sudo allows only the fixed gateway commands. The
gateway has a fixed Compose directory/project and eleven JSON commands:

- `admin_overview`: the same aggregate overview and access history as `/siteadmin`.
- `admin_users`: the same bounded, searchable account directory as `/siteadmin`.
- `admin_usage`: global or per-account OpenAI/X usage and estimates.
- `admin_flags`: registered flags, activation counts and optional account status.
- `admin_history`: the combined membership and feature-grant change history.
- `feature_access`: one account's grants and audit history.
- `set_feature_access`: grant/revoke one known flag, flag-write key only.
- `reconcile-usage`: resolve exact unresolved IDs with an audited cost or exclusion, write key only.
- `reconcile-x-balance`: accept one fresh reviewed payer snapshot, write key only.
- `service_status`: selected container state/health fields only.
- `recent_logs`: 1–60 minutes, 1–200 recent web log lines; returns only approved
  AI event enums/numbers, never arbitrary log strings or review URLs.

No shell, arbitrary SQL, paths, deploy, restart, backup download or raw tunnel logs
are exposed. Flag commands remain unavailable until a compatible app image is
deployed and migration runs. Installing the gateway is not an app deploy. The
Pi's existing deployment directory and Docker-capable owner remain trusted.

After the optional blue-green installation, the updated gateway reads only the
fixed `routing/active.conf` path, accepts only `blue` or `green`, and uses the fixed
Compose overlay/env-file paths for administration, status and bounded logs. With
no active route it retains the legacy `web` target. A malformed route fails closed;
callers still cannot choose a service, filename or command. Install this gateway
update during the one-time cutover; the old gateway cannot find the active app
after legacy web is stopped. See [deployment](deployment.md).

## Tailnet setup (tailnet administrator, once)

1. Create `tag:lastpeek-operator` owned by an administrator. Grant that source tag
   only TCP 2222 on `100.124.28.78`. Review existing broad allow rules: grants are
   additive, so adding a narrow rule does not remove broad access. Add policy
   tests asserting access to 2222 and denial to Pi 22 and other services. Do not
   replace the whole tailnet policy or retag the Pi blindly.
2. Create a dedicated OAuth client with **auth_keys write only** and only
   `tag:lastpeek-operator`. Allow preauthorized ephemeral nodes. Do not grant
   devices, ACL or general API administration permissions.
3. Save its secret as project secret `LASTPEEK_TS_OAUTH_SECRET` in Amp's
   `hefferalex/LastPeek` project using a masked dialog/Settings—not chat. This
   credential is long-lived; restrict who can execute trusted code with project
   secrets, rotate it, and revoke it when no longer needed.

`.agents/setup` installs the client without authenticating. Optional
`.agents/resume` starts a supervised daemon with in-memory state and enrolls a
tagged ephemeral node only when the OAuth secret exists. No credential or node
identity belongs in a snapshot. DNS/routes are not accepted; the SSH client uses
the fixed Tailscale IP with a separately pinned host identity. In E2B, a local
dummy interface with documentation-only `192.0.2.254/32` lets Tailscale recognize
the link-local uplink as online; the default route is unchanged. Orb enrollment
uses `--netfilter-mode=off` because the kernel lacks connmark support, and
`--shields-up` blocks unsolicited inbound tailnet connections. Tailnet access
policy still restricts outbound operator traffic at the destination. Core
development works without this network/secret. After adding secrets to an
existing orb, refresh processes and run `.agents/resume`.

## Amp tools and credentials

The project plugin `.amp/plugins/lastpeek-ops.ts` registers the eleven commands above.
Flag and accounting changes require human confirmation before a write is sent. This is a workflow
safeguard: possession of the flag-write SSH key itself authorizes writes; the Pi
cannot independently verify the dialog or thread ID. The audit actor identifies
the SSH credential role, not an individual human.

Project secrets `LASTPEEK_OPS_READ_KEY` / `LASTPEEK_OPS_FLAGS_KEY` hold the private
keys. Set `LASTPEEK_OPS_HOST_KEY` to the host public key obtained directly from
the Pi installation, not an unauthenticated keyscan. SSH uses strict pinning,
no agent, bounded output/time, and temporary 0600 files removed after each request.
Never inject operator credentials into web/maintenance or untrusted PR execution.

New orbs load the plugin from the checked-out repository; existing threads must
reload it. Future experiment keys need registration plus checks at their owning
server operation/UI; the plugin derives its flag choices from the same registry.

## Telemetry and revocation

The OpenAI transport emits structured `ai_request` outcome, model, latency, token
counts and provider HTTP status when available. No text, identities, API keys,
provider error bodies or response content are logged. The remote gateway further
removes all free-form strings. This is bounded diagnostics, not durable metrics
or alerting; existing backup/disk monitoring limits remain.

Remove the relevant public key and restart the operator service to revoke a key.
Revoke the OAuth client and remove enrolled nodes if network access must end.
Stop/disable `lastpeek-operator.service` to disable the gateway entirely. Existing
personal SSH and app operation remain unchanged.
