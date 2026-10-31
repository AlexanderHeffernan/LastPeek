# LastPeek

A second pair of eyes before you post. Write a post or thread, attach original media, and send a private review link to a friend. They can comment or suggest wording without an account. You decide what changes and when a new version is shared.

**Open source, early-stage and invite-only.** Website-first; the optional browser extension comes later. No social API, scheduling, automatic publishing, email provider, hosted auth, cloud storage, analytics or remote fonts are required. The complete runtime is Node, PostgreSQL and a private media directory on one host.

The official hosted service is [lastpeek.alexheffernan.dev](https://lastpeek.alexheffernan.dev). See [deployment and automatic updates](docs/deployment.md), [security and limitations](SECURITY.md), and [contributing](CONTRIBUTING.md). Self-hosting does not require the official service, GitHub Actions or Cloudflare.

## Licence

Copyright © 2026 Alexander Heffernan. LastPeek's original code is licensed under [GNU AGPL version 3 only](LICENSE), without warranty. You may self-host, modify and sell services subject to that licence, including its corresponding-source obligations for modified network services. Dependencies retain their own licences/notices. The LastPeek name and logo do not grant permission to imply an official service or endorsement. This project is not affiliated with X.

## Try it in an orb

An optional Amp orb setup is included for development. `.agents/setup` installs dependencies, prepares a private PostgreSQL development cluster, migrates and seeds once, and builds the app. It is safe to repeat and never resets an existing account. `.amp/services.yaml` supervises PostgreSQL, the website and hourly cleanup. Amp is not required to develop or host LastPeek.

Run `amp orb services ensure --json` inside an orb and use its exact portal URL. Trial email is `alex@lastpeek.test`; its randomly generated password is in that orb's ignored `.env` (`SEED_PASSWORD`). Orbs and `npm run dev` also show **Dev sign in**, which signs in as `SEED_EMAIL` without a password, grants Pro and admin access, and makes that account the site owner for the running development process. It is enabled only by Vite's dev server or `DEV_SIGN_IN=1`; never set that variable on a deployed instance. The portal is private to the thread by default. This is a personal trial, not an externally accessible reviewer beta. Never put real/irreplaceable drafts in an ephemeral orb.

## Local development

Requires Node 22.17+, PostgreSQL 14+ and FFmpeg for video link-preview thumbnails. On Debian, install `ffmpeg fontconfig-config fonts-dejavu-core fonts-noto-color-emoji fonts-noto-cjk` for the same preview rendering as the container. Create a **dedicated development database**, not a database used by another application.

```sh
npm ci
cp .env.example .env
# Set DATABASE_URL to the dedicated database, and set SEED_EMAIL / SEED_PASSWORD.
npm run db:migrate
npm run db:seed
npm run dev
```

Open the address printed by Vite. Bootstrap creates an administrator and sample thread only when that email does not already exist. Passwords must be 12–256 characters. Existing accounts and passwords are never reset by seeding. Configure `LASTPEEK_OWNER_ID` for site admin. The owner invites an email address as Free or Pro from site admin Invitations and sends the single-use seven-day link manually. Signup is bound to that email, without mailbox verification or SMTP. Account settings no longer manage invitations.

Authentication uses self-hosted Better Auth in the same server and database. Existing passwords, account IDs and active legacy sessions survive the migration. Public registration and generic auth API endpoints are disabled; invitation-only registration and local administrator recovery remain available. On the first authentication request, LastPeek creates an owner-readable `.auth-secret` in `MEDIA_DIR` for signing cookies. Keep the private media volume persistent and include hidden files in backups. Alternatively provide a random `BETTER_AUTH_SECRET` of at least 32 characters through your secret manager, and back it up separately. Losing or changing this key signs out Better Auth sessions; it does not delete accounts or drafts. No email service, social account or hosted auth subscription is required.

### Optional X sign-up and account linking

Enable OAuth 2.0 in the X Developer Console for a **Web App** (confidential client), with read permissions. Register the exact callback `https://your-host/auth/x/callback` (the hosted service uses `https://lastpeek.alexheffernan.dev/auth/x/callback`). Set server-only `X_CLIENT_ID` and `X_CLIENT_SECRET` and restart web; these are separate from `X_API_BEARER_TOKEN`. Never use `PUBLIC_` variables. Local testing needs its own exact callback URL. Buttons are hidden unless both credentials are configured.

Invitations offer **Sign up with X** with an account email and no password; name, handle and photo are imported automatically. Email is user-supplied and unverified, never used to auto-link identities. Existing users choose **Link X account** under Account → Connections. A one-time **Connected to X** dialog previews the photo and offers independent photo, display name and handle choices. **Keep current profile**, the close button or Escape dismisses these choices without changing the profile; they do not remain in settings. Connections shows the linked handle/status and disconnect, with reconnect offered when the access token has expired without refresh credentials. Linked users can sign in with X. Reconnect refreshes consent and offers the profile choices again; it never silently overwrites the LastPeek profile. Shared snapshots keep their original identity.

OAuth uses PKCE S256, short-lived single-use browser-bound state and only `tweet.read users.read offline.access` (no posting permissions). Access/refresh tokens, expiry and granted scopes are stored server-side; tokens use authenticated encryption with the private auth key. Back up that key: losing/rotating it makes stored X tokens unusable, requiring reconnection. Future user-specific API features must implement refresh-token rotation and request limits before using these credentials; no background API use or posting is enabled here. X identity reads may incur provider charges and are separate from the source-post budget. Set spending limits in X's console.

X-only users can set a local password in Account. Disconnect requires a password so it cannot strand the account; it deletes locally stored X tokens, not the profile or drafts. Users can also revoke the application's grant in X. Administrator password recovery remains available if access to X is lost.

```sh
ORIGIN=http://localhost:3000 npm run build
npm start
```

SvelteKit 3 uses `ORIGIN` at **build time** through `paths.origin`; changing it requires rebuilding. Production requires an exact public `ORIGIN`, HTTPS via your own reverse proxy, and persistent database/media volumes. Orbs intentionally build without a fixed origin: adapter-node derives HTTPS and the incoming portal Host. Configure trusted proxy/client-address handling for your actual proxy before beta; do not trust arbitrary forwarded headers. Keep database and media off public ports. `/health` checks database availability without exposing content.

## Portable container stack

`compose.yaml` defines PostgreSQL, the non-root Node server, and an hourly maintenance process. The Dockerfile supports AMD64 and ARM64. The official workflow publishes both architectures to `ghcr.io/alexanderheffernan/lastpeek`; those images bake in the official service's origin. **For your own domain, build from source with your own `ORIGIN`.** See [deployment](docs/deployment.md) for the Pi's image-based setup.

Set `POSTGRES_PASSWORD` in `.env` to a random hex string (for example, generated with `openssl rand -hex 32`), and set `ORIGIN` for the address you will open. `APP_PORT` defaults to 3000. The web port binds only to loopback, ready for a local reverse proxy.

```sh
docker compose up --build -d
docker compose exec -e SEED_EMAIL=you@example.com -e SEED_PASSWORD web npm run db:seed
```

Export `SEED_PASSWORD` in your shell before the bootstrap command, or supply it through your own secret-management workflow; do not put a real password in shell history. `docker compose exec -e SEED_PASSWORD` passes the exported value. Database migrations run before the web server starts. Keep volumes when restarting; **`docker compose down -v` destroys all data**.

## What is supported

- Ordered threads (up to 25 posts), display name/handle, multiline Unicode text and X weighted-character warnings. Standard 280-character warnings do not forbid Premium-length drafts.
- Up to four JPEG/PNG/WebP/AVIF images, one GIF, or one MP4/WebM video per post. Original bytes, image grids, video controls/seeking, upload progress/retry, reordering, downloads. HEIC/MOV/SVG/HTML are rejected with an explanation. Browser codec support still matters; downloads remain available.
- Private autosave with stale-edit conflict detection. **Share draft / Update shared version** publishes an immutable snapshot, not the evolving working copy. A shared link stays stable across version updates.
- Account-free guest feedback tied to the reviewed version/post, optional replacement wording, explicit author acceptance, resolve/reopen, and historical previews. Guest names are unverified. Feedback is visible to everyone holding that review link.
- Random 256-bit review links, revocation, renewal with a different token, and owner/capability checks on every attachment. Revocation prevents future server access; it cannot erase copies recipients already downloaded.
- Copy individual posts/thread text and download attachments for manual posting. Copying cannot attach files in X.

Previews approximate X, not pixel-perfect parity. Avatars currently use initials; identity is entered manually. No link-card scraping, polls, quotes, Premium rich text, transcoding, real-time co-editing or automatic X sync. The previous Safari/HTML prototype is preserved in the first Git commit, not maintained as a second app in the active tree.

## Installed web app

In iPhone/iPad Safari, use **Share → Add to Home Screen** (enable **Open as Web App** if offered). Desktop Chrome/Edge and Android Chrome offer installation from their browser menu. LastPeek opens in its own window with a dark launch screen, its own icon, and safe-area spacing. Apple launch images cover common full-screen phone/tablet sizes in both orientations; iPad multitasking and future screen sizes may use the OS fallback.

Installed mobile/tablet apps are portrait-only. The manifest requests portrait; iOS does not enforce that setting, so rotating an installed touch-screen app shows a portrait prompt without losing the page or unsaved form state. Fullscreen media may rotate where the browser permits it, then returns to portrait (or the prompt) on exit. Normal browser windows and desktop layouts remain unrestricted. Landscape Apple launch images remain as a fallback for iOS launches before the portrait prompt appears.

The app still needs a connection. A small service worker caches **only** a public offline retry page, never drafts, review links, accounts, or media. Failed edits retain the existing inline save errors; nothing is queued for background submission. Updates wait until existing app windows close rather than replacing an active composer. iOS controls when installed icons and launch screens refresh; an existing installation may need to be removed and added again to refresh its install assets (save any open edits first).

`npm run pwa:generate` rebuilds the checked-in icons and Apple launch images from `static/favicon.svg`. Screen sizes and matching launch links share `src/lib/pwa.ts`.

## Optional X source previews

Quotes and replies require Pro; see [plan administration](docs/operations.md). The menu is
hidden without access. Server checks use the draft owner, including for anonymous
reviewers, before any cached read or paid lookup. Revoking access leaves existing
drafts editable and replaces source previews with the unavailable status.

Set `X_API_BEARER_TOKEN` in the server's secret environment to render public source posts as native cards for reply/quote drafts. No X user login or posting permissions are needed. Without a token, with unavailable/unsupported posts, or at the request budget, quote/reply creation returns “Quotes and replies aren’t available right now.” Existing drafts remain editable and show that status in place of the source card. There is no embed fallback. The token is never sent to browsers. X images/videos load directly from its fixed media hosts with no referrer; no draft text or review URL is sent to the API.

`X_API_MONTHLY_BUDGET_USD` defaults to `5`; `0` disables API lookups. Each instance reserves **US$0.05 per lookup attempt** in PostgreSQL before making the request, including failures. The reservation is deliberately conservative, not actual billed spend: announced rates for one post, its author and four media objects total US$0.035. At the default budget this permits 100 attempts per UTC calendar month, including refreshes. It does not automatically purchase credits or change X billing settings. Instances/apps sharing X credits have separate counters; keep X's own account spending limit and auto-recharge settings in place, and review the reservation if provider pricing changes.

Successful source cards cache for 15 minutes across drafts/reviewers; failures back off for five minutes, with no automatic HTTP retries. Page loads revalidate expired entries, never displaying expired content. Autosave makes no lookup. Maintenance removes expired source content; source cards are not stored in immutable draft revisions or review-preview images. Sensitive, edited, quoted/reposted sources and polls are unavailable until their required presentation is supported. The API is optional and does not publish to X. Apply SQL migrations before starting the new version. Configure the production secret separately from Amp's development project secrets.

## Optional AI second look

Set `OPENAI_API_KEY` in the server's secret environment and restart web. Pro accounts can use **AI second look** beside author feedback within their monetary allowance. With no key or on Free, the control is hidden and the complete human-review workflow remains available. See [plan administration and agent operations](docs/operations.md). Never put the key in a `PUBLIC_` variable or the browser. `OPENAI_MODEL` defaults to `gpt-6-luna`; unknown models fail closed until verified pricing and reservation bounds are added.

Review is explicit, never triggered by autosave. Only the current ordered post IDs and text are sent to OpenAI, not the author's identity, title, attachments, comments or review token. Requests use `store: false` (not a guarantee of zero provider retention; OpenAI's applicable API data policies still apply). Findings live only in the current editor session, are never published as guest feedback, and never change drafts or shared revisions. Editing/reordering posts marks existing feedback as earlier-text feedback, with the original text available for comparison.

