# Working on LastPeek

Read `docs/product.md` and `docs/architecture.md` before changing behaviour. Keep the product focused on draft review; no external service may become mandatory.

Read `docs/design.md` before UI or copy changes. LastPeek is dark-only, minimal, X-native in the composer and preview, with its own restrained signal-green identity. Reuse the shadcn-svelte components in `src/lib/components/ui`; use Phosphor icons. Fix confusing interactions instead of adding explanatory disclaimers. Mobile must retain desktop capabilities.

- TypeScript + SvelteKit, one server, PostgreSQL and private filesystem media. Server-only code belongs in `src/lib/server`. Contracts shared with UI belong in `src/lib`.
- `npm ci`, `npm run db:migrate`, `npm run db:seed`, `npm run dev` start development after PostgreSQL and `.env` exist. See README for Docker and orb setup.
- Run `npm run check`, `npm test`, `npm run build`, and `npm run test:e2e` for behavioural changes. E2E tests use a running app and a disposable test account; never point them at a real user's instance.
- GitHub Actions verifies pull requests and publishes tested multi-architecture images on main. Never run untrusted pull requests on the Pi or grant them publishing credentials.
- When Alexander asks to ship, follow delivery all the way through deployment, not just the push. Read `docs/deployment.md`, watch the exact commit's CI and image-publishing jobs, then wait for the Pi's automatic update. Verify that `https://lastpeek.alexheffernan.dev/health` returns HTTP 200 with that commit's full SHA in `X-LastPeek-Revision`, and check the public page. For visual changes, inspect the deployed desktop and mobile layouts. Report completion only after those checks pass; otherwise keep investigating and report the specific blocker. Do not silently stop after saying CI is running or require a separate request to babysit deployment. Monitoring does not authorize manually accelerating deployment, changing production infrastructure or data, or rolling back; obtain separate approval when needed.
- Browser-verify visual changes at desktop and mobile widths, including failures and older-revision feedback. Use accessible labels, not implementation selectors, in tests.
- Preserve owner checks and capability checks in every server operation. Media must never move into `static`. Never log draft text, passwords or review tokens.
- Revisions are immutable. Autosave must use the expected edit version. Comments retain their original revision and post identity.
- Use SQL migrations; do not mutate schema automatically on requests. New abstractions need a real second consumer or a coherent responsibility.
- Do not commit `.env`, media, database volumes or test artifacts. No agent co-author trailers. Commit as the checkout's configured human identity.
