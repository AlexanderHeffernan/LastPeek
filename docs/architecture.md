# Architecture and invariants

## One deployable application

SvelteKit renders the website and handles forms/API endpoints; adapter-node runs the production server. PostgreSQL owns identities, hashed sessions/invites, drafts, immutable shared snapshots, comments, media metadata and rate limits. Original uploaded bytes live outside the web root in a private filesystem volume. No social API, SMTP, hosted auth, CDN, analytics, cloud storage or remote font is required. `twitter-text` supplies X's standard weighted character count; count warnings do not forbid Premium-length drafts.

`src/lib/contracts.ts` is the shared validated draft format. `src/lib/server/auth.ts` owns local auth and request limits; `drafts.ts` owns save/publish contracts; `media.ts` owns private storage and limits. Route files enforce request identity/origin and adapt those operations to HTTP. Shared Svelte components render the same post/thread for authors and reviewers. Keep these boundaries; do not split services without a measured need.

## Working draft versus review

Migration 033 adds same-draft comment reply roots, immutable attachment/time anchors and per-account
conversation read boundaries. `feedback.ts` owns both owner and reviewer writes. Owner comments
serialize against the edit version and snapshot saved content even before sharing; reviewer writes
retain capability/grant locks and the revision actually reviewed. Migration 039 separates the exact
reply target (`parent_id`) from its stable display branch (`thread_parent_id`). Under the draft lock,
a reply to a root starts its first tier, a reply to the latest live message continues that message's
tier, and a reply to an earlier message starts a branch. Historical replies keep their existing
grouping; writes from the preceding image use the exact parent as a fallback. Notifications,
resolution, ownership and deletion continue following exact ancestry. `discussions.ts` resolves notification destinations from ownership or participation plus current review
access. Reply notifications go to currently accessible account participants and the owner; their
destination rechecks access. There is no standalone discussion inbox. The old read endpoint/table
remain for rolling compatibility, but new browsers no longer write read receipts. Legacy resolution
fields and tools remain compatible. Authors can hide resolved roots in the browser; a new reply
reopens the root in the same transaction as its comment write.

Migration 037 stores short-lived per-draft viewer presence. Visible review pages heartbeat every
five seconds; rows expire from display after twenty seconds and maintenance prunes them after a
minute. Each page instance is identified by a hash of an HTTP-only random browser cookie plus a
per-instance nonce, so leaving one tab does not remove another. Signed-in identities come from
the session, never the submitted guest name, and are deduplicated in the viewer list. Every request
rechecks ownership or the current review capability/grant; listing and avatar access also exclude
viewers whose access was revoked. This is recent viewing of this draft, not account-wide online
status. A draft/comment activity stamp refreshes review data without replacing unsent composition.

Feedback reads return the original post/source from its immutable revision for local comparison.
Sharing the draft also shares existing author questions and their attached review context. Private
AI findings never become browser discussion comments. Migration 034 stores successful built-in AI
runs, including reviewed text and validated output, under their draft with owner-scoped reads and
cascading deletion. Delegated MCP reviews keep their existing result-only contract. AI's structured
local edits require a unique exact quote in the reviewed post; the browser checks the entire post
is unchanged before applying. Invalid provider anchors are rejected. No trusted agent identity is
inferred from an account name or comment body.

X source reads require the draft owner's current Pro entitlement before
cache access or API requests. This includes anonymous review pages; reviewers do
not need accounts or paid plans. Accounts without access have no quote/reply menu,
and direct creation is rejected. Downgrades preserve normal editing and feedback.

Draft content optionally includes a `source` relationship (`quote` or `reply`) and validated canonical X post URL, stored in existing draft JSON and immutable revisions. Creation requires a successful source lookup. After resolving the owner or active review capability, page loads may call server-only `x-post.ts` with that public URL. The only API destination is `api.x.com`; no arbitrary URL is fetched. One post lookup expands only its author and media, with a five-second timeout, no redirects/retries, validated provider data and no private draft text, tokens or URLs in requests/logs. Native source cards render escaped text, linked attribution, media, timestamp, X mark and View on X. Sensitive/edited/quoted/reposted sources and polls are unavailable rather than displaying incomplete required context.