Requests are bounded to 20,000 characters and 4,000 output tokens (including reasoning), with a 45-second timeout and no automatic retries. Database-backed safety limits allow 20 attempts per author and 100 per instance per 24-hour window, including failed provider requests. In addition, each request reserves US$0.03 against the account's current AI allowance before HTTP. Known token costs reconcile afterward; unknown costs retain the reservation. Keep provider project-level spending controls: other apps sharing the key/project and pricing changes still affect spend. No web-search or other paid tools are enabled.

The server-only `src/lib/server/openai.ts` owns credentials, model selection, transport, timeout, non-storage and validated structured responses. New features can reuse `generateStructured` with their own schema and instructions; routes still enforce owner/origin checks, input bounds and usage limits. Keep features opt-in rather than introducing a general chatbot or mandatory provider dependency.

## Limits, maintenance and recovery

Free defaults to 10 drafts and 250 MB; Pro to 100 drafts and 2,048 MB, plus US$0.50 AI and US$1.50 X per monthly period. Both allow 50 MB uploads. The owner controls allowances in site admin: Free changes immediately, Pro increases immediately and reductions at the next individual renewal. Above-limit accounts keep existing content. `MAX_STORAGE_MB` is superseded by plan settings. `MAX_UPLOAD_MB` remains a transport ceiling; `BODY_SIZE_LIMIT=55M` must exceed it plus multipart overhead. Uploaded files are MIME-inspected, images have a 40-megapixel decode bound, and files never live in `static/`. Video containers are detected, not transcoded or exhaustively decoded server-side. See [product policy](docs/product.md). Deploy only for trusted invitees until beta hardening and capacity checks are complete.

