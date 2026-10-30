# LastPeek: a second pair of eyes before you post

LastPeek is a focused website for preparing social posts and getting feedback from a friend. The website is complete without an extension. No scheduling, publishing, AI, analytics, social login or connected X account is required.

## MVP contract

- Invite-only authors. Local passwords, server-side sessions and manual invite links; no email delivery dependency. Admins create/revoke invitations. Reviewers never have to sign up.
- Authors write a single post or ordered thread, without titles. Each post has text and up to four images (including animated GIFs), or one video. Handle/name are set once in account settings, not verified X identity. Working drafts use the current profile; shared revisions retain the identity captured when shared.
- Images and videos are private files, not public static uploads. Upload limits, per-author storage quotas, file inspection, progress, retry and honest unsupported-file errors are core features.
- Autosave uses optimistic concurrency checks. Sharing creates a persistent review link; subsequent saves update that link automatically. Immutable snapshots remain internal to anchor feedback to the text reviewed. Never silently overwrite concurrent edits.
- Share links are random bearer capabilities. Anyone possessing one can read and comment; this is unlisted access, not recipient authentication. Authors can revoke and later create a different link. Do not include draft content in link metadata, logs or analytics.
- Feedback can be general, focused on a post, or quote selected text. It retains its original internal snapshot and stable post ID, with an “Earlier feedback” indicator after edits. Reviewers enter a name only when sending, or use their signed-in identity. Existing suggestions remain readable and usable, but new feedback has a single text input. Only the author can resolve feedback. No real-time co-editing or user-facing version history.
- Authors copy individual posts and download attachments for manual posting in X, using labelled icons along the bottom of each post. A compact plus adds the next post to a thread. There is no whole-thread copy or manual save button. Save failures are inline; leaving with unsaved edits or uploads requires confirmation.
- Mobile reviewers get the same readable post preview with feedback below the thread. Desktop feedback sits beside a fixed-width preview. Authors edit directly in that layout, without a separate preview mode; reviewer views hide editing controls. No invented publication dates, verification or engagement counts.
- The composer and preview follow X's dark interface: typography, spacing, thread connectors, link treatment, weighted counts and media layouts. Keep LastPeek's identity in the surrounding interface. Rendering can differ across devices; document limitations rather than adding blanket disclaimers to the preview. Link cards, polls, quote posts, Premium formatting and automatic video transcoding are outside this MVP.
- The entire application, accounts, database, media and maintenance run on one host. No required third-party application service. Portable container deployment; the official invite-only service runs on a Raspberry Pi, with optional Cloudflare Tunnel ingress.

## Next, not now

Prove the web flow first. Later, an optional browser extension imports X composers and explicitly offers two-way updates. Conflicting website/X edits need comparison and confirmation. Historical capture code lives in the initial prototype Git commit, not an unmaintained second application in the active tree.

The project is AGPLv3 open source with a separately operated hosted service. Hosted deployment and automatic updates are authorized; open public registration, billing and domain purchases are not part of this phase. Before broadening the invite-only trial, confirm encrypted off-device backups, alerts, abuse controls and retention choices. See the deployment runbook for the operational boundaries.
