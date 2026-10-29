# Optional X integration plan

## Status and direction

Deferred: this document records the discussion and documentation research as of 29 October 2026. It does not enable X sign-in, authorise API spending, or change the current product contract. Recheck X's access rules, pricing and policies before implementation; no authenticated X API test has been performed.

LastPeek should remain the quiet moment before posting: write, get feedback, and make a deliberate handoff to X. An optional connection can reduce onboarding friction, improve review context and eventually remove manual posting steps. It should not turn LastPeek into a feed, scheduler or social-media management dashboard.

Email/password authentication, invitation-only author registration, account-free guest reviews and manual copy/download must continue to work without X. Self-hosting must not require X credentials or another hosted authentication service. Publishing would deliberately extend the current scope in [product.md](product.md) and [design.md](design.md); update those contracts when that feature is approved, not merely because it appears here.

## Credentials, access and cost

Working X sign-in requires a registered developer app and credentials. For the proposed OAuth 2.0 web-app flow, these are a Client ID and Client Secret with an exactly registered callback URL, not an app-only bearer token. An authentication provider would not remove X's requirements.

Do not assume sign-in is free. OAuth authorisation and user identity lookup are separate steps; the proposed flow uses `GET /2/users/me` to establish identity. X lists user reads as billable, and the research found no explicit sign-in exemption. Whether a newly registered app can complete sign-in without purchased credits remains unverified. The documented older OAuth 1.0a sign-in flow also needs app credentials and is not a verified no-cost workaround.

Before committing to spend:

1. Register/configure a developer app when the owner is ready, and inspect its actual access and billing requirements.
2. Verify a complete sign-in with a real account, including identity lookup, permission prompts and any charge.
3. Confirm endpoint access and a budget before enabling other integrations. Do not enable automatic credit recharge without approval.

Published reference prices at the research date are US$0.010 per user read, US$0.005 per post read, US$0.015 per post creation and US$0.200 per post creation with a URL. These are billing units, not all-in workflow estimates; media and other operations need separate checking. Do not apply the discounted “Owned Reads” rate to every LastPeek user: X's documentation limits it to the authenticated user who also owns the developer app. Recheck current console pricing before launch.

## Phase 1: sign-in, linking and profile

### User experience

- Offer “Continue with X” on sign-in and valid invitation pages when configured. X sign-in must not bypass invitations or open public registration.
- Offer “Connect X” in account settings for existing authors. Linking adds a sign-in method to the same LastPeek account; it must not create a second collection of drafts.
- Populate the preview identity from the connected profile's name, handle and avatar, with explicit handling of later profile refreshes. Preserve the identity captured in immutable shared revisions rather than rewriting historical reviews.
- Let X-first users add email/password later. Never allow removal of their last usable sign-in method. Define recovery for X-only accounts using the existing administrator-assisted model; do not imply that email reset delivery exists.
- Hide X entry points when the integration is not configured. Local authentication remains available during X outages.

### Server and data design

Keep the existing SvelteKit server, PostgreSQL accounts and LastPeek sessions. X establishes identity; LastPeek still creates and validates its own session cookies. Follow the boundaries in [architecture.md](architecture.md), with X protocol operations in server-only code and route handlers adapting them to HTTP.

Use OAuth 2.0 authorisation code flow with PKCE (`S256`), random state and short-lived, single-use authorisation attempts. Bind each attempt to its initiating browser and purpose: sign-in, invited registration or linking to a specific signed-in account. For linking, confirm the initiating LastPeek account is still authenticated on callback. Validate expiry, state and callback destination; prevent replay and arbitrary return redirects. Rate-limit initiation and callbacks and handle denial or upstream failure without leaking credentials.

Store the stable X user ID separately from the LastPeek user ID, with a database uniqueness constraint preventing one X identity from belonging to multiple LastPeek accounts. Handles are display data, not account identifiers. Do not automatically merge accounts because emails or handles match. A person with an existing account must authenticate to it and explicitly connect X; report conflicting links without moving ownership.

The current schema requires both email and password hash. Introduce a backward-compatible SQL migration allowing X-first accounts without fabricated email addresses or unusable placeholder passwords. Audit password login, settings, session user types, seed/reset tooling and recovery for absent credentials. Consume invitations and create/link identities transactionally, including concurrent callbacks and duplicate-link attempts. Preserve owner checks, CSRF protections and session security.

Keep app secrets on the server and out of source control, browser payloads and logs. Do not log authorisation codes, access/refresh tokens, draft text or review tokens. Request only the scopes actually required by the identity endpoint; verify the endpoint's scope mapping rather than requesting broad permissions in anticipation of future features. Review X's identity-display and branding requirements before launch.

### Preparing without live credentials

It is possible to implement migrations, configuration gating, OAuth callbacks, linking and tests against mocked X responses without purchasing API access. This is not working production X sign-in until the real app is configured and the full flow is verified. Test doubles must stay in the test environment and never become a production authentication bypass.

Do not build token refresh infrastructure or retain long-lived access solely for hypothetical future features. Keep linked identity separate from API authorisation so a later feature can request additional scopes for that same X account without migrating drafts or replacing LastPeek accounts.

## Later API capabilities, in recommended order

### Public-post context for a reply or quote draft

Let an author paste an X post URL, retrieve the public source post through post lookup, and write a response with that context visible to reviewers. This extends review from “is the wording good?” to “is this an appropriate response?” without building a timeline browser.

