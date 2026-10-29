# LastPeek

A second pair of eyes before you post. Write a post or thread, attach original media, and send a private review link to a friend. They can comment or suggest wording without an account. You decide what changes and when a new version is shared.

**MVP, not a production/private-beta deployment.** Website-first; the optional browser extension comes later. No social API, scheduling, automatic publishing, email provider, hosted auth, cloud storage, analytics or remote fonts are required. The complete runtime is Node, PostgreSQL and a private media directory on one host.

## Try it in an orb

The personal Amp project maps to the private `AlexanderHeffernan/LastPeek` GitHub repository; Amp is not the Git host. `.agents/setup` installs dependencies, prepares a private PostgreSQL development cluster, migrates and seeds once, and builds the app. It is safe to repeat and never resets an existing account. `.amp/services.yaml` supervises PostgreSQL, the website and hourly cleanup.

Run `amp orb services ensure --json` inside an orb and use its exact portal URL. Trial email is `alex@lastpeek.test`; its randomly generated password is in that orb's ignored `.env` (`SEED_PASSWORD`). The portal is private to the thread by default. This is a personal trial, not an externally accessible reviewer beta. Never put real/irreplaceable drafts in an ephemeral orb.

## Local development

Requires Node 22.17+ and PostgreSQL 14+. Create a **dedicated development database**, not a database used by another application.

```sh
npm ci
cp .env.example .env
# Set DATABASE_URL to the dedicated database, and set SEED_EMAIL / SEED_PASSWORD.
npm run db:migrate
npm run db:seed
npm run dev
```

Open the address printed by Vite. Bootstrap creates an administrator and sample thread only when that email does not already exist. Passwords must be 12–256 characters. Existing accounts and passwords are never reset by seeding. Administrators create single-use seven-day invitations from Account settings; send the invitation yourself. No SMTP is needed.

```sh
ORIGIN=http://localhost:3000 npm run build
npm start
```

SvelteKit 3 uses `ORIGIN` at **build time** through `paths.origin`; changing it requires rebuilding. Production requires an exact public `ORIGIN`, HTTPS via your own reverse proxy, and persistent database/media volumes. Orbs intentionally build without a fixed origin: adapter-node derives HTTPS and the incoming portal Host. Configure trusted proxy/client-address handling for your actual proxy before beta; do not trust arbitrary forwarded headers. Keep database and media off public ports. `/health` checks database availability without exposing content.

## Portable container stack

`compose.yaml` defines PostgreSQL, the non-root Node server, and an hourly maintenance process. Images support AMD64 and ARM64; **the actual Pi and its media capacity still need testing before beta**. No Pi infrastructure is changed by this repository.

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

## Limits, maintenance and recovery

Defaults are 50 MB per upload and 500 MB per author (`MAX_UPLOAD_MB`, `MAX_STORAGE_MB`). The Node adapter's `BODY_SIZE_LIMIT=55M` must remain above the upload limit plus multipart overhead; adjust both if increasing uploads. Uploaded files are MIME-inspected, images have a 40-megapixel decode bound, and files never live in `static/`. Video containers are detected, not transcoded or exhaustively decoded server-side. Deploy only for trusted invitees until beta hardening and capacity checks are complete.

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

Before a real beta, rehearse **backup and restore**: stop web and maintenance writers, take `pg_dump` plus a matching copy of the private media volume, restart writers, and restore both into an isolated instance to verify logins, shared revisions and original attachment checksums. A database dump alone is not a complete backup. Decide retention, encrypted off-device storage, disk alerts, HTTPS and abuse limits before inviting real authors. These operational decisions/deployment are deliberately not automated here.

## Verification and code map

```sh
npm run format:check
npm run check
npm test
ORIGIN=http://127.0.0.1:4173 npm run build
npx playwright install chromium webkit
# Start the production build on 4173 against a disposable development DB:
PORT=4173 npm start
# In another terminal, using the SAME DATABASE_URL / MEDIA_DIR:
npm run test:e2e
TEST_BROWSER=webkit npm run test:e2e
SCREENSHOTS=1 npm run test:e2e
```

Browser tests create unique disposable accounts, exercise actual HTTP/auth/upload/review flows, and remove their own database rows/files. Do not point them at production. `TEST_BASE_URL` selects a different running instance. Screenshots contain synthetic test data under `.amp/in/artifacts/` (ignored locally); never commit private screenshots. WebKit automation is not proof of every Safari/iPhone codec.

`tests/fixtures/video.mp4` is a generated three-second silent H.264 clip (320 × 180, moving square), not user media. The image in browser tests is an intentionally solid-colour generated PNG.

`src/lib/contracts.ts` owns the draft contract. `src/lib/server/` owns auth, persistence and private media. Routes adapt those operations to HTTP; shared Svelte components render author/reviewer previews. `migrations/` contains ordered SQL migrations. Read [product scope](docs/product.md), [architecture/invariants](docs/architecture.md), and [agent guidance](AGENTS.md) before changing behaviour. Run verification locally or inside an orb. GitHub Actions is deliberately disabled for this private repository; do not add workflows.