Migration 011 adds a shared 15-minute source cache (five-minute failure backoff) and conservative UTC-month request reservations. A per-post advisory transaction lock serializes cache claims. A reservation of five cents and an empty five-minute miss marker commit before HTTP, so concurrent requests or a process failure cannot cause unreserved paid retries. Concurrent visitors may temporarily see the unavailable status while a miss is in flight. No database lock is held during HTTP. Never display expired cached content if refresh fails; maintenance deletes it. The default per-instance monthly reservation limit is US$5, independent of X's billing balance and any other instance. See README for configuration and pricing assumptions. API content is not part of draft/revision snapshots, metadata images or offline storage; autosave does not fetch it.

No X embeds or widget scripts are loaded. CSP disallows frames, permits source images only from `pbs.twimg.com` and video from `video.twimg.com`, and keeps third-party scripts out of LastPeek. Unavailable previews show “Quotes and replies aren’t available right now.” Normal drafts, editing existing drafts and human feedback do not depend on X responding. Draft lists show only the relationship, without loading source content. The external post itself is live, not part of the immutable snapshot.

The author edits `drafts.content`. Each save compares `edit_version`; stale writes fail with 409 and leave the browser's text intact. Sharing locks the draft and creates a persistent token. While that token is active, saves create immutable internal snapshots and atomically advance `shared_revision`; unchanged content does not create duplicates. There is no manual reshare or user-facing revision history. Comments reference the original `(draft_id, revision)`, an optional stable post UUID, and an optional quote validated against that post. Updating or removing a post never reassigns old feedback. A reviewer composing feedback keeps the snapshot they saw even if the author saves meanwhile. Existing suggested text remains usable through an explicit author action.

A 256-bit random review token is an unlisted bearer capability, not named-recipient authentication. Revocation removes it; a newly shared link gets a fresh token. Reviewer responses contain the current shared snapshot and its media metadata, never unshared edits. Old snapshots remain internal for feedback provenance; legacy version query parameters no longer select them. Original media access checks either owner session or a current review token and membership in a published snapshot. Files use opaque UUID names, no path input, no public static route, `nosniff`, no-store and no-referrer. MP4/WebM are served with byte ranges for seeking. Playback still depends on browser codec support; downloads preserve original bytes.

Migration 014 links new signed-in comments to their authenticated user ID. Feedback reads join the current profile name and avatar, while retaining the supplied name as a fallback; no name-based backfill attempts to identify guest or legacy comments. Revision, post and quoted-text anchors remain unchanged. A feedback author's current avatar is readable by the draft owner or through that draft's active review capability, not by unrelated accounts or anonymous requests without a capability. Replacing a profile photo removes this feedback-based access to the old photo, and revoking the review link removes capability access to reviewer photos too. The review header exposes only the signed-in viewer's name and avatar, not their private account fields.

Migration 019 adds one unordered friendship per account pair, with an explicit requester, recipient and acceptance timestamp. Exact-email requests and contextual profile requests are authenticated, origin-checked and rate-limited; contextual requests must identify the author or an account-linked commenter on an accessible draft. Only the recipient can accept. Connected accounts can read each other's current profile photo, including while a request is pending. Notification recipients can read their actors' current photos while the notification exists; this alone does not grant activity access.

`UserIdentity.svelte` renders live account identities across friends, feedback, notifications, sharing, navigation, consent and admin. Post previews retain their separate snapshot identity. A per-layout registry batches mounted accepted-friend IDs into authenticated, same-origin `/api/presence` requests once a minute while the document is visible, including an empty heartbeat on other signed-in pages. Existing request activity writes remain throttled to once a minute. The endpoint independently requires accepted friendship for every returned account; pending requests, draft ownership, feedback, notifications and review capabilities never grant activity access. It accepts no review-token authority, rounds timestamps down to the minute and rechecks friendship on every refresh. The component also hides cached activity immediately when refreshed relationship data no longer shows acceptance. “Active now” means activity within five minutes, not a guaranteed live connection. Compact feedback/notification identities show only its accessible green dot; detailed friend identities also show elapsed minutes, hours or days. Unknown activity is distinguished from unavailable/unauthorized activity, and failed refreshes clear stale indicators. Activity is not stored in immutable content or browser persistence. Owner-session security details and privileged administrative activity remain separate from peer presence.