Dependency audit currently reports a low-severity prototype-poisoning advisory in `deepmerge` 4.3.1, inherited through Svelte's build tooling. That is the latest upstream version at the time of this MVP; draft input is not passed to that build-time merge. Track an upstream fix before broader release rather than applying npm's incompatible forced downgrade.

`npm run maintenance` expires sessions/rate buckets, removes uploads unused for 24 hours, and cleans stale orphan files. Compose/orbs run it hourly; other deployments need their own hourly timer. Published revisions retain their original media until draft deletion. Deleting a draft permanently removes its versions, comments and media. There is no automatic draft expiry.

Password recovery is a **local administrator operation**, not an email dependency:

```sh
# Store a new password in a temporary owner-readable file without echoing it.
umask 077
read -rs NEW_PASSWORD; printf '\n'
printf '%s\n' "$NEW_PASSWORD" > /tmp/lastpeek-password
unset NEW_PASSWORD
npm run account:reset -- author@example.com < /tmp/lastpeek-password
rm /tmp/lastpeek-password
```

Resetting invalidates all existing sessions. For container use, pipe the password file into `docker compose exec -T web npm run account:reset -- author@example.com` instead.

Rehearse **backup and restore**: stop web and maintenance writers, take `pg_dump` plus a matching copy of the private media volume, restart writers, and restore both into an isolated instance to verify logins, shared revisions and original attachment checksums. A database dump alone is not a complete backup. Local snapshots are not protection against losing the Pi or its disk; encrypted off-device storage and alerts remain an operator responsibility. See [the deployment runbook](docs/deployment.md) before storing irreplaceable drafts or expanding beyond trusted invitees.

