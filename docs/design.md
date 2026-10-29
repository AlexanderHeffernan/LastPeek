# LastPeek design

LastPeek is the quiet moment before posting on X. Minimal does not mean unfinished. Make the interface precise, distinctive, and obvious without explaining it away.

## Identity

- Dark only. Neutral near-black page (`#080909`), restrained raised surfaces, hairline borders, off-white text. Never switch with the OS theme or introduce a separate light variant.
- Signal green (`#c4f36b`) belongs to LastPeek: primary actions, focus, shared state, and the peek/spark logo. Use it sparingly. No decorative gradients, rainbow statuses, or glowing dashboard chrome.
- The mark is an open eye with a notched pupil and a small spark. Keep the header mark and `static/favicon.svg` in sync; do not replace it with a generic library eye.
- Use system Arial/Helvetica for an X-like, local-first type stack. Clear hierarchy, quiet metadata, comfortable contrast. No required remote fonts or image services.

## Components are the source of truth

- Use the checked-in shadcn-svelte (Vega) controls under `src/lib/components/ui`: Button (also for action links), Input, Textarea, Badge, and Tabs. Tailwind 4 and semantic CSS variables in `src/app.css` supply the theme. Change a shared control for a shared visual rule; do not create competing page-local buttons or form fields.
- Components are owned source, customized for LastPeek, not a runtime hosted service. Additional components should come from shadcn-svelte and be added only when needed. The CLI currently cannot resolve Kit 3's `$app/tsconfig`; components can be copied from the official registry (`https://www.shadcn-svelte.com/registry/styles/vega/<name>.json`), replacing its utility/UI aliases with this repository's aliases. Do not downgrade Kit or rewrite its TypeScript setup to accommodate the CLI.
- Use Phosphor (`phosphor-svelte`), regular weight, through `Icon.svelte`. Import individual `phosphor-svelte/lib/<Name>` modules so builds do not compile the entire icon library. Custom SVG is for the brand, not a second icon family.
- Use component variants rather than legacy `primary`/`quiet` classes. Layout classes describe real surfaces and relationships; don't create one-off control themes. Native select, file input, progress, and disclosure semantics are valid; preserve keyboard and touch usability.

## The post is the product

- `PostPreview.svelte` renders posts for both authors and reviewers. Do not fork their preview styling. A desktop timeline is at most 600px wide; mobile uses available width without shrinking text or removing capabilities.
- X's black canvas, `#e7e9ea` text, `#71767b` handle, blue links, 40px avatars, 12px avatar/content gap, 15px/20px timeline text, and 20px/24px composer text anchor the design. Preserve actual whitespace and Unicode. URLs, mentions, and hashtags are linked without rendering user-supplied HTML.
- A preview is a timeline post, not a marketing card. Media has rounded, bordered crops and tight multi-image grids. Threads have continuous connectors. Do not invent timestamps, verification, follower counts, engagement, or controls for unsupported X features.
- Editing controls and character counts disappear in Preview. Use `twitter-text` weighted counts, including URLs and Unicode, not string length. Long drafts stay supported; Premium requirements are contextual, not an always-visible paragraph.
- Keep copy-text and download-file actions separate, grouped by post. Don't label an action “Post” if it only copies text. LastPeek does not publish to X.

## Copy and interaction

- Prefer “Feedback”, “Review link”, “Copy text”, “Download”, and “Account” to metaphors or explanatory paragraphs. A little voice belongs in the entry/empty state, not every label.
- Do not add “Unpublished preview”, “Appearance approximates…”, “Copying text doesn't attach…”, or similar defensive captions. Fix the design that made the explanation necessary.
- Keep actionable errors, save/conflict state, destructive confirmations, and security consequences. Briefly disclose bearer-link access where sharing happens. Earlier-version feedback must retain a visible version label and a way to open that version. Minimal copy must never disguise data loss or privacy implications.
- Use labelled controls, visible keyboard focus, accessible tab semantics, and comfortable touch targets (40–44px). Never put essential actions behind hover alone. Respect reduced motion.

## Responsive verification

Check login/join, empty and populated drafts, Write/Preview, media, sharing, settings, guest feedback, failures, and older-version feedback. Desktop feedback sits beside the post; below 900px it follows it. Mobile retains editing, uploads, reorder/remove, review, revision history, copying, and downloads. Check at 390px and a narrower 320px; no horizontal scrolling or tiny replacement controls. Inspect actual rendered screenshots and exercise keyboard and touch interactions, not just CSS breakpoints. See root guidance for required checks.