Start with public posts only. A connected account's access to protected content must never silently grant that access to everyone holding a LastPeek review link. Define source-post deletion/edit handling, retention and display obligations under X's policies. Keep external context separate from editable author text and preserve immutable LastPeek revisions and comment identities.

Contextual review does not imply that LastPeek can publish that response through the API. Quote-post and reply restrictions below apply independently.

### Explicit publishing of the reviewed version

Publishing could remove copy/download/upload friction for text and media, including alt text through media metadata. Only the author may publish, with an explicit confirmation of the target X account and selected immutable version. New working edits must not silently replace the version selected for posting. Guest feedback or approval must never trigger publication.

Before building the full feature, run a small, explicitly authorised real-account feasibility test covering standalone text, URLs, images, GIF/video, alt text, long text and self-reply threads. Validate account entitlements and actual billing rather than inferring support from request fields. Upload success does not guarantee post creation will accept the media.

Important constraints in the current documentation:

- The create-post reference says `quote_tweet_id` requires Enterprise access, despite the general guide showing a quote example. Do not promise self-serve quote publishing.
- The manage-posts guide restricts self-serve replies to cases where the original author explicitly summoned the replying account by mentioning it or quoting one of its posts. Verify how this affects self-reply threads; general thread-support wording is insufficient evidence.
- Media limits depend on the posting account and media category as well as endpoint validation. Do not assume LastPeek's accepted uploads are automatically valid X attachments.

Persist publication progress and returned post IDs. Threads are multiple writes, not an atomic operation: report partial success and reconcile uncertain outcomes before retrying to avoid duplicate posts. Do not automatically delete already-published posts as compensation. Keep manual copy/download as a fallback.

Persistent API use will require server-side encrypted token storage, an operator-managed encryption key, granted-scope and expiry tracking, safe refresh-token rotation and reconnect handling. Ask for offline access and additional permissions when the user enables the relevant feature, not during basic sign-in. Distinguish a linked sign-in identity from currently valid API access. Define revocation, disconnect and token deletion behaviour; a revoked grant must not look like a ready-to-use capability.

### Bookmarks as an optional starting point

X documents reading a user's bookmarks. Later, an author could select a saved public post and start a contextual draft. Prefer paste-a-link first; a bookmarks browser adds private data handling, pagination, permissions and cost. Never expose the bookmark collection to reviewers or fetch it in the background merely because an account is linked.

### A published-post reference

Attach a “View on X” link and publication record to the draft to close the loop. Manual entry of a published URL could support this before API publishing exists. Any automatic comparison with the reviewed version would need an explicit design and must not rewrite revision history.

Engagement metrics exist, with additional ownership/authentication requirements and a documented 30-day limit for non-public, organic and promoted metrics. A dashboard is not a priority: it adds recurring reads without directly improving review.

## Native drafts and Articles

The research found no documented public endpoint to list or import ordinary saved X composer drafts, or to synchronise them with LastPeek. Do not market OAuth sign-in as enabling that access.

X does document `POST /2/articles/draft` and an Article publish endpoint. These create long-form Article drafts; they do not establish access to existing ordinary post drafts. Articles would require a separate rich-text review design and entitlement/access testing, so defer them until long-form review is a concrete goal.

The optional browser-extension direction in [product.md](product.md) remains a possible route for explicit composer capture and handoff. It is separate from the public API, needs its own feasibility/policy review, and must compare conflicting edits rather than silently overwriting either side.

## Verification and launch gates

For sign-in/linking, cover successful invited registration and return login, existing-account linking, absent email/password, denial, invalid/expired/replayed state, browser/account changes during linking, duplicate identities, concurrent invitation consumption, unavailable X and safe disconnect/recovery. Prove that X cannot bypass invitations or claim someone else's LastPeek account. Run the repository checks and browser tests, including desktop/mobile account states and failure paths, against a disposable instance.

Mocked protocol tests establish local behaviour, not X compatibility or pricing. Require a real developer app and end-to-end verification before enabling X for users. Store credentials through an appropriate secret-entry mechanism, never by pasting them into a thread or committing them.

For later features, separately verify scopes, access tier, billing, protected-content handling, revoked/expired grants and failure recovery. No live publication, API purchase or production configuration change is authorised by this plan.

## Official references

- [Developer access and credentials](https://docs.x.com/x-api/getting-started/getting-access)
- [OAuth 2.0 authorisation code flow with PKCE](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code)
- [OAuth endpoint mapping](https://docs.x.com/fundamentals/authentication/guides/v2-authentication-mapping)
- [Older OAuth 1.0a sign-in flow](https://docs.x.com/fundamentals/authentication/guides/log-in-with-x)
- [Authenticated-user profile lookup](https://docs.x.com/x-api/users/lookup/quickstart/authenticated-lookup)
- [Pricing and credits](https://docs.x.com/x-api/getting-started/pricing)
- [Post lookup](https://docs.x.com/x-api/posts/lookup/introduction)
- [Manage posts and reply restrictions](https://docs.x.com/x-api/posts/manage-tweets/introduction)
- [Create-post reference and quote-post restriction](https://docs.x.com/x-api/posts/create-post)
- [Media upload](https://docs.x.com/x-api/media/introduction)
- [Media metadata](https://docs.x.com/x-api/media/create-media-metadata)
- [Bookmarks](https://docs.x.com/x-api/posts/bookmarks/introduction)
- [Articles](https://docs.x.com/x-api/articles/introduction)
- [Metrics](https://docs.x.com/x-api/fundamentals/metrics)
- [Developer policy](https://docs.x.com/developer-terms/policy)