## Verification and code map

```sh
# One-time browser + system dependency setup (included in orb setup):
npm run browsers:install
# Local PostgreSQL must be running; DATABASE_URL supplies local admin access.
npm run verify:release
# Ignore the local verification receipt and rerun everything:
npm run verify:release -- --force
# Reproduce one test on both engines, with independently owned fixtures:
npm run verify:focused -- --test 'videos autoplay inline'
# Reproduce a WebKit failure without unrelated tests/checks:
npm run verify:focused -- --browser webkit --test 'friends require consent'
# Or run a complete selected test file:
npm run verify:focused -- --browser chromium --file tests/x-publishing.test.ts
```

Release verification checks formatting/types/unit tests and dependency advisories, builds a production server, applies migrations twice, runs server-only integration and HTTP/image tests once, and runs all browser tests in Chromium and WebKit. Build and type checks use separate writable private copies and run concurrently. Browser scenarios run in bounded parallel shards (at most four workers, limited by CPU availability); **each shard** owns a fresh database cloned from the migrated template, private media, server and loopback ports. Large author journeys are independently selectable scenarios, not prerequisites for other tests. A remainder shard includes any new or renamed web tests automatically, so the scheduling list cannot silently omit coverage. Long shards start early to avoid an idle tail.

Verification builds once in SvelteKit's supported proxy-derived origin mode. Each shard has a loopback-only gateway that sets the trusted protocol header; browser Origin headers and CSRF checks remain unchanged. Production's fixed build-time origin configuration is not modified. Synthetic OAuth credentials never call real providers. PostgreSQL credentials must allow creating/dropping databases; non-local database hosts are rejected (CI also accepts its `postgres` service). Verification never clears preview/production rate limits, touches preview media or rebuilds the running portal. Fixtures are removed after success or failure; disposable servers exit when HTTP drains rather than waiting on idle database pools. Locked npm dependencies are installed in a private cache keyed by package/lockfile and Node/platform version, then copied (never symlinked or hard-linked) into each workspace; neither the cache nor the preview's dependencies are mutated by checks/builds. Linux uses native copy/reflink support with copy-on-write isolation. Delete `.amp/in/verification-deps-*` to discard dependency caches. Each command, complete shard and complete invocation report wall-clock timings, including setup and cleanup.

