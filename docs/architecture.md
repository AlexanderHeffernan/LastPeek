# Architecture and invariants

## One deployable application

SvelteKit renders the website and handles forms/API endpoints; adapter-node runs the production server. PostgreSQL owns identities, hashed sessions/invites, drafts, immutable shared snapshots, comments, media metadata and rate limits. Original uploaded bytes live outside the web root in a private filesystem volume. No social API, SMTP, hosted auth, CDN, analytics, cloud storage or remote font is required. `twitter-text` supplies X's standard weighted character count; count warnings do not forbid Premium-length drafts.

`src/lib/contracts.ts` is the shared validated draft format. `src/lib/server/auth.ts` owns local auth and request limits; `drafts.ts` owns save/publish contracts; `media.ts` owns private storage and limits. Route files enforce request identity/origin and adapt those operations to HTTP. Shared Svelte components render the same post/thread for authors and reviewers. Keep these boundaries; do not split services without a measured need.

## Working draft versus review

The author edits `drafts.content`. Each save compares `edit_version`; stale writes fail with 409 and leave the browser's text intact. Publication locks the draft and copies the saved JSON into a new numbered revision, atomically updating the shared revision. Publishing unchanged content must not create duplicate versions. Comments reference the original `(draft_id, revision)` and stable post UUID; updating or removing a post never reassigns old feedback. An explicit author action copies suggested text into the working draft only.

A 256-bit random review token is an unlisted bearer capability, not named-recipient authentication. Revocation removes it; a newly shared link gets a fresh token. Reviewer responses include only shared revisions and their media metadata, never the working draft. Original media access checks either owner session or a current review token and membership in a published snapshot. Old shared revisions remain available while that link is active. Files use opaque UUID names, no path input, no public static route, `nosniff`, no-store and no-referrer. MP4/WebM are served with byte ranges for seeking. Playback still depends on browser codec support; downloads preserve original bytes.

## Security and bounded operation

Passwords use salted scrypt, sessions/invites store SHA-256 token hashes, HTTP-only SameSite cookies and 30-day sessions. Password changes invalidate existing sessions. Form CSRF checks plus explicit JSON/multipart Origin checks remain enabled. SQL parameters, server-side author checks, database-backed attempt limits and MIME sniffing are mandatory. SVG/HTML/executables are not uploads. Images are inspected with bounded pixel dimensions. No private draft text is put in Open Graph metadata or error logs.

Defaults: 50 MB per upload, 500 MB per author, up to 25 posts and four images or one video/GIF per post. Large videos are not silently transcoded or replaced with stills. Adapter-node bounds request bodies, upload handlers count actual streamed bytes, and user-row locks serialize quota accounting. Store media on SSD for Pi use. Limits are operational defaults, not pricing tiers.

`npm run maintenance` expires sessions/rate buckets, removes uploads unattached for 24 hours, and removes stale orphan files. Shared revisions retain their media until draft deletion. Run maintenance hourly in deployment. No automatic draft expiry in this MVP. Administrators recover accounts with the documented local CLI, not email. Backups consist of a database dump and the matching private media directory, taken while writes are stopped. Restore must be rehearsed before a real beta.

## Development and delivery

`compose.yaml` runs the complete stack; local development can use an existing PostgreSQL instance and Vite. Environment is documented in `.env.example`; credentials and data are never committed. `scripts/migrate.ts` applies ordered SQL migrations under a database lock. Seed is idempotent and never resets existing credentials. Contract tests cover public data rules; browser/HTTP tests exercise the running stack with temporary accounts and data. The original Safari prototype is preserved in Git history only; extension development is deferred.

GitHub-hosted Actions checks pull requests without publishing permissions. Checked `main` commits publish ARM64/AMD64 GHCR images tagged with the full commit SHA and `latest`, with a fixed official origin. The Pi uses isolated PostgreSQL/media volumes, a dedicated Cloudflare Tunnel and a LastPeek-only user-systemd update timer; no public SSH or self-hosted CI runner is required. The updater and backups share a lock, and the existing apps' Watchtower service ignores LastPeek. Web startup applies migrations before serving. Migrations must remain backward compatible with the preceding image. See [deployment](deployment.md) for backup, rollback and operational limits.
