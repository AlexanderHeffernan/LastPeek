# LastPeek: a second pair of eyes before you post

LastPeek is a focused website for preparing social posts and getting feedback from a friend. The website is complete without an extension. No scheduling, publishing, AI, analytics, social login or connected X account is required.

## MVP contract

- Invite-only authors. Local passwords, server-side sessions and manual invite links; no email delivery dependency. Admins create/revoke invitations. Reviewers never have to sign up.
- Authors write a single post or ordered thread. Each post has text and up to four images (including animated GIFs), or one video. Handle/name are user-entered, not verified X identity.
- Images and videos are private files, not public static uploads. Upload limits, per-author storage quotas, file inspection, progress, retry and honest unsupported-file errors are core features.
- Autosave updates the author's working copy with optimistic concurrency checks. A deliberate Share / Update shared version action creates an immutable snapshot for reviewers. Never silently overwrite concurrent edits.
- Share links are random bearer capabilities. Anyone possessing one can read and comment; this is unlisted access, not recipient authentication. Authors can revoke and later create a different link. Do not include draft content in link metadata, logs or analytics.
- Comments and suggested replacement text attach to a revision and a stable post ID. Older-version feedback stays visible and labelled. Only the author can apply a suggestion or resolve feedback. No real-time co-editing.
- Authors copy individual posts or thread text and download attachments for manual posting in X. Clipboard text cannot attach media to X; make that distinction explicit.
- Mobile reviewers get the same readable post preview with feedback below the thread. Desktop feedback sits beside a fixed-width preview. Preview mode hides editing controls. No invented publication dates, verification or engagement counts.
- Preview styling approximates X, not a guarantee of identical wrapping, crops or codec support on every device. Link cards, polls, quote posts, Premium formatting and automatic video transcoding are outside this MVP.
- The entire application, accounts, database, media and maintenance run on one host. No required third-party application service. Portable container deployment; no Pi infrastructure changes in this phase.

## Next, not now

Prove the web flow first. Later, an optional browser extension imports X composers and explicitly offers two-way updates. Conflicting website/X edits need comparison and confirmation. Historical capture code lives in the initial prototype Git commit, not an unmaintained second application in the active tree.

Before a Pi private beta: confirm ARM64 images and hardware capacity, HTTPS and network reachability, encrypted off-device backups and restore, disk monitoring, abuse controls, recovery workflow and retention choices. No public beta, billing or domain purchase is authorized by the MVP build.