A local receipt under `.amp/in/release-verification.json` reuses a successful browser/build check only while application, test, lockfile, workflow and tooling contents and the Node/platform version are unchanged. Documentation-only edits and commit/rebase metadata do not invalidate it. Formatting and dependency audit always rerun; CI always performs full verification. Fetch before verifying and rerun the command after integration: it decides whether the tested inputs still match, rather than blindly repeating the suite. Visual inspection/recordings are separate evidence and still required for UI changes.

Use `verify:focused` while iterating: it builds the real production stack, owns its database/media/server lifecycle, and runs only the selected tests, with engines running concurrently. It defaults to both engines; `--test` is a JavaScript regular expression and `--file` defaults to `tests/web.test.ts`. For example, `--test 'author / composer and media'` no longer runs authentication, account configuration, clipboard, invitations and every review scenario first. Invalid selections and zero matching tests fail. It skips formatting/audit/types/unit checks and the second migration pass, and never writes or invalidates a release receipt. Finish focused checks and visual review before the final full gate; edits during verification invalidate its result. Do not borrow another run's database/server or process environment or launch overlapping verifier invocations in one orb.

The low-level `npm run test:integration` requires a migrated **disposable** database/media environment. `npm run test:http` and `npm run test:e2e` also need its running production server; the latter runs only browser-dependent tests. `TEST_BASE_URL` selects its public origin and `TEST_BROWSER=webkit` selects WebKit. Tests and server must use the same database/media and public origin; a fixed origin, if configured, must match at build time. Prefer the managed verifier rather than assembling these fixtures yourself. `SCREENSHOTS=1` captures synthetic data under `.amp/in/artifacts/` (ignored locally); never commit private screenshots. Never run E2E against production. WebKit automation is not proof of every Safari/iPhone codec.

Publication provider/media contracts live in `tests/x-publishing-server.test.ts`; confirmation/hold/thread UI has its own independent fixture in `tests/x-publishing.test.ts`. Server-rendered preview PNG contracts live in `tests/review-card.test.ts` and need no browser launch. Each can be selected with `verify:focused -- --file <path>` (use `--browser chromium` for browser-independent files to run them only once). For browser diagnostics, prefix a focused command with `DEBUG=pw:api`; its synthetic-fixture logs reveal action timings without borrowing another verifier's environment. See [test cost and coverage guidance](AGENTS.md#test-cost-and-coverage) before adding tests.

`tests/fixtures/video.mp4` is a generated three-second silent H.264 clip (320 × 180, moving square), not user media. The image in browser tests is an intentionally solid-colour generated PNG.

`src/lib/contracts.ts` owns the draft contract. `src/lib/server/` owns auth, persistence and private media. Routes adapt those operations to HTTP; shared Svelte components render author/reviewer previews. `migrations/` contains ordered SQL migrations. Read [product scope](docs/product.md), [architecture/invariants](docs/architecture.md), and [agent guidance](AGENTS.md) before changing behaviour. GitHub Actions runs formatting, type checks, contract tests, dependency auditing and Chromium/WebKit E2E tests before publishing images on `main`. Pull requests cannot publish or deploy.
