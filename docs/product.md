# LastPeek: a second pair of eyes before you post

LastPeek is a focused website for preparing social posts and getting feedback from a friend. The website is complete without an extension. No scheduling, publishing, AI, analytics, social login or connected X account is required.

## MVP contract

- Invite-only authors. Local passwords, server-side sessions and email-bound invitation links; no email delivery dependency. The owner creates/revokes invitations in site admin Invitations and chooses Free or Pro. Bearer-link reviewers never have to sign up; friend-only reviews require an existing signed-in account. Invitation links permit registration for the specified email, not mailbox verification.
- Settings → Security combines signed-in browsers and password changes. Authors can sign out an individual other session or all other sessions after confirmation, retaining their current session. Both password and X/legacy sessions are covered; expired sessions are hidden. Browser/platform labels are user-agent hints, not verified hardware identities, and unknown activity stays unknown. Revocation also stops future session-bound push deliveries, but does not disconnect X or revoke independent agent connections.
- Authors write a single post or ordered thread, without titles. Each post has text and up to four images (including animated GIFs), or one video. Name and photo are editable in account settings; optional X sign-up imports the profile, and existing authors can link X and choose whether to import name and photo. The handle always comes from the connected X account; unconnected accounts show no handle. Working drafts use the current profile; shared revisions retain the identity captured when shared.
- Images and videos are private files, not public static uploads. Upload limits, per-author storage quotas, file inspection, progress, retry and honest unsupported-file errors are core features.
- Opening a normal composer does not save a draft or consume its allowance. The first edit (even one character or whitespace), thread change or media upload starts saving; a selected reply/quote source saves immediately. Back navigation flushes pending edits in a new composer before leaving. Autosave uses optimistic concurrency checks. Sharing creates a persistent review link; subsequent saves update that link automatically. Immutable snapshots remain internal to anchor feedback to the text reviewed. Never silently overwrite concurrent edits.
- Share links are random bearer capabilities. Anyone possessing one can read and comment; this is unlisted access, not recipient authentication. Authors can revoke and later create a different link. Active review links automatically expose the shared opening post and author identity in link-preview metadata and a generated image, including the first attached image or a video thumbnail. Messaging platforms may fetch and retain these previews after edits or revocation. Never include unshared content, feedback, or draft content in logs or analytics.
- Friends connect through exact account email addresses or signed-in identities encountered on a review or its feedback. Requests require explicit acceptance, can be declined/cancelled, and do not send email. Friends shows pending requests, accepted friends and coarse recent activity (not guaranteed online presence). Friend-only sharing grants access to selected accepted friends, not all friends; forwarding its address does not grant access. Switching to friends only revokes the bearer link. Creating a bearer link ends friend-only sharing. Removing access or the friendship immediately blocks private review reads, media and new feedback; existing feedback stays. Re-friending never restores prior grants. No public directory or mandatory external service.
- Notifications cover received friend requests, accepted requests, feedback and shared drafts. Each type is configurable in Settings and defaults on in the signed-in inbox. Push is separately opt-in per device and works through the installed PWA, including iOS/iPadOS Home Screen apps on supported OS versions. Permission is requested only by an explicit button. Delivery uses standard browser push transports, not an additional mandatory application service; the inbox works without push. Push contains generic event text, never draft/feedback content, names or review capabilities. Opening a notification rechecks account ownership and current draft access. Signing out or revoking a session stops future pushes for that session. Existing notifications expire after 90 days; changing preferences affects future events and queued push delivery, not existing inbox history.
- Discussion is shared by authors and reviewers: authors can ask questions before sharing, and either side can start a comment or reply. Replying to the latest message continues its tier; replying to an earlier message starts a branch. Deep branches open through View replies with Back navigation instead of accumulating indentation. Reply composition sits after the existing messages in its destination tier. Every reply retains its exact selected target independently of its visual grouping. Context can be a post, selected text, an image or a video playhead timestamp. Each comment retains its original snapshot, post and attachment identity; edited or removed context gets a specific label and a comparison dialog, rather than a blanket earlier-feedback badge. Guests give a name only when sending. Authors can resolve/reopen conversations; resolved conversations are hidden by default, not deleted. A new reply reopens them. No real-time co-editing or full version-history interface.
- Discussion lives on each draft, not in a separate navigation destination. Recent feedback and notifications open the relevant draft and comment directly. Old `/feedback` bookmarks return to Drafts. Draft discussion counts include only unresolved conversations and their replies.
- People can acknowledge feedback with thumbs-up, heart or celebration reactions, toggling their own reaction off again. Guest reactions belong to their browser session, not their entered name. Reactions update for other viewers without generating notifications. Interacting with a message marks only that account's notifications for the message read; unrelated events stay unread.
- Built-in AI offers one-click Quick review, Proofread (including spelling), Clarity, Tighten, Tone and Thread flow. Successful results and reviewed text are saved privately with the draft, newest first, and never shared into Discussion. Owners can delete a saved review through its action menu without changing the draft or discussion. Exact unique local text edits can be applied explicitly only to unchanged reviewed text; dismissing hides a finding in the current page, not its stored history. There is no built-in chat. MCP remains the route for interactive agents and uses the connected human account identity, not invented agent provenance.
- Authors copy individual posts and open attachments in a large viewer with downloads for manual posting in X. A compact plus adds the next post to a thread. There is no whole-thread copy or manual save button. Save failures are inline; leaving with unsaved edits or uploads requires confirmation.
- The home page is a work queue: Drafts holds the author's unfinished posts, To review holds friend-only assignments without that recipient's feedback on the current shared revision, and Done preserves posted drafts and up-to-date reviews. Authors explicitly mark manual posts as posted; confirmed in-app publishing does this automatically. Copying never implies posting. Sending feedback, including the Send feedback split button's “Looks good!” message, clears that recipient's review. A new shared revision automatically brings it back; unchanged saves and resolving feedback do not. Feedback submitted against an older snapshot stays earlier feedback and does not clear the current review. There is no separate approval/completion marker or finish/reopen action. Completion never deletes content or feedback, revokes access, or frees saved-draft/storage allowances. Public review links are not inferred assignments.
- Mark as posted is one-way. For Pro authors with a connected X account and available API allowance, this explicit action tries one bounded recent-post lookup. Unique exact text-only matches link automatically; similar wording, repeated matches, media and threads require confirmation. The lookup compares locally and does not send draft text to X. Missing/rejected matches and unavailable lookups allow a pasted canonical X post URL, without requiring X access or a paid plan. Existing confirmed in-app publication links remain authoritative. Editing a posted draft does not reopen it or change the linked X post.
- Posted drafts also leave recipients' To review queues, even without feedback, and appear in Done as Posted rather than Reviewed. An edit cannot reopen a posted assignment. Reviewers see View on X for confirmed native or manually linked posts, never an unconfirmed candidate; publication does not bypass review access checks.
- Attached videos autoplay muted and inline while at least half visible, loop, and pause off-screen or in hidden tabs. Native controls remain available. Playback position follows the same attachment through client-side navigation within a browser tab; it is not persisted across reloads or devices. Browser autoplay/codec policies still apply.
- Mobile reviewers get the same readable post preview with feedback below the thread. Desktop feedback sits beside a fixed-width preview. Authors edit directly in that layout, without a separate preview mode; reviewer views hide editing controls. No invented publication dates, verification or engagement counts.
- Settings → Personalisation offers Auto, Dark and Light. The preference belongs to the account; Auto follows the current device's appearance. Signed-out and offline pages retain the last browser choice. The composer and preview keep X-like typography, spacing, thread connectors, link treatment, weighted counts and media layouts in both appearances. Keep LastPeek's identity in the surrounding interface. Rendering can differ across devices; document limitations rather than adding blanket disclaimers to the preview. Link cards, polls, Premium formatting and automatic video transcoding are outside this MVP.
- The entire application, accounts, database, media and maintenance run on one host. No required third-party application service. Portable container deployment; the official invite-only service runs on a Raspberry Pi, with optional Cloudflare Tunnel ingress.