Friend-only reviews use a separate `friend_token`, mutually exclusive with `share_token`, plus per-draft recipient grants tied to the accepted friendship. The old application image cannot resolve these tokens as bearer links. The review resolver checks the current session against the owner or selected recipient before loading content; media and avatars use that same resolver. Preview images deliberately use the unauthenticated resolver, so private reviews never generate crawler cards. Comment writes recheck the token and lock recipient grants/friendship against concurrent revocation. Draft saves continue advancing immutable shared snapshots in either mode. Deleting a friendship cascades its review grants in both directions, and re-friending creates no grants. Public-link creation clears all private grants and rotates away from the private token. Shared-draft notifications resolve the current recipient grant, not a stored bearer capability. No SMTP, websocket service or true online-presence claim is introduced.

Review queues derive completion from an account-linked comment on `drafts.shared_revision`, regardless of resolution. “Looks good!” is an ordinary comment anchored to the revision displayed when submitted; neither it nor a late written response can silently approve a newer snapshot. No completion write is needed: unchanged saves preserve the queue and new shared snapshots reopen it. The unused `friend_reviews.completed_at` column from migration 022 remains for rolling compatibility with the preceding image, not as an approval source of truth.

## Mention lookups

Owner-only, same-origin mention searches and exact-handle checks, including cache reads, require current Pro access, not a feature grant. `x-mentions.ts` sends only a handle fragment to `api.x.com`, not draft text. Search starts at three characters after 650 ms idle, returns at most five accounts and reserves US$0.05; an exact check reserves US$0.01. Both use the normal X allowance, payer ledger and global monthly cap. Migration 026 caches results per author for 15 minutes, confirmed missing handles for five minutes and failures/in-flight claims for one minute. Claims and reservations commit before HTTP; an advisory lock deduplicates concurrent identical requests without holding locks during HTTP. Search results prime exact-handle checks. Thirty uncached attempts per author per 15 minutes bound activity further. Maintenance removes expired entries. Unknown costs retain reservations. No automatic lookups on page load, retries or background account refresh. OAuth token rotation is shared with publishing and commits separately from usage claims. Validation is transient editor state, never part of draft/revision JSON, and only matching explicit provider not-found responses mark handles invalid; search misses, permission failures and generic 404s do not. Posting remains independent.

## Manually posted X links

Migration 024 stores manual-post X-link reconciliation separately from native publication state. Marking as posted commits a one-way timestamp and one search claim, bound to the expected edit version, before external HTTP. `posted-x.ts` reads at most 20 posts from the connected immutable X account ID within the previous seven days, with a five-second timeout, no pagination/retries, no redirects and no draft text in the request. Current Pro access, the per-account allowance and a conservative ten-cent global reservation precede the read. The existing X cost ledger snapshots tariffs and deduplicates returned resources across single-post and timeline reads; unknown billing retains its reservation. Reloads, duplicate marks and rejected candidates never search again. Matching verifies author, time and reply/quote target before locally comparing normalized text/expanded URLs. Only unique exact text-only single-post matches of at least 40 characters link automatically. Other plausible matches require owner confirmation. Manual URL entry validates/canonicalizes an X status URL without fetching an arbitrary destination or requiring external access. Only an owner can confirm, reject or paste a link. Provider failures never undo the posted marker. A manual choice cannot be overwritten by a late lookup. Native confirmed publication links take precedence. Public provider text is not stored, and review snapshots are unchanged.

## Notifications and PWA push

Migration 020 stores typed inbox events, per-user event preferences, per-device/session Web Push subscriptions and a durable per-device delivery outbox. Domain operations insert events and deliveries in the same transaction; repeated friendship requests and existing sharing grants do not create duplicates. No self-notifications. Preference defaults are enabled for all four event types; a disabled type suppresses new inbox events and push deliveries, and delivery rechecks preferences for pending messages. Owners can delete individual notifications or clear their entire history; cascading deletes cancel queued push deliveries without changing the underlying friend requests, drafts or feedback.

