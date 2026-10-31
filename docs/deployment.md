# Hosting and automatic updates

## Official Raspberry Pi service

The official origin is `https://lastpeek.alexheffernan.dev`. The Pi 5 runs ARM64 Linux and Docker Compose. Its isolated deployment directory is `~/lastpeek-deploy`; credentials and host-specific routing configuration are intentionally not committed. Existing The Last Light and Dead Kingdoms services are separate and must not be restarted or reconfigured for LastPeek.

The original single-web contract, retained here for installation and recovery
reference, is below. The blue-green installation replaces its app routing and
updater as described later in this document; database and privacy boundaries stay
the same.

- `postgres:16-bookworm`, dedicated `lastpeek` database/user and persistent database volume; no host port, no automatic database-image updates.
- Web and hourly maintenance both use `ghcr.io/alexanderheffernan/lastpeek:latest`, sharing a private media volume at `/app/data/media` (Node UID 1000). Never mount it into a public static directory.
- Web listens on container port 3000, mapped only to `127.0.0.1:3012`. Its start command is `sh -c 'npm run db:migrate && npm start'`; `/health` must return 200 and checks PostgreSQL connectivity.
- Maintenance runs `sh -c 'while true; do npm run maintenance; sleep 3600; done'` after web is healthy.
- Both receive `DATABASE_URL=postgres://lastpeek:<generated-hex-password>@db:5432/lastpeek`, `ORIGIN=https://lastpeek.alexheffernan.dev`, `BODY_SIZE_LIMIT=55M` and the documented media limits. Keep `.env` owner-readable only (0600); never paste it into tickets or logs.
- A dedicated named Cloudflare Tunnel runs in its own container, using only its own read-only mounted credential/config. It routes the exact LastPeek hostname to `http://web:3000`, then a catch-all 404. The shared system tunnel is unchanged. The Cloudflare account certificate must **not** be mounted into the connector.
- Only web sets `ADDRESS_HEADER=cf-connecting-ip`. This trusts Cloudflare's client address for rate limiting, and is safe only while the tunnel is the sole public ingress and the host is trusted. Do not expose the web port on all interfaces or copy this setting to an arbitrary reverse proxy.
- All services restart unless stopped. LastPeek containers have no `com.centurylinklabs.watchtower.enable=true` label, so the existing shared, label-enabled Watchtower ignores them. A dedicated user-systemd timer updates only LastPeek web and maintenance every 60 seconds; PostgreSQL and the tunnel are not automatically updated.

Cloudflare handles public TLS and can see traffic; this is not end-to-end encryption from reviewers to the Pi. Keep access logging of review URLs disabled. Other operators can use any HTTPS reverse proxy instead and do not need Cloudflare.

## Delivery pipeline

`.github/workflows/check.yml` runs on pull requests and pushes to `main`, using GitHub-hosted runners. Formatting, TypeScript, contract tests, dependency audit (moderate-or-higher blocks), migrations and actual Chromium/WebKit browser tests must pass before image publishing. Third-party Actions are pinned by commit. Pull requests have only read permissions and never publish images or execute on the Pi.

Application commits run the same `npm run verify:release -- --force` command used locally, inside the official Playwright image selected by the lockfile's exact browser version. That image includes both engines and their system dependencies. Each browser gets a newly created disposable PostgreSQL database and media directory; no production rate-limit policy is bypassed. Local verification receipts never bypass CI.

On the official repository's `main`, parallel native AMD64 and ARM64 jobs build the checked source with architecture-specific caches and push `<full-SHA>-amd64` / `<full-SHA>-arm64` image tags using the workflow's short-lived `GITHUB_TOKEN` with `packages:write`. No QEMU or Pi runner is involved. A final job joins those images into the full-SHA and `latest` multi-architecture tags. Only that promotion job is serialized: validation and immutable image builds for other commits do not wait for an earlier release. Immediately before promotion it fetches main; a newer application commit supersedes the older release, while newer documentation alone does not. Thus an older finishing job cannot overwrite a newer promoted application release. There is no stored SSH or Pi secret in GitHub. OCI revision labels and the index annotation identify the source. The GHCR package must be public so the Pi can pull without registry credentials.

