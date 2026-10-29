# Hosting and automatic updates

## Official Raspberry Pi service

The official origin is `https://lastpeek.alexheffernan.dev`. The Pi 5 runs ARM64 Linux and Docker Compose. Its isolated deployment directory is `~/lastpeek-deploy`; credentials and host-specific routing configuration are intentionally not committed. Existing The Last Light and Dead Kingdoms services are separate and must not be restarted or reconfigured for LastPeek.

The service contract is:

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

On the official repository's `main`, a second job uses the workflow's short-lived `GITHUB_TOKEN` with `packages:write` to build and push AMD64/ARM64 images. There is no stored SSH or Pi secret in GitHub. Tags are `latest` and the full source commit SHA; the OCI revision label identifies the source. The GHCR package must be public so the Pi can pull without registry credentials.

`lastpeek-update.timer` runs `~/lastpeek-deploy/update.sh` every 60 seconds. User lingering is enabled so it survives logout/reboot. The script takes `.deployment.lock`, pulls only web and maintenance, then runs `docker compose up -d --no-deps --wait web maintenance`. Compose leaves unchanged containers alone. The backup script takes the same lock, preventing updates from restarting writers during a snapshot. No registry password is needed: the image package is public.

A push is **not** immediately a deployment: checks/build must finish, then the timer and container startup pass. Verify the workflow result, running image revision, health and public page. `/health` returns the build's full source SHA in `X-LastPeek-Revision` (`development` outside a versioned image), allowing public checks to detect unexpected deployments. Replacement is not a transactional deployment or automatic health-based rollback; expect a brief interruption. All future migrations must be compatible with the previous image; stop unattended updates for destructive schema changes and take a coherent backup first.

To diagnose on the Pi, run from `~/lastpeek-deploy`:

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

There is no default production account/password and no open registration. Bootstrap an administrator with a unique email and randomly generated password using `npm run db:seed` inside web, passing the password via exported environment, never a command-line literal or GitHub secret. Use the README's password-reset CLI for recovery; it invalidates existing sessions. Keep any initial credential file 0600 and remove it after delivery to the owner. Administrators invite authors from Settings; reviewers need no account.

The hosted service is a trusted-invitee trial. Per-author media quotas do not bound total draft/revision/comment text or total disk use. Monitor disk space, memory, restarts and public health. Do not invite untrusted users or promise durable storage before an encrypted off-device backup destination and alerting have been configured.

## Backups and recovery

The Pi deployment includes an operator-local `backup.sh`. It quiesces web/maintenance, captures `pg_dump -Fc` and the matching media archive with checksums and image metadata in a private local directory, and resumes writers. Keep database and media together. A local snapshot does **not** survive Pi/disk loss; an encrypted off-device destination and retention/alerting policy must be supplied before relying on this service for irreplaceable drafts. Never store backups in the public repository or container registry.

For a portable deployment, the equivalent procedure is: pause automatic updates; stop web and maintenance; dump PostgreSQL; archive the matching media volume preserving ownership/permissions; record the running commit/image digest and checksums; restart writers; encrypt and transfer the snapshot off-device. Always resume writers even when backup creation fails. Check available disk before taking a snapshot.

Restore only into **new isolated volumes and a separate Compose project** first. Restore the database with `pg_restore`, restore media with UID 1000 ownership and private permissions, and run the matching source/image. Verify account login, immutable revision/comment relationships, revocation, and attachment bytes against checksums. Never use `docker compose down -v` on the live project.

To pause unattended updates, stop `lastpeek-update.timer` and wait for any active `lastpeek-update.service` to finish; disable the timer too if the pause must survive reboot. To roll back, change **both** web and maintenance image references to a known-good full SHA tag, pull, and recreate them. An older image is only safe if the current schema is compatible. Otherwise stop writers and restore the matching database/media snapshot together; restoring old data discards later writes. `latest` is mutable and is not a backup or a rollback identifier. Re-enable/start the timer deliberately after resolving the incident.

## Self-hosting elsewhere

Clone the source and use the root `compose.yaml`, setting your own `ORIGIN` before building and a random hex `POSTGRES_PASSWORD` in an ignored 0600 `.env`. The official prebuilt images bake in the official domain and cannot be repointed merely by changing the runtime environment. Build your own image for another domain. Put an HTTPS proxy in front of the loopback port, configure only trusted client-IP forwarding, persist both volumes, and arrange hourly maintenance, updates and coherent encrypted backups. No GitHub, Cloudflare or external AI/social service is mandatory.

The source and AGPL licence are included in the runtime image; the UI links to the public source repository. Preserve dependency notices. If distributing modified images or operating modified network services, provide the corresponding source and update the source link as required by AGPLv3.