`notifications.ts` owns delivery. The existing SvelteKit process drains up to 20 deliveries every ten seconds, with row locks and SKIP LOCKED for multiple instances. Network calls have a five-second timeout. Delivery is at-least-once: retries use the same notification tag, with exponential backoff, at most six attempts, a one-day age ceiling and one-hour transport TTL. Expired endpoints (404/410) are removed; revoked/expired sessions and read events are skipped. Maintenance prunes invalid subscriptions and 90-day-old history. Non-retryable provider errors drop the delivery; inbox history remains available. Browser push availability is not guaranteed.

VAPID keys are generated once and persisted in PostgreSQL, never sent to clients except for the public key. Include `push_keys` in database backups; changing the key requires devices to resubscribe. Subscription writes are same-origin, authenticated, bounded and limited to known browser push hosts (Google, Mozilla, Apple and Windows); arbitrary endpoints cannot trigger server-side requests. Push messages contain generic text and an opaque inbox-event ID, never identity, draft text, feedback or review tokens. Notification clicks navigate only to a same-origin resolver that rechecks the owner and current private grant. Subscriptions are bound to the current Better Auth or legacy session, so logout/password reset/session expiration prevents future delivery. Previously delivered device notifications cannot be recalled.

Settings requests permission only from a user gesture and supports enabling/disabling the current device. Other enabled subscriptions appear only for the owner's valid sessions, with coarse browser/platform labels derived from existing sign-in metadata and subscription creation dates; legacy sessions without metadata say Browser. These are subscriptions, not online or guaranteed-delivery claims. Endpoints, keys and session identifiers are never returned with the list. On iOS/iPadOS, push requires a supported Home Screen installation; desktop/browser support is detected. The service worker handles push and clicks without caching authenticated content or replaying writes. The in-app inbox works when push is unsupported or refused. Browser-vendor transport delivery and real iOS OS notifications require device-level smoke tests; automated Chromium checks inject an actual service-worker push event, not a live vendor delivery.

## Security and bounded operation

Optional AI review uses the server-only OpenAI Responses client. Authors explicitly send a bounded snapshot of post text; no media, review capabilities or identity is sent. Successful built-in results persist privately with their reviewed text in `ai_reviews`, separate from revision-bound human feedback. Reads recheck draft ownership; draft deletion cascades history. No model output automatically mutates drafts. Owner/origin checks, a current Pro entitlement and database-backed monetary allowances plus per-author and instance rate limits protect the endpoint. Missing credentials disable new reviews without hiding saved results or affecting core workflows; see README for configuration and provider-retention caveats. PostgreSQL owns plan assignments, protected current-period entitlements, future experimental feature grants and transactional audit history; the optional restricted SSH operator gateway adds no required application service. Plan and invitation writes require same-origin owner authentication in site admin. See [operations](operations.md).

Better Auth handles password sign-in and its server-side sessions inside the existing SvelteKit server, using PostgreSQL directly. Passwords retain the existing salted scrypt format through its custom hash/verify configuration; account IDs and ownership never change. LastPeek's transactional invitation flow, seed, account password form and local recovery CLI own credential writes. An additive migration backfills credential accounts and a database trigger synchronizes these writes, including writes from the preceding image during rollout. Password changes atomically invalidate both Better Auth and hashed sessions. No general-purpose Better Auth HTTP handler is mounted: only the existing rate-limited, CSRF-protected form actions invoke its server API, and public sign-up is disabled in the library too. Email delivery is not enabled.