## Guest review access

Guest reviews share the application navigation shell without granting account access. The first
visit asks for a name or offers sign-in and an account request; the name is remembered in browser
session storage. This replaces the older name-on-send flow above. Guests can close the dialog and
read without a name, but sending feedback still requires one. A guest icon and label distinguish
name-only feedback from account identities. Account-navigation attempts offer sign-in or an access
request without leaving the draft or discarding unsent feedback. External browser navigation still
works normally with the usual unsent-text warning.

Requests store only name, email and request time, with origin, payload-size and rate limits.
The owner sees unfulfilled requests in Invitations and explicitly creates an invitation using the
existing flow. There is no automatic account, plan grant, email delivery or email verification.
Duplicate requests receive the same response and do not overwrite the original request.

## Public landing page and waitlist

Signed-out visitors to `/` see the public landing page; signed-in accounts keep their work queue at
the same address. The page explains the product with a recreation of a draft receiving feedback, the launch film as
its walkthrough (muted preview while visible, chapters for each step, sound only on request),
a real quote from an early user, and a short FAQ. `/login` and `/join/<token>` render
the same page with the sign-in or create-account dialog open; their native forms work without
JavaScript. Its primary
action is joining the waitlist with an email address; existing users sign in from the header, the
hero and the closing section. A browser that has signed in before sees Sign in as the primary header
action. An installed app opened while signed out goes straight to sign-in.