Changes exclusively to root Markdown files or Markdown under `docs/` run history secret scanning and formatting but do not build/deploy images. Mixed changes, workflow/tooling changes and unknown paths take the full pipeline. Manual workflow runs also take the full pipeline. A docs-only commit deliberately leaves the deployed revision unchanged; verify its lightweight workflow and the existing deployment rather than waiting for its SHA to appear in `/health`.

Before blue-green installation, `lastpeek-update.timer` runs `~/lastpeek-deploy/update.sh` every 60 seconds. User lingering is enabled so it survives logout/reboot. The legacy script takes `.deployment.lock`, pulls only web and maintenance, then runs `docker compose up -d --no-deps --wait web maintenance`. Compose leaves unchanged containers alone. The backup script takes the same lock, preventing updates from restarting writers during a snapshot. No registry password is needed: the image package is public.

A push is **not** immediately a deployment: checks/build must finish, then the timer and container startup pass. Verify the workflow result, running image revision, health and public page. `/health` returns the build's full source SHA in `X-LastPeek-Revision` (`development` outside a versioned image), allowing public checks to detect unexpected deployments. Legacy replacement causes a brief interruption; the health-gated handover below avoids stopping the serving app first. All future migrations must be compatible with the previous image; stop unattended updates for destructive schema changes and take a coherent backup first.

## Health-gated blue-green handover

The checked-in `deployment/` tooling replaces the stop/start updater **after a
one-time operator installation**. Merely publishing an app image does not install
it. Verify the installation before using blue-green commands. Root `compose.yaml`
remains the simple self-hosting default.

`compose.blue-green.yaml` overlays the Pi's existing `compose.yaml` and optional
`compose.override.yaml` (or `.yml`). The updater resolves the fully merged web
definition into owner-readable-only `.web-template.json` before using the overlay;
this derived file contains secrets and must never be printed or committed. Blue and green
inherit web's environment, private media, database network and health check, but
have no published ports and run `node build` directly. A stable nginx `proxy`
listens on loopback port 3013 and serves traffic on container port 3000. Only the
dedicated LastPeek tunnel changes its target to `http://proxy:3000`. It remains the
sole public ingress; both slots retain `ADDRESS_HEADER=cf-connecting-ip`, and nginx
preserves that header. Do not expose proxy to arbitrary untrusted peers. Watchtower
must continue ignoring every LastPeek container.

`update.py` takes the existing `.deployment.lock`, pulls latest once and pins its
digest. It runs migrations separately while the current app keeps serving, starts
the inactive slot, and checks database-backed health, the exact source revision and
the landing page. Before switching, it copies only `build/client/_app/immutable/`
into a separate public-asset directory. Old hashed assets are retained for open
tabs; private media is never mounted into nginx. Monitor asset disk use; do not
automatically delete chunks still needed by open browsers.

After validating nginx configuration, the updater atomically writes the desired
route, gracefully reloads nginx and checks the routed revision. A failed handover
restores the preceding route and leaves the preceding app running. The old app is
stopped only after nginx's retiring workers finish; requests are allowed up to five
minutes to drain. Writes are never retried by the proxy. Maintenance remains a
single service and is updated to the same pinned image after the handover. A failed
maintenance update is retried on the next timer invocation. Desired routing and
slot digests survive process interruption; the next run reconciles routing before
reusing either slot. This is startup/cutover protection, not automatic rollback for
bugs discovered later.

The private tunnel-to-proxy hop closes each HTTP connection cleanly after its
response, avoiding idle keep-alive socket races during nginx reload. This adds a
local TCP connection per request, not a new browser TLS handshake with Cloudflare.

Run `npm run test:deployment` on Linux with Python 3, Docker Engine and Compose
available. It exercises the real updater/nginx with a disposable local registry,
small app-protocol fixtures and private test volumes, including in-flight writes,
retained assets, rejected migration/health/configuration failures and interrupted
cutover recovery. A disposable PostgreSQL instance also verifies coherent backup
archives, checksums and writer resumption after a failed dump. It does not contact the Pi or validate application schema/API
compatibility; `npm run verify:release` separately covers the actual application.
Both suites gate image publishing in GitHub Actions.