Password sessions use Better Auth's signed HTTP-only SameSite cookies and 30-day PostgreSQL sessions, without a client-side session cache. Unlike hashed session tokens, Better Auth stores session tokens in its database; the separate cookie-signing key is required to use them. The key comes from optional `BETTER_AUTH_SECRET` or an automatically generated owner-readable `.auth-secret` in the private media directory. Persist and back up that file with media; never expose it through media routes. Existing SHA-256-hashed sessions remain valid until expiry or revocation; X OAuth and explicitly enabled development sign-in also issue these 30-day HTTP-only SameSite sessions. Invite and review tokens remain separate hashed/capability mechanisms. Form CSRF checks plus explicit JSON/multipart Origin checks remain enabled. SQL parameters, server-side author checks, database-backed attempt limits and MIME sniffing are mandatory. SVG/HTML/executables are not uploads. Images are inspected with bounded pixel dimensions. Draft text is never put in error logs.

Migration 030 adds opaque legacy-session management IDs, nullable historical creation times, browser hints and per-session activity timestamps. `browser-sessions.ts` lists only the owner's unexpired password and legacy sessions, never bearer tokens, token hashes, raw user agents or IP addresses. Authenticated requests update activity at most once per minute. Session revocation is same-origin, owner-scoped and confirmed, with a native-form confirmation fallback. A user-row lock serializes concurrent management and the requesting session is rechecked before deletion; the current session cannot revoke itself here. Existing push delivery checks honor deletion without changing X or agent credentials. Older Password links continue opening the combined Security section.

Optional `x-auth.ts` owns the explicit X OAuth routes; no generic social-auth handler is exposed. POST start enforces Origin and a database-backed rate limit. Ten-minute state is hashed, single-use and bound to an HTTP-only browser cookie, origin, PKCE verifier, and (for linking) the signed-in account. Callback exchanges only with api.x.com and validates `/2/users/me`. An immutable X user ID, never email/handle, identifies the link. New identities require a valid invitation consumed transactionally; existing emails cannot silently merge. Identity claims serialize before unique constraints. Access/refresh tokens are AES-256-GCM encrypted using a SHA-256-derived auth key, with expiry/scopes retained; tokens refresh only during posting or a user-triggered mention lookup, never in the background. X-only accounts retain an inaccessible random password hash for old-image compatibility, with `has_password=false`; first password setup and recovery enable local sign-in and revoke sessions. Existing-account linking opens a native modal with independent profile-import choices and a restricted X photo preview. Applying or dismissing persists `import_pending=false`, including close/Escape, and the server rejects later imports until another explicit connection flow. Import failures stay in the dialog without consuming those choices. Connections shows status and disconnect, offering reconnect only for expired access without refresh credentials. Photos are bounded, redirect-free downloads only from HTTPS pbs.twimg.com/profile_images/, processed through the private avatar pipeline; failure does not undo a successful link or sign-up. Disconnect deletes local tokens and requires a local password. X connection is optional and separate from source-post feature access/budget.

Development sign-in assigns Pro and enables registered experiments for the seeded dev account through normal audited operations. It does not bypass quotas, enable provider credentials, or change normal accounts; never enable development sign-in in production.

Account and inbox form pages (`/login`, `/join/[token]`, `/settings` and `/notifications`) and draft editors (which can submit the explicit X authorisation form) use `Referrer-Policy: strict-origin`: browsers can identify same-origin native form submissions for CSRF validation without sending URL paths, invitation tokens or query strings as referrers. This supports submission before hydration and with JavaScript disabled. A matching reactive referrer meta tag updates the document policy during client-side navigation; response headers on navigation data alone cannot change it. Both use the same route policy. All other routes, including review pages and private media, retain `no-referrer`. Cross-site and opaque (`Origin: null`) submissions remain rejected; the policy exception does not relax origin validation.

`x-publishing.ts` publishes standard-length posts, threads, media, replies and native quotes for Pro authors without a feature grant. An owner-only, same-origin POST binds the expected edit version and immutable X account ID. The explicit OAuth upgrade requests `tweet.write media.write`, is bound to the owned draft and returns there without posting. Refresh token rotation serializes on the account/user rows and commits separately from publication claims, so later quota failures cannot restore consumed credentials; uncertain refresh failures require reconnecting. Publishing reserves the existing per-account X allowance and global monthly safety budget before each provider call: US$0.015 for plain text, US$0.20 for URL/media/quote posts and a conservative US$0.05 per upload/processing API call. These safety bounds are separate from snapshotted tariffs: completed media objects cost US$0.015 each, while post creation costs US$0.015 or US$0.20 with a URL. Abandoned media and uncertain writes remain unsettled, not priced as reservations. Global cents round up conservatively. `x-usage.ts` owns payer-wide daily resource deduplication and periodic read-only credit-balance cross-checks; it never posts, retries publications or distributes unexplained balance deltas to users. See operations for billing limitations.

