# Feature access and agent operations

`ai-review` is the first registered feature (`src/lib/features.ts`). Every account,
including admins, defaults to **off**. Both the author page and review endpoint
require a current PostgreSQL grant plus an OpenAI key. Grants use stable account
UUIDs; email is only an operator lookup. Changes apply on the next request without
signing out. An already-running review is not cancelled by revocation. The existing
page may retain its control until reload, but a new request is denied.

Migration `004_feature_access.sql` is additive and compatible with the preceding
image. State changes lock the account and atomically append actor, reason, thread
and time to audit history. Repeating the same change is a no-op. There are no admin
overrides, percentages, public management routes or hosted flag dependencies.

`x-source-posts` separately enables New Quote and New Reply. It also defaults to
off for every account. The server checks the draft owner's current grant before
reading the source cache or calling X, including on anonymous review pages.
Reviewers need no grant or account. Revocation removes source previews and blocks
new source drafts without preventing edits or human feedback. An in-flight lookup
is not cancelled; its result may finish after revocation. The X token and instance
budget remain independent requirements. Grant this feature using the same audited
operator command below with `"feature": "x-source-posts"`.

## Site administration

Set `LASTPEEK_OWNER_ID` to the existing owner's stable account UUID in the web
container environment. Missing or invalid configuration disables `/siteadmin`
and its operator reads; never infer ownership from an email address or the first
account. The owner can always access administration. Existing `is_admin`
accounts form the admin team: they can read administration and manage their
invitations, but only the owner can grant or revoke admin membership. This is
authorization, not a feature flag. AI review grants never confer admin access.

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

X records each paid attempt transactionally with its budget reservation. Cache
hits, denied requests and exhausted budgets create no new event. Gross cost
estimates use the public post-read price ($0.005) and expansion pricing effective
22 November 2026 ($0.010 per user, $0.005 per media/poll/place/post expansion).
These estimates do not apply daily provider deduplication, credits or discounts
and are not invoices. The existing five-cent-per-attempt safety reservation is
reported separately. Earlier X reservations remain globally unattributed, not
invented per-user costs. Month filters use UTC; all-time covers tracked events.

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
  "feature": "ai-review",
  "enabled": true,
  "reason": "Owner-only trial"
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
gateway has a fixed Compose directory/project and nine JSON commands:

- `admin_overview`: the same aggregate overview and access history as `/siteadmin`.
- `admin_users`: the same bounded, searchable account directory as `/siteadmin`.
- `admin_usage`: global or per-account OpenAI/X usage and estimates.
- `admin_flags`: registered flags, activation counts and optional account status.
- `admin_history`: the combined membership and feature-grant change history.
- `feature_access`: one account's grants and audit history.
- `set_feature_access`: grant/revoke one known flag, flag-write key only.
- `service_status`: selected container state/health fields only.
- `recent_logs`: 1–60 minutes, 1–200 recent web log lines; returns only approved
  AI event enums/numbers, never arbitrary log strings or review URLs.

No shell, arbitrary SQL, paths, deploy, restart, backup download or raw tunnel logs
are exposed. Flag commands remain unavailable until a compatible app image is
deployed and migration runs. Installing the gateway is not an app deploy. The
Pi's existing deployment directory and Docker-capable owner remain trusted.

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

The project plugin `.amp/plugins/lastpeek-ops.ts` registers the nine commands above.
Flag changes require human confirmation before a write is sent. This is a workflow
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