Waitlist entries reuse the account-request queue (migration 041 makes the name optional). The owner
sees them under site admin Invitations → Waitlist with Copy emails and an Invite action per entry.
Joining never creates an account or invitation, and repeated emails receive the same response.
When public sign-up opens, replace the waitlist form; the rest of the page stays.

Only the signed-out landing page, `robots.txt` and `sitemap.xml` are indexable. Every other response,
including the signed-in home, keeps `noindex`. The page ships its own title, description, canonical
URL, static Open Graph/X card image (never a video link preview), and WebApplication, VideoObject
and FAQPage structured data. The on-page film stays muted until its restart finishes when sound is requested. Landing
assets live in `static/landing` (film, poster, card image and a subset of Outfit, OFL); no external
service, font host or analytics is loaded.

## Replies and quote posts

New Quote and New Reply are available to Pro accounts. Shared reviews use the author's access, not the
reviewer's. Downgrading removes source previews without losing draft edits
or human feedback.

Existing drafts offer Post/Reply/Quote through More → Change draft type. Switching preserves text, media and
discussion; a new reply/quote source requires a validated X URL and successful source lookup.
Switching between reply and quote on the same source does not fetch a new source. Free accounts
can remove an existing source, but cannot create a new relationship. Once publishing starts or
the draft is marked posted, its type/source cannot change. Failed changes leave the old draft intact.

The New post split button creates a normal draft or opens a paste menu; mobile uses the floating plus. These accept an HTTPS X or legacy Twitter post link and retain its canonical URL and relationship with the draft and shared revisions. Replies show the original above the draft; quotes show it beneath the opening post's text/media. An optional server-side X API token enables native source cards with author, text, media, timestamp and View on X. Brief caching and a persistent request budget bound paid lookups. Creation requires a successful source lookup; missing configuration, unavailable/unsupported content and exhausted budgets show “Quotes and replies aren’t available right now.” Existing drafts remain editable without a source preview. There is no embed fallback. Normal drafting and human feedback require neither paid APIs nor an X account connection. External source content is not an archived snapshot. Publishing these relationships uses optional X publishing below, subject to X's access restrictions. Link cards, polls and Premium formatting remain outside scope; video preparation happens only during explicit publishing, never during review uploads.

