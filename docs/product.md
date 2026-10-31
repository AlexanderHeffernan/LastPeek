# LastPeek: a second pair of eyes before you post

LastPeek is a focused website for preparing social posts and getting feedback from a friend. The website is complete without an extension. No scheduling, publishing, AI, analytics, social login or connected X account is required.

## MVP contract

- Invite-only authors. Local passwords, server-side sessions and email-bound invitation links; no email delivery dependency. The owner creates/revokes invitations in site admin Invitations and chooses Free or Pro. Reviewers never have to sign up. Invitation links permit registration for the specified email, not mailbox verification.
- Authors write a single post or ordered thread, without titles. Each post has text and up to four images (including animated GIFs), or one video. Handle/name are editable in account settings; optional X sign-up imports the profile, and existing authors can link X and choose individual fields to import. Imported fields remain editable, not a verified-identity badge. Working drafts use the current profile; shared revisions retain the identity captured when shared.
- Images and videos are private files, not public static uploads. Upload limits, per-author storage quotas, file inspection, progress, retry and honest unsupported-file errors are core features.
- Autosave uses optimistic concurrency checks. Sharing creates a persistent review link; subsequent saves update that link automatically. Immutable snapshots remain internal to anchor feedback to the text reviewed. Never silently overwrite concurrent edits.
- Share links are random bearer capabilities. Anyone possessing one can read and comment; this is unlisted access, not recipient authentication. Authors can revoke and later create a different link. Active review links automatically expose the shared opening post and author identity in link-preview metadata and a generated image, including the first attached image. Messaging platforms may fetch and retain these previews after edits or revocation. Never include unshared content, feedback, or draft content in logs or analytics.
- Feedback can be general, focused on a post, or quote selected text. It retains its original internal snapshot and stable post ID, with an “Earlier feedback” indicator after edits. Reviewers enter a name only when sending, or use their signed-in identity. Existing suggestions remain readable and usable, but new feedback has a single text input. Only the author can resolve feedback. No real-time co-editing or user-facing version history.
- Authors copy individual posts and download attachments for manual posting in X, using labelled icons along the bottom of each post. A compact plus adds the next post to a thread. There is no whole-thread copy or manual save button. Save failures are inline; leaving with unsaved edits or uploads requires confirmation.
- Mobile reviewers get the same readable post preview with feedback below the thread. Desktop feedback sits beside a fixed-width preview. Authors edit directly in that layout, without a separate preview mode; reviewer views hide editing controls. No invented publication dates, verification or engagement counts.
- The composer and preview follow X's dark interface: typography, spacing, thread connectors, link treatment, weighted counts and media layouts. Keep LastPeek's identity in the surrounding interface. Rendering can differ across devices; document limitations rather than adding blanket disclaimers to the preview. Link cards, polls, Premium formatting and automatic video transcoding are outside this MVP.
- The entire application, accounts, database, media and maintenance run on one host. No required third-party application service. Portable container deployment; the official invite-only service runs on a Raspberry Pi, with optional Cloudflare Tunnel ingress.

## Replies and quote posts

New Quote and New Reply are available to Pro accounts. Shared reviews use the author's access, not the
reviewer's. Downgrading removes source previews without losing draft edits
or human feedback.

The New post split button creates a normal draft or offers New Quote and New Reply. These accept an HTTPS X or legacy Twitter post link and retain its canonical URL and relationship with the draft and shared revisions. Replies show the original above the draft; quotes show it beneath the opening post's text/media. An optional server-side X API token enables native source cards with author, text, media, timestamp and View on X. Brief caching and a persistent request budget bound paid lookups. Creation requires a successful source lookup; missing configuration, unavailable/unsupported content and exhausted budgets show “Quotes and replies aren’t available right now.” Existing drafts remain editable without a source preview. There is no embed fallback. Normal drafting and human feedback require neither paid APIs nor an X account connection. External source content is not an archived snapshot, and LastPeek does not publish replies or quotes to X. Link cards, polls, Premium formatting and automatic video transcoding remain outside scope.

## Free and Pro trial

Free is usable indefinitely: 10 saved drafts, 250 MB of media and the complete human-review workflow. A draft may contain up to 25 posts and counts once. Pro starts with 100 drafts, 2,048 MB, US$0.50 of AI and US$1.50 of X API usage per monthly period. Both plans allow uploads up to 50 MB. X profile connection/sign-in is independent of Pro. All accounts existing at migration 014 become Pro; future accounts default Free unless their email invitation specifies Pro.

The owner controls plans and allowances in site admin. Free changes apply immediately. Pro increases apply immediately; reductions wait until each account's next monthly period. Periods are anchored to account creation (migration time for existing users), use UTC calendar-month boundaries, and do not reset when plans change. Usage does not roll over. Scheduling Free at period end preserves Pro until then; immediate downgrades are also available. No billing or automatic charges exist yet.

Over-quota accounts keep editing, sharing, human feedback, copying, downloading and deletion. Creation and storage additions are blocked when they would exceed limits. Deleting a draft deletes its revisions, comments, review link and attachments; removing one attachment may leave revision-retained media until the draft is deleted. No automated excess-data deletion policy is implemented. A future notified retention policy needs its own terms and warning flow.

AI and X access are released plan capabilities, not feature flags. The feature-flag administration page remains for future experiments. API budgets reserve conservatively before requests; known costs reconcile against usage, while unknown costs keep their reservation. Global safety caps still apply. Site admin's financial model is hypothetical, separate from live allowances and not a provider invoice.

## Next, not now

Prove the web flow first. Later, an optional browser extension imports X composers and explicitly offers two-way updates. Conflicting website/X edits need comparison and confirmation. Historical capture code lives in the initial prototype Git commit, not an unmaintained second application in the active tree.

The project is AGPLv3 open source with a separately operated hosted service. Hosted deployment and automatic updates are authorized; open public registration, billing and domain purchases are not part of this phase. Before broadening the invite-only trial, confirm encrypted off-device backups, alerts, abuse controls and retention choices. See the deployment runbook for the operational boundaries.
