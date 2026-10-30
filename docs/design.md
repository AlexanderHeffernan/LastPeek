# LastPeek design

LastPeek is the quiet moment before posting on X. Minimal does not mean unfinished. Make the interface precise, distinctive, and obvious without explaining it away.

## Identity

- Dark only. Neutral near-black page (`#0b0b0c`), restrained raised surfaces (`#161618`), hairline borders (`#2b2b2e`), warm off-white text (`#f2f0ec`). Never switch with the OS theme or introduce a separate light variant.
- Coral (`#ff6b5b`) belongs to LastPeek: the logo, primary actions, focus, and shared state. Use it sparingly. Destructive states use rose (`#ff7aa2`) so they never read as a primary action. No decorative gradients, rainbow statuses, or glowing dashboard chrome.
- The mark is a coral speech bubble with two off-white eyes glancing right; the wordmark is “LastPeek” outlined from Outfit ExtraBold (OFL) with coral pupils in the “ee”. Each “e” is a solid eyeball with a coral iris and a thin lid slit (02A). Both live as SVG in `Brand.svelte`, so no font is loaded. The pupils follow a nearby mouse and rest looking right; the motion is decorative, so it stays still for touch and reduced motion. Keep `static/favicon.svg`, `favicon.ico` and `apple-touch-icon.png` in sync with the mark; do not replace it with a generic library eye.
- Use system Arial/Helvetica for an X-like, local-first type stack. Clear hierarchy, quiet metadata, comfortable contrast. No required remote fonts or image services.

## Components are the source of truth

- Use the checked-in shadcn-svelte (Vega) controls under `src/lib/components/ui`: Button (also for action links), Input, Textarea, Badge, and Tabs. Tailwind 4 and semantic CSS variables in `src/app.css` supply the theme. Change a shared control for a shared visual rule; do not create competing page-local buttons or form fields.
- Components are owned source, customized for LastPeek, not a runtime hosted service. Additional components should come from shadcn-svelte and be added only when needed. The CLI currently cannot resolve Kit 3's `$app/tsconfig`; components can be copied from the official registry (`https://www.shadcn-svelte.com/registry/styles/vega/<name>.json`), replacing its utility/UI aliases with this repository's aliases. Do not downgrade Kit or rewrite its TypeScript setup to accommodate the CLI.
- Use Phosphor (`phosphor-svelte`), regular weight, through `Icon.svelte`. Import individual `phosphor-svelte/lib/<Name>` modules so builds do not compile the entire icon library. Custom SVG is for the brand, not a second icon family.
- Use component variants rather than legacy `primary`/`quiet` classes. Layout classes describe real surfaces and relationships; don't create one-off control themes. Native select, file input, progress, and disclosure semantics are valid; preserve keyboard and touch usability.

## The post is the product

- `PostPreview.svelte` renders posts for both authors and reviewers. Do not fork their preview styling. A desktop timeline is at most 600px wide; mobile uses available width without shrinking text or removing capabilities.
- X's black canvas, `#e7e9ea` text, `#71767b` handle, blue links, 40px avatars, 12px avatar/content gap, and 15px/20px text anchor both the writable post and the review. Preserve actual whitespace and Unicode. URLs, mentions, and hashtags are highlighted while editing and linked in read-only views, without rendering user-supplied HTML.
- A preview is a timeline post, not a marketing card. Media has rounded, bordered crops and tight multi-image grids. Threads have continuous connectors. Do not invent timestamps, verification, follower counts, engagement, or controls for unsupported X features.
- Edit directly in the post layout, with no title, per-draft identity fields, or Write/Preview switch. The account avatar opens settings; the logo goes home. Editing controls and character counts disappear in reviewer and historical views. Use `twitter-text` weighted counts, including URLs and Unicode, not string length. Long drafts stay supported; Premium requirements are contextual, not an always-visible paragraph.
- Like X's composer, only the post being written shows its tools: coral Phosphor icons for upload, copy text and download, the count ring, and a compact outlined plus that inserts the next post after it. Other posts in the thread dim until focused; the active post's header has a small remove control. Posts are not reordered. In reviewer and historical views, copy and download icons sit along the bottom of every post. Links inside posts stay X blue; LastPeek's own controls use coral. Do not copy whole threads. Don't label an action “Post” if it only copies text. LastPeek does not publish to X.
- Align the editor top with share/delete actions on desktop; on mobile, actions precede the editor. Sharing becomes a Copy link split button with Open preview and Remove link in its dropdown. Optional AI Review sits alongside it. Keep successful autosaves quiet; show failures inline and warn before leaving unsaved edits. Draft deletion has a circular trash action and a confirmation dialog. Human feedback immediately follows the action row, without a redundant heading or refresh icon. The footer rests at the viewport bottom on short pages and follows content on longer pages.
- Account Profile contains the user's display name, X handle and photo, with brief context that these are used in post previews. Avatars are private, cropped to a square and compressed; header and posts use the same profile photo, while historical versions retain theirs.

## Copy and interaction

- Prefer “Feedback”, “Review link”, “Copy text”, “Download”, and “Account” to metaphors or explanatory paragraphs. A little voice belongs in the entry/empty state, not every label.
- Do not add “Unpublished preview”, “Appearance approximates…”, “Copying text doesn't attach…”, or similar defensive captions. Fix the design that made the explanation necessary.
- Keep actionable errors, save/conflict state, destructive confirmations, and security consequences. Do not add link-ready notices or a separate review-link panel. Older feedback carries a quiet “Earlier feedback” indicator, not a version number or history control. Reviewer composition precedes existing feedback; general feedback is the default, with clickable posts and selected-text quotes as optional focus. Ask guests for a name only when sending. Minimal copy must never disguise data loss.
- Use labelled controls, visible keyboard focus, accessible tab semantics, and comfortable touch targets (40–44px). Never put essential actions behind hover alone. Respect reduced motion.

## Responsive verification

Check login/join, empty and populated drafts, inline editing, media, sharing, settings, guest feedback, failures, and older feedback. Desktop feedback sits beside the post; below 900px it follows it. Mobile retains editing, uploads, post removal, review, feedback focus, copying, and downloads. Check at 390px and a narrower 320px; no horizontal scrolling or tiny replacement controls. Inspect actual rendered screenshots and exercise keyboard and touch interactions, not just CSS breakpoints. See root guidance for required checks.