Migration 018 stores publication identity/state separately from immutable review revisions. Additive migration 021 adds the content snapshot, per-post IDs, upload progress and a two-minute operation lease. Each explicitly confirmed browser-driven POST advances one bounded operation: private preparation, chunked initialize/append/finalize, delayed processing check or post creation. The browser continues the confirmed operation while mounted; loading a page never starts publishing. A draft-row lock serializes durable claims, which commit before external writes. No database lock spans provider HTTP. Confirmed posts never repeat; each thread item replies to the previous returned ID. The opening item uses the saved reply/quote source. Partially posted drafts cannot switch versions or accounts. A durable sending marker makes interrupted or uncertain post creation non-retryable; only definite 4xx rejection (not timeout) permits another explicit attempt. Media failures are resumable and never fall back to text-only publishing. Expired remote media IDs are re-uploaded only for unfinished posts. Prepared bytes remain private under `.x-publishing`, expire through maintenance after 24 hours and are removed when processing completes. Provider bodies and draft text never enter logs or the usage ledger. Deleting the draft removes its local publication record, not its X post. No reconciliation worker or automatic posting runs.

Active review pages server-render Open Graph and Twitter card metadata for the current shared opening post. `/r/[token]/preview.png` generates a 1200×630 PNG locally with Sharp, using the same capability lookup and shared snapshot as the review page, including its author identity and first attachment. GIFs use their first frame; MP4/WebM videos use a single frame extracted locally with FFmpeg, restricted to local file/pipe protocols, a five-second timeout and bounded output. Missing or undecodable media falls back to text. Original uploads are unchanged. No external image service or public static upload is used. The container includes local fonts and Fontconfig bitmap-scaling rules for text, correctly sized color emoji and CJK rendering. Image URLs include the current revision as a cache-busting hint, but always resolve to the latest shared snapshot; query parameters cannot select older revisions. Robots may fetch `/r/` for link previews; the rest of the site remains disallowed. Both page and image remain no-store and noindex and return 404 after revocation, even for a signed-in owner. Messaging services can nevertheless cache fetched text/images outside LastPeek's control; edits and revocation cannot recall those copies.

`usage-reconciliation.ts` overlays audited owner/operator decisions on the immutable provider ledger. Confirmed prices need evidence; non-billable exceptions retain unknown provider costs while excluding them from the billable estimate. Safety reservations and publication outcomes do not change. Fresh payer-balance checkpoints explicitly accept historical discrepancies without allocating wallet differences to users or erasing history. Owner browser writes and confirmed, bounded operator commands share the same transactional validation. See operations for gateway rollout and permissions.

Plan defaults are 10 drafts / 250 MB for Free and 100 drafts / 2,048 MB for Pro, with 50 MB uploads and up to 25 posts per draft. Each post permits four images or one video/GIF. Pro starts with US$0.50 AI / US$1.50 X per account period. `plans.ts` serializes entitlement renewal and quota claims on the user row. API ledger entries retain their original period and reserve before provider requests; known estimates replace reservations for per-account accounting, unknown charges remain reserved. Pro catalog reductions wait until the next anchored calendar-month boundary, while increases update current protected limits. Plan toggles never reset usage or dates. Draft-count and storage checks apply only to creation/addition; existing content remains editable over quota. `MAX_UPLOAD_MB` and adapter body limits remain transport safety ceilings, not plan storage controls. Large videos are not silently transcoded. Store media on SSD for Pi use.

