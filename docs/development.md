# Development and self-hosting

LastPeek’s core runtime is Node, PostgreSQL and a private media directory. X, OpenAI, Cloudflare and Amp are optional. For the product overview, start with the [README](../README.md).

## Local development

Requires Node 22.17+, PostgreSQL 14+ and FFmpeg for video link-preview thumbnails. On Debian, install `ffmpeg fontconfig-config fonts-dejavu-core fonts-noto-color-emoji fonts-noto-cjk` for the same preview rendering as the container. Create a dedicated development database, not one used by another application.

```sh copy Copy Local Setup
npm ci
cp .env.example .env
# Set DATABASE_URL to your dedicated database and set SEED_EMAIL / SEED_PASSWORD.
npm run db:migrate
npm run db:seed
npm run dev
```

Open the address printed by Vite. Seeding creates an administrator and sample thread only if that email does not already exist. Passwords must be 12–256 characters; rerunning the seed never resets an existing account or password. Keep `.env` private and untracked.

Set `LASTPEEK_OWNER_ID` to the bootstrap account’s UUID to enable site-owner administration. The owner invites authors from site admin Invitations, choosing Free or Pro and manually sending the single-use, seven-day registration link. Invitations are email-bound, not mailbox verification. There is no SMTP requirement or public registration.

### Production build

```sh copy Copy Production Build
ORIGIN=https://lastpeek.example npm run build
npm start
```

Replace the example domain with your own. SvelteKit uses `ORIGIN` at build time; changing it requires rebuilding. Use HTTPS through your own reverse proxy and configure trusted client-address forwarding for that proxy. Keep PostgreSQL and media off public ports. `/health` checks database availability without exposing draft content.

## Docker Compose

The root `compose.yaml` runs PostgreSQL 16, the non-root Node server and hourly maintenance, with persistent database and media volumes. Builds support AMD64 and ARM64.

Create a private `.env` from [`.env.example`](../.env.example). Set `POSTGRES_PASSWORD` to a random hex value, for example generated with `openssl rand -hex 32`, and set `ORIGIN` to your public address **before building**. `APP_PORT` defaults to 3000 and binds to loopback for a local reverse proxy.

Export `SEED_PASSWORD` securely in your shell before bootstrapping; do not put a real password in command history. Replace the example email below with your own.

```sh copy Copy Container Setup
docker compose up --build -d
docker compose exec -e SEED_EMAIL=you@example.com -e SEED_PASSWORD web npm run db:seed
```

The bootstrap command passes the exported password into the container. Configure `LASTPEEK_OWNER_ID` with the resulting account ID and recreate the application services after configuration changes. Migrations run before web startup. Keep volumes when restarting: **`docker compose down -v` destroys all data**.