Both app versions share live PostgreSQL and media briefly. All migrations and
HTTP contracts must therefore remain backward compatible, including requests from
older browser tabs. Destructive changes still require an explicitly planned
maintenance window. Single-host/database/tunnel failures and quiesced backups are
not made highly available by this change.

### One-time Pi installation (requires deployment-capable access)

1. Review the **actual** local Compose, timer/service, backup script and tunnel
   configuration without printing credentials. Check Docker Compose >= 2.24.4,
   Python 3, free disk/RAM for two app processes, and loopback port 3013 availability.
   The overlay assumes the same Compose project `lastpeek`, default network and
   volumes as the current deployment. Remove or explicitly reset inherited
   `container_name`, conflicting network aliases, or other host-specific settings
   before using it; confirm rendered slot ports are empty. Do not print the full
   rendered configuration/environment.
2. Stop the update timer and wait for its active service. Preserve the existing
   config/scripts privately and take a coherent backup using the current runbook.
   Do not change or restart unrelated Pi services.
3. Copy `deployment/update.py` and `deployment/compose.blue-green.yaml` directly
   into `~/lastpeek-deploy`. Create `routing/` and `assets/` (0755), and copy
   `deployment/nginx.conf` to `routing/nginx.conf`. Create `images.env` containing
   exactly `BLUE_IMAGE`, `GREEN_IMAGE`, and `MAINTENANCE_IMAGE`, each initially set
   to the existing app's full `ghcr.io/alexanderheffernan/lastpeek@sha256:…` digest.
   Keep `.env` unchanged and private; never source unreviewed environment files.
4. Run `python3 ~/lastpeek-deploy/update.py` while the legacy web and tunnel still
   serve users. Check the proxy's loopback `/health` revision and landing page.
   Bootstrap failure leaves the legacy web untouched. Verify retained asset URLs,
   sessions and private media before public cutover.
5. With the shared deployment lock held, change **only** LastPeek's tunnel ingress
   from `web:3000` to `proxy:3000` and apply that connector change. This one-time
   tunnel transition may still interrupt requests. Check public health and the
   page before stopping legacy `web`; preserve it for controlled reversal.
6. Install `deployment/backup.sh` as `~/lastpeek-deploy/backup.sh` **before
   re-enabling unattended updates**. Preserve any operator-local `DOCKER_CONFIG`
   environment assignment when installing both updater and backup invocation.
   The backup holds the same lock through cleanup, stops both slots and
   maintenance, and resumes only the previously running active app and maintenance
   independently, even after failure. It preserves database/media, checksums,
   images, overrides, private resolved environment, routing and tooling in a
   private `~/lastpeek-backups/` snapshot. Treat the entire snapshot as secret;
   failed snapshots retain `.partial`. It never resumes legacy web or both slots.
   After resumption it reloads proxy DNS and verifies routed health, since Docker
   may assign the app a different address after stop/start.
   An old backup script that stops only web is not safe here.
7. Install the updated root-owned `scripts/operator-gateway.py` so restricted
   tools select the active slot. Check `service_status` and administration reads;
   do not reinstall SSH keys or broaden gateway permissions. Update the existing
   systemd service to execute `/usr/bin/python3 /home/alexh/lastpeek-deploy/update.py`
   directly (no outer flock, since Python owns the lock), with a startup timeout
   of at least 20 minutes. Reload user systemd and re-enable the existing timer.
8. Verify a subsequent application handover with continuous public health reads,
   a session kept open across the release, autosave/comment requests and attachment
   downloads. Verify the exact deployed SHA and confirm only one app slot and one
   maintenance worker remain running after drainage. Never run production E2E.

For blue-green diagnostics, use the fixed Compose prefix below and select the
active app (`blue` or `green`) from `routing/active.conf`, not legacy `web`:

```sh
docker compose --env-file .env --env-file images.env -f compose.yaml -f compose.override.yaml -f compose.blue-green.yaml --profile blue-green ps
```

To pause updates, stop the same timer and wait for its active service as before.
For a later rollback, hold the deployment lock, verify schema compatibility, and
prepare/health-check the known-good slot/image before changing the desired route
and gracefully reloading nginx. Keep maintenance pinned consistently. Do not run
the legacy `compose up web maintenance` updater after cutover, and do not assume
switching containers can undo a schema migration or restore deleted data.

For legacy single-web diagnostics only, run from `~/lastpeek-deploy`:

```sh
docker compose ps
docker compose logs --tail=80 web maintenance tunnel
journalctl --user -u lastpeek-update.service -n 80 --no-pager
systemctl --user status lastpeek-update.timer
docker compose exec -T web node -e "fetch('http://127.0.0.1:3000/health').then(async r=>{console.log(r.status,await r.text());process.exit(r.ok?0:1)})"
docker inspect "$(docker compose ps -q web)" --format '{{.Config.Image}} {{.Image}}'
```

Do not print the full `docker inspect` environment or rendered Compose configuration: they contain the database password. Do not run the repository E2E suite against this instance.

## Accounts and privacy

There is no default production account/password and no open registration. Bootstrap an administrator with a unique email and randomly generated password using `npm run db:seed` inside web, passing the password via exported environment, never a command-line literal or GitHub secret. Use the README's password-reset CLI for recovery; it invalidates existing sessions. Keep any initial credential file 0600 and remove it after delivery to the owner. The site owner invites authors from site admin Invitations, binding each invitation to an email and plan; reviewers need no account.

Better Auth runs locally, with no hosted auth or SMTP dependency. Its signing key is generated on first authentication and saved as `.auth-secret` (0600) in the persistent private media volume, unless `BETTER_AUTH_SECRET` is provided through the server environment. Back up hidden files too; if using the environment override, back that secret up separately. A database-only leak does not provide the key needed to sign session cookies. Never serve, print or commit this file. Losing/rotating the key signs out new-style sessions, not accounts. The additive authentication migration retains existing account IDs, password hashes and legacy sessions; password changes/recovery revoke both session formats. Rollbacks can still use the legacy account and session tables.

The hosted service is a trusted-invitee trial. Per-author media quotas do not bound total draft/revision/comment text or total disk use. Monitor disk space, memory, restarts and public health. Do not invite untrusted users or promise durable storage before an encrypted off-device backup destination and alerting have been configured.

## Backups and recovery

The Pi deployment includes an operator-local `backup.sh`. It quiesces web/maintenance, captures `pg_dump -Fc` and the matching media archive with checksums and image metadata in a private local directory, and resumes writers. Keep database and media together. A local snapshot does **not** survive Pi/disk loss; an encrypted off-device destination and retention/alerting policy must be supplied before relying on this service for irreplaceable drafts. Never store backups in the public repository or container registry.

For a portable deployment, the equivalent procedure is: pause automatic updates; stop web and maintenance; dump PostgreSQL; archive the matching media volume preserving ownership/permissions; record the running commit/image digest and checksums; restart writers; encrypt and transfer the snapshot off-device. Always resume writers even when backup creation fails. Check available disk before taking a snapshot.

Restore only into **new isolated volumes and a separate Compose project** first. Restore the database with `pg_restore`, restore media with UID 1000 ownership and private permissions, and run the matching source/image. Verify account login, immutable revision/comment relationships, revocation, and attachment bytes against checksums. Never use `docker compose down -v` on the live project.

To pause unattended updates, stop `lastpeek-update.timer` and wait for any active `lastpeek-update.service` to finish; disable the timer too if the pause must survive reboot. To roll back, change **both** web and maintenance image references to a known-good full SHA tag, pull, and recreate them. An older image is only safe if the current schema is compatible. Otherwise stop writers and restore the matching database/media snapshot together; restoring old data discards later writes. `latest` is mutable and is not a backup or a rollback identifier. Re-enable/start the timer deliberately after resolving the incident.

## Self-hosting elsewhere

Clone the source and use the root `compose.yaml`, setting your own `ORIGIN` before building and a random hex `POSTGRES_PASSWORD` in an ignored 0600 `.env`. The official prebuilt images bake in the official domain and cannot be repointed merely by changing the runtime environment. Build your own image for another domain. Put an HTTPS proxy in front of the loopback port, configure only trusted client-IP forwarding, persist both volumes, and arrange hourly maintenance, updates and coherent encrypted backups. No GitHub, Cloudflare or external AI/social service is mandatory.

The source and AGPL licence are included in the runtime image; the UI links to the public source repository. Preserve dependency notices. If distributing modified images or operating modified network services, provide the corresponding source and update the source link as required by AGPLv3.
