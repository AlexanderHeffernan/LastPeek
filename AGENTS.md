# Working on LastPeek

Read `docs/product.md` and `docs/architecture.md` before changing behaviour. Keep the product focused on draft review; no external service may become mandatory.

- TypeScript + SvelteKit, one server, PostgreSQL and private filesystem media. Server-only code belongs in `src/lib/server`. Contracts shared with UI belong in `src/lib`.
- `npm ci`, `npm run db:migrate`, `npm run db:seed`, `npm run dev` start development after PostgreSQL and `.env` exist. See README for Docker and orb setup.
- Run `npm run check`, `npm test`, `npm run build`, and `npm run test:e2e` for behavioural changes. E2E tests use a running app and a disposable test account; never point them at a real user's instance.
- Do not configure GitHub Actions or add workflow files. This private repository uses local/orb verification only.
- Browser-verify visual changes at desktop and mobile widths, including failures and older-revision feedback. Use accessible labels, not implementation selectors, in tests.
- Preserve owner checks and capability checks in every server operation. Media must never move into `static`. Never log draft text, passwords or review tokens.
- Revisions are immutable. Autosave must use the expected edit version. Comments retain their original revision and post identity.
- Use SQL migrations; do not mutate schema automatically on requests. New abstractions need a real second consumer or a coherent responsibility.
- Do not commit `.env`, media, database volumes or test artifacts. No agent co-author trailers. Commit as the checkout's configured human identity.