Official images at `ghcr.io/alexanderheffernan/lastpeek` bake in the official service’s origin. Build from source for your own domain. See [deployment](deployment.md#self-hosting-elsewhere) for HTTPS, source-distribution obligations and operating requirements.

## Optional integrations

All credentials are server-only. Never use `PUBLIC_` variables for secrets. Optional provider features retain the account’s Pro requirements, usage allowances and instance-wide safety limits; configuring a credential does not grant account access.

### X sign-in and publishing

Configure OAuth 2.0 for a confidential **Web App** in the X Developer Console. Register the exact callback `https://your-host/auth/x/callback`, then set `X_CLIENT_ID` and `X_CLIENT_SECRET`. Each development or deployed origin needs its own matching callback. Buttons stay hidden without both credentials.

Invited users can sign up with X; existing users can link X in Settings → Connections and choose whether to import their name and photo. The handle comes from the connected X account. Linking never changes existing shared snapshots. X-only accounts need a local password before disconnecting.

Sign-in uses PKCE and read/offline scopes. Publishing requests additional posting and media permissions through an explicit account action; connecting never posts automatically. Pro publishing supports ordered threads, replies and quotes, with photos, a GIF or video, subject to X’s restrictions. Partial publication resumes only after confirmation, and uncertain post-creation responses block retries rather than risking duplicate posts. See [product behaviour](product.md#x-publishing) and [operations](operations.md) for allowances and accounting.

### X source previews

Set `X_API_BEARER_TOKEN` to enable supported source-post lookups for Pro reply/quote drafts. This is separate from the OAuth client credentials. New relationships require a successful lookup; existing drafts remain editable when a source is unavailable.

`X_API_MONTHLY_BUDGET_USD` defaults to `5`; `0` disables budgeted X requests. Source lookups conservatively reserve US$0.05 per attempt before HTTP, including failures. Source cards cache for 15 minutes; failures back off for five minutes. Other X tools also consume the applicable account and instance budgets. Reservations are safety bounds, not provider invoices. Keep X’s own spending controls in place, especially when credentials or credits are shared with other applications. See [architecture](architecture.md) for caching, reservations and reconciliation.

Source reads do not send private draft text or review links to X. Source images and video load from X’s media hosts; no embed scripts are used. External source content is live, not archived in immutable draft revisions.

### Private AI review

Set `OPENAI_API_KEY` and restart web to enable new reviews for eligible Pro accounts. `OPENAI_MODEL` defaults to `gpt-6-luna`; unknown models fail closed until pricing and reservation bounds are supported.

Only an explicit review request sends ordered post IDs and text to OpenAI, not identity, media, discussion or review tokens. Requests use `store: false`, which is not a guarantee of zero provider retention; OpenAI’s applicable API policies still apply. Saved built-in reviews are private to the owner. Applying a suggested edit requires explicit action and unchanged reviewed text.

Requests are bounded to 20,000 input characters and 4,000 output tokens, with a 45-second timeout and no automatic retries. Database limits allow 20 attempts per author and 100 per instance per 24 hours. Each request reserves US$0.03 against the account allowance; known costs reconcile afterwards and unknown costs retain the reservation. Provider-level spending controls are still necessary.

### Agent connections

Agents is an account-gated trial, disabled by default. Compatible remote HTTP MCP clients connect at `/mcp` through OAuth consent, with independently revocable permissions and connection expiry. Agents cannot publish to X, delete drafts or change account security. See [agent setup and contracts](agents.md).

## Accounts, storage and recovery

Authentication runs in the same server and database using Better Auth. On first authentication, the server creates an owner-readable `MEDIA_DIR/.auth-secret`, unless a `BETTER_AUTH_SECRET` of at least 32 characters is supplied. Persist and back up the generated file, or back up the externally supplied secret separately. Changing it signs out Better Auth sessions and makes stored encrypted X credentials unusable until reconnection; it does not delete drafts or accounts.

Default Free allowances are 10 saved drafts and 250 MB of media; Pro defaults to 100 drafts, 2,048 MB, US$0.50 AI and US$1.50 X usage per monthly period. Owners manage these through site admin. Both plans default to 50 MB uploads. `MAX_UPLOAD_MB` is a transport ceiling; `BODY_SIZE_LIMIT` must leave room for multipart overhead (the supplied default is `55M`). Above-quota accounts keep editing and reviewing existing work; additions are blocked when they would exceed capacity. See [plan policy](product.md#free-and-pro-trial).

Media stays outside the public web root and is inspected on upload. Browser codec support still affects video playback; downloads preserve originals. Review revisions may retain removed attachments until the entire draft is deleted. Deleting a draft permanently removes its revisions, discussion and attachments; there is no automatic draft expiry.

`npm run maintenance` expires sessions and rate buckets, prunes temporary records, removes unattached uploads older than 24 hours and cleans orphan files. Compose and the orb configuration run it hourly; other installations need an hourly timer.

### Reset a password

Recovery is a local administrator operation, not an email service. In Bash, read a new password without echoing it and pass it through a temporary owner-readable file:

```sh copy Copy Password Recovery
umask 077
read -rs NEW_PASSWORD; printf '\n'
printf '%s\n' "$NEW_PASSWORD" > /tmp/lastpeek-password
unset NEW_PASSWORD
npm run account:reset -- author@example.com < /tmp/lastpeek-password
rm /tmp/lastpeek-password
```

Replace the email with the account to recover. Resetting invalidates all its existing sessions. For containers, replace the reset command with `docker compose exec -T web npm run account:reset -- author@example.com < /tmp/lastpeek-password`.

Back up the database **and** the matching private media directory, including hidden files, while web and maintenance writes are stopped. Restore both into an isolated instance and verify logins, reviews and attachments before relying on the backup. A database dump alone is incomplete. Encrypted off-device storage, capacity monitoring and restore rehearsals remain operator responsibilities. Read the [deployment runbook](deployment.md#backups-and-recovery) before storing irreplaceable work.

## Installed web app

On iPhone/iPad Safari, use **Share → Add to Home Screen** and enable **Open as Web App** if offered. Other supported browsers expose installation in their menu. Installed touch-screen apps use portrait orientation; fullscreen media may rotate where supported. Normal browser and desktop windows are unrestricted.

Push is opt-in per device and depends on browser/OS support. The service worker caches only the public offline retry page, never drafts, accounts, review links or media. Edits are not queued for background submission. Updates wait for existing application windows to close. `npm run pwa:generate` rebuilds icons and Apple launch images from `static/favicon.svg` using the screen definitions in `src/lib/pwa.ts`.

## Amp orb development

The optional `.agents/setup` installs dependencies, prepares a private development PostgreSQL cluster, migrates, seeds and builds. `.amp/services.yaml` supervises the database, web and hourly maintenance. Run `amp orb services ensure --json` and use the exact portal URL returned. Amp is not needed for other development or hosting.

The seeded trial email is `alex@lastpeek.test`; its random password is stored in that orb’s ignored `.env`. Development also offers **Dev sign in**, which uses `SEED_EMAIL`, grants Pro/admin access and makes that account the process’s site owner. It is enabled by Vite development or `DEV_SIGN_IN=1`. **Never enable it on a deployed instance.** Orbs are disposable; don’t store irreplaceable drafts in them.

## Verification and contributing

Read [contribution guidance](../CONTRIBUTING.md), [product scope](product.md), [architecture](architecture.md) and [project guidance](../AGENTS.md) before changing behaviour.

```sh copy Copy Verification Commands
# One-time browser/system dependencies:
npm run browsers:install
# Full release gate, using disposable fixtures:
npm run verify:release
# Force fresh checks rather than reusing a matching local receipt:
npm run verify:release -- --force
# Select one core browser workflow:
npm run verify:focused -- --test 'core / create and edit'
# Reproduce one workflow on WebKit:
npm run verify:focused -- --browser webkit --test 'core / reviewer'
# Run a server/HTTP file once without browsers:
npm run verify:focused -- --browser none --file tests/drafts-http.test.ts
```

The verifier owns disposable databases, media, ports and servers. Its `DATABASE_URL` needs local database-creation privileges. Never point it at production or another verifier’s fixtures, overlap verifier invocations, or edit source during a full gate. Use a separate preview for screenshots. `--test` is a JavaScript regex; `--file` defaults to `tests/web.test.ts`. Invalid selections and zero matches fail.

CI is the authoritative full gate: formatting, types, unit tests, dependency audit, production build, migrations twice and server/HTTP contracts, plus five browser workflows and one service-worker privacy exception on desktop Chromium and mobile-sized WebKit. WebKit emulation is not a real iPhone. Feature changes normally need focused checks and temporary UI verification, not a new permanent browser journey. See [test policy](../AGENTS.md#test-cost-and-coverage).

Local receipts reuse successful checks only for unchanged tested inputs; CI runs fresh. Dependencies and writable check workspaces are isolated from the preview. Browser failures retain screenshots and error summaries under `.amp/in/verification-failures/`; CI keeps them for seven days. Use `DEBUG=pw:api` with a focused command for action timings. Low-level `test:integration`, `test:http` and `test:e2e` require their own correctly prepared disposable environment; prefer the managed verifier.

`src/lib/contracts.ts` owns draft contracts, `src/lib/server/` owns server-only operations, routes adapt them to HTTP, and shared Svelte components render author/reviewer posts. SQL migrations live in `migrations/`. Pull requests cannot publish deployment images; checked application changes on `main` publish images through GitHub Actions. See [deployment](deployment.md) for delivery and recovery.