Opening the creation menu shows Paste to reply or quote, with New post underneath. Browsers supporting clipboard-read permission (including desktop Chrome/Edge) may read once on opening, only if permission is already granted and the document has focus. Otherwise only the explicit paste action requests clipboard access; opening the menu must never cause a permission prompt. There are no reads on app launch, foregrounding or clipboard changes. Automatic reads ignore unrelated text and failures quietly. Explicit empty or invalid pastes briefly change the action to a red “No X link copied”, then fade back; denied or unsupported access instead says “Couldn’t paste link”. A valid X post link replaces the initial options with its canonical URL, New reply and New quote; no source request occurs until one is chosen. Desktop also accepts ordinary Ctrl/Cmd+V while the menu is open, without intercepting pastes into text inputs. Closing and reopening resets the menu and rechecks the current clipboard when permitted. Replies and quotes also offer Finish in X: explicitly copy the opening post's text, then open the original to finish manually. Additional posts and attachments use the editor's existing per-post copy/download controls. This handoff does not publish or mark the draft as published; direct publishing remains separate.

## Free and Pro trial

Free is usable indefinitely: 10 saved drafts, 250 MB of media and the complete human-review workflow. A draft may contain up to 25 posts and counts once. Pro starts with 100 drafts, 2,048 MB, US$0.50 of AI and US$1.50 of X API usage per monthly period. Both plans allow uploads up to 50 MB. X profile connection/sign-in is independent of Pro. All accounts existing at migration 014 become Pro; future accounts default Free unless their email invitation specifies Pro.

The owner controls plans and allowances in site admin. Free changes apply immediately. Pro increases apply immediately; reductions wait until each account's next monthly period. Periods are anchored to account creation (migration time for existing users), use UTC calendar-month boundaries, and do not reset when plans change. Usage does not roll over. Scheduling Free at period end preserves Pro until then; immediate downgrades are also available. No billing or automatic charges exist yet.

Over-quota accounts keep editing, sharing, human feedback, copying, downloading and deletion. Creation and storage additions are blocked when they would exceed limits. Deleting a draft deletes its revisions, comments, review link and attachments; removing one attachment may leave revision-retained media until the draft is deleted. No automated excess-data deletion policy is implemented. A future notified retention policy needs its own terms and warning flow.

AI review, X source reads, X publishing and mention lookups are released Pro capabilities, not feature flags. API budgets reserve conservatively before requests; known costs reconcile against usage, while unknown costs keep their reservation. Global safety caps still apply. Site admin's financial model is hypothetical, separate from live allowances and not a provider invoice.

## X mentions

Pro authors have optional account suggestions while editing, without a feature grant. Lookups require a connected X account with `users.read`; manual mentions and posting remain usable without them. After at least three handle characters and a short typing pause, a compact account picker inserts the selected handle without altering surrounding text. Leaving a text field checks its completed mentions; only a confirmed missing account gets rose text and an inline “not found on X” explanation. Warnings can be dismissed until the text changes. Provider failures are not invalid mentions and neither state blocks posting. Lookups use the existing X allowance and instance safety budget, with per-author caching and bounded results.

## X publishing

Pro authors can publish ordered threads, replies and native quotes with up to 280 weighted characters per post, including media-only posts, without a feature grant. Each post supports up to four photos, one GIF or one video. X's own access restrictions still apply: native quotes require Enterprise API access. Publishing is optional; local accounts and review workflows do not require it. Request `tweet.write` and `media.write` only through the author's explicit Allow posting / Connect X action, then return to the draft without posting automatically. Existing text-only permissions need upgrading before uploading media.

Post to X sits to the right of the final add-post button, using the X logo in place of the letter. Multi-post drafts say Post all. A normal click or keyboard activation opens a compact confirmation of the actual connected account with a tip that holding skips confirmation; do not repeat the draft or add a sound checkbox. Holding for 1.5 seconds is an alternative confirmation, with a warm gradient charge, synthesized musical feedback and best-effort device vibration. Keep idle controls free of extra helper text; account and gesture remain accessible in the button's description/title. Releasing early after beginning a hold, leaving the button, scrolling/cancelling, losing focus, hiding the page, Escape or changing the draft cancels the gesture. Respect reduced motion; never depend on sound or haptics to communicate state.

