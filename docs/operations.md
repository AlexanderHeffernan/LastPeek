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
gateway has a fixed Compose directory/project and four JSON commands:

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

The project plugin `.amp/plugins/lastpeek-ops.ts` registers the four commands above.
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