Profile avatars accept JPEG, PNG, WebP or AVIF up to 5 MB and 16 megapixels. The server strips metadata, applies orientation, crops to 256×256 and encodes WebP. Private files live under the media volume's `avatars` directory, count toward storage quotas, and require the owner session or a current review capability referencing that avatar in a shared revision. Working drafts capture the current profile on save; shared snapshots retain their original avatar. Maintenance removes avatars unreferenced by profiles, drafts or revisions after 24 hours, as well as stale orphan files.

Current profile handles are derived directly from `x_accounts.profile.username` by session, friend and working-draft reads/writes, including MCP. No connection means an empty handle. Profile forms accept only name/photo changes and X import offers only name/photo choices. The legacy `users.handle` column remains for rolling compatibility, but is not a current identity source. Immutable review snapshots retain their captured handles; connecting or disconnecting X never rewrites them.

`npm run maintenance` expires sessions/rate buckets, removes uploads unattached for 24 hours, and removes stale orphan files. Shared revisions retain their media until draft deletion. Run maintenance hourly in deployment. No automatic draft expiry in this MVP. Administrators recover accounts with the documented local CLI, not email. Backups consist of a database dump and the matching private media directory, taken while writes are stopped. Restore must be rehearsed before a real beta.

## User-delegated MCP

The `agents` experiment defaults off. Account grants gate Settings and consent, code/refresh
exchanges and every authenticated MCP request/tool call. Revoking trial access blocks existing
tokens on their next request; discovery and client registration alone never grant user authority.

`/mcp` is a stateless Streamable HTTP endpoint using the official MCP SDK, JSON responses and
per-request bearer authentication. Browser sessions do not authorize MCP, and cross-origin browser
requests are rejected. Discovery lives at `/.well-known/oauth-protected-resource` and
`/.well-known/oauth-authorization-server`. `/oauth/register` supports rate-limited public-client
dynamic registration, exact registered HTTPS (or HTTP loopback) callbacks, and no metadata URL
fetching. `/oauth/authorize` requires same-origin authenticated consent; authorization codes are
five-minute, hashed, single-use, and bound to client, callback, resource and PKCE S256 challenge.
`/oauth/token` exchanges codes and rotates 30-day refresh tokens transactionally, issuing one-hour
access tokens. All token material is hashed at rest. Consent offers 30 days, 90 days (default),
365 days or no connection deadline. Migration 029 permits a null connection expiry; every token
exchange and resource request still enforces any finite deadline and revocation. Active connection
expiry can be changed in Settings without changing scopes or resurrecting an expired grant.
Permission-only saves preserve the existing deadline. Refresh credentials expire after 30 days
without renewal, including for indefinite connections; active clients renew them silently.
No external authorization service is required.

SvelteKit’s built-in form CSRF guard cannot exempt an OAuth token endpoint. The request hook
therefore enforces the same mutating-form Origin check before loading sessions, exempting only
`/oauth/token`, which never authorizes with cookies. All missing, opaque and cross-site form
Origins remain rejected elsewhere; JSON/multipart operations retain their operation-level checks.

Migration 028 stores clients, connections, codes and tokens. Each request intersects token scopes
with the connection’s currently enabled permissions and checks revocation, expiry and the exact
MCP resource. Tool calls repeat this check; disabling a permission changes both tool discovery and
execution on the next request. A refresh preserves the original delegated ceiling unless the
client explicitly narrows it, while reporting currently effective permissions. The owner can
re-enable only permissions approved at consent. New authority requires a new consent flow.
Revocation blocks subsequent requests, not operations already authorized and in flight.

Migration 032 adds pending scope requests and code-bound scope snapshots. Settings can request
additional access, but only previously approved scopes become effective immediately. MCP responds
with the standard 403 insufficient_scope challenge to initiate client-side reauthorization. Consent
can update a pending connection only for the signed-in owner and exact registered client, never by
display name; multiple candidates require explicit selection. The chosen grant is bounded by both
the client request and the pending selection. Cancellation clears the request without disconnecting.
New tokens reflect the approved scope snapshot; old access/refresh credentials retain their ceiling.
Accepting added access invalidates earlier unexchanged codes for that connection, so even the
previous rolling-deployment image cannot exchange them using the expanded connection scopes.
Attachment scopes remain internal dependencies of draft/review consent so legacy credentials do not
silently gain media access. Discovery exposes ten user-facing capabilities in four groups; removed
friend/notification scope strings remain parseable for legacy refreshes but have no agent tools.