Successful publishing retains the draft and feedback and exposes View on X. Preparing/uploading/processing states stay on the button. Media must finish processing before its post is sent; upload failure never silently posts without attachments. Private JPEG conversion and H.264/AAC MP4 preparation leave originals and shared reviews unchanged. X upload limits are 5 MB per photo, 15 MB per GIF and LastPeek's 50 MB video cap after preparation, with a bounded conversion time.

Partial threads retain confirmed post IDs and offer Continue posting for remaining posts only, bound to the same saved version and X account. A closed page stops advancing the job after its in-flight operation; resumption requires explicit confirmation. Edits after partial publication cannot change the remaining publication. A lost response during post creation blocks retry to prevent duplicates; media operations can be restarted safely without creating a post. Edits never update X, and completed drafts cannot publish again. No automatic reconciliation runs. Deleting the LastPeek draft does not delete anything on X. Real-account compatibility and billing still require an explicitly authorised live trial.

## Agent connections

Agents is an account-flagged private trial, initially enabled only for the owner's test account.
It is a Settings section shared by desktop and mobile. Users connect compatible
remote HTTP MCP clients with OAuth, choose plain-language permissions, and can change permissions
or disconnect each connection independently. Consent defaults to read access; writing, feedback,
resolution and sharing require explicit selection. Compact connections show the app-provided name
and last authenticated use—not verified agent identity or online presence. Permission details open
in a desktop dialog or a mobile page, with approval/expiry dates. Disconnected rows disappear;
expired connections remain distinguishable and removable. A compact setup card sits above the
connection list on both desktop and mobile. New permissions require OAuth reauthorization.
Consent offers 30 days, 90 days (default), 1 year or Until disconnected. Active connections can
change expiry in their permission editor; changing permissions alone never extends expiry.
Disconnected and expired connections require fresh consent. Access tokens renew silently through
rotating refresh credentials; an agent unused for 30 days may need to sign in again.

Tools cover text posts/threads, targeted post edits, private media uploads/reads, source-linked
replies and quotes, search/status filters, local X readiness checks, review/feedback queues and
sharing inspection or recipient removal. Owners can respond to an existing review using its draft
ID without creating another link. Read-only account context exposes permissions, tool discovery,
allowances and metadata-only recent operations. Task-based groups cover Drafting, Feedback, Sharing,
and optional AI/X tools. Groups start collapsed with selection counts and group checkboxes visible.
Review-link management and sharing with specific people are separate permissions. Older combined
sharing grants retain their existing authority and can be narrowed independently without reconnecting.
Attachments follow draft/review permissions, and accepted friends remain
available for choosing private-review recipients, without friendship or notification management.
Existing connections can request added permissions in Settings and complete OAuth reauthorization
from the agent without deleting their connection; client reauthorization support varies. Provider calls
reuse website eligibility, cache and allowances; paid X reads are not selected by default.
New permissions always require fresh consent and never broaden existing credentials.

Small media uploads can be inline; larger files use a short-lived draft-bound binary transfer,
not a remote filesystem path or unrestricted URL import. Existing ownership, review access,
quotas and optimistic concurrency still apply. Editing a shared draft advances its review as on
the website. An authorized agent acts as the user; feedback retains that account’s identity plus
the server-derived app-provided connection name (shown as “via …”). Names are not verified agent
identities. Sharing permission can change the review audience. No agent may read private reviews
merely because it knows their address. Draft titles, per-thread-item external targets, threaded
comment replies, X publishing, draft deletion and account-security changes are not agent tools.

## Next, not now

Prove the web flow first. Later, an optional browser extension imports X composers and explicitly offers two-way updates. Conflicting website/X edits need comparison and confirmation. Historical capture code lives in the initial prototype Git commit, not an unmaintained second application in the active tree.

The project is AGPLv3 open source with a separately operated hosted service. Hosted deployment and automatic updates are authorized; open public registration, billing and domain purchases are not part of this phase. Before broadening the invite-only trial, confirm encrypted off-device backups, alerts, abuse controls and retention choices. See the deployment runbook for the operational boundaries.