Sharing separates `sharing:links` and `sharing:people`, including audience-specific revocation and
filtered URL/recipient reads. The legacy `drafts:share` grant already authorized both; normalize it
to that equivalent pair before intersecting token, code and enabled connection scopes. This mapping
never adds media dependencies. Permission edits lock the connection and normalize its approved
ceiling before reducing enabled access; no reconnect is needed to narrow an older sharing grant.

`agent-tools.ts` adapts typed inputs to existing draft operations. `feedback.ts` is shared by browser
and agent feedback, preserving identity, snapshot anchors, access-revocation locks and notifications.
No MCP tool publishes externally, deletes drafts, exposes admin operations or fetches arbitrary
URLs. Explicit X lookup and AI review permissions reuse existing server-only provider operations,
eligibility and monetary allowances; paid X reads are unchecked at consent. Draft/comment content
is untrusted data, not tool instructions. Neither
credentials nor content are logged. `last_used_at` records authenticated requests, including MCP
initialization; client names are unverified registration metadata, not identities inferred from
user-agent headers. Maintenance prunes expired credentials and old disconnected connections.

Migration 031 adds server-derived feedback provenance, bounded request replay records, private
media-transfer grants and metadata-only successful operation history. Create, feedback, inline
upload and AI requests accept an optional request ID. Identical successful inputs replay the
stored result; mismatches and unfinished/uncertain claims fail rather than repeating a write.
Replay records expire after 30 days and draft-associated results are removed with the draft.
Activity retains only connection, operation and time for 30 days, never content or credentials.
MCP results include structured content while preserving the original JSON text block. Errors
carry stable codes/status and retry guidance; SDK input validation may reject before execution.

`upload_media` accepts bounded inline base64 (700,000 characters) or returns a ten-minute
draft-bound raw-binary transfer. `/api/agent-media` requires its own hashed-at-rest bearer grant,
not a cookie or URL credential. Upload bytes must match the authorized SHA-256, pass `storeMedia`
validation/quotas and return a media ID to attach through a versioned save. Reusing the same
grant/bytes returns the same upload; uncertain claims cannot silently duplicate it. Downloads
support byte ranges and bounded MCP image previews. Review grants expose only media in the
current shared snapshot; each byte request rechecks connection permission, feature access,
expiry and current review/recipient access. Maintenance removes expired transfers. Neither
transfer capability authorizes arbitrary paths, remote URL ingestion, editing or sharing.

Disconnected connections remain server-side for credential revocation but are omitted from the
management list. Additional permissions can be selected in the editor; existing OAuth credentials
cannot silently gain authority. New permissions require approval from the client flow.
Portal ingress authentication may prevent external clients from reaching a private preview URL.
Automated official-SDK HTTP checks do not establish an external client’s complete OAuth UX.

## Development and delivery

`compose.yaml` runs the complete stack; local development can use an existing PostgreSQL instance and Vite. Environment is documented in `.env.example`; credentials and data are never committed. `scripts/migrate.ts` applies ordered SQL migrations under a database lock. Seed is idempotent and never resets existing credentials. Contract tests cover public data rules; browser/HTTP tests exercise the running stack with temporary accounts and data. The original Safari prototype is preserved in Git history only; extension development is deferred.

GitHub-hosted Actions checks pull requests without publishing permissions. Checked `main` commits publish ARM64/AMD64 GHCR images tagged with the full commit SHA and `latest`, with a fixed official origin. The Pi uses isolated PostgreSQL/media volumes, a dedicated Cloudflare Tunnel and a LastPeek-only user-systemd update timer; no public SSH or self-hosted CI runner is required. The updater and backups share a lock, and the existing apps' Watchtower service ignores LastPeek. Web startup applies migrations before serving. Migrations must remain backward compatible with the preceding image. See [deployment](deployment.md) for backup, rollback and operational limits.
