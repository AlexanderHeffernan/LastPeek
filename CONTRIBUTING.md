# Contributing to LastPeek

LastPeek is a focused draft-review tool. Read [product scope](docs/product.md), [architecture](docs/architecture.md) and [AGENTS.md](AGENTS.md) before changing behaviour. Discuss larger features in an issue first; integrations must remain optional and the app must remain self-hostable.

Use the README's local setup with Node 22.17+ and a disposable PostgreSQL database. Before opening a pull request, run `npm run format:check`, `npm run check`, `npm test`, `npm run build` and the browser tests as documented. Include desktop/mobile evidence for visual changes and preserve owner checks, immutable revisions, autosave concurrency and private media access.

Never submit credentials, real review links, user drafts, database dumps, uploaded media or `.env` files. Report security problems privately as described in [SECURITY.md](SECURITY.md), not in an issue or pull request.

Contributions are under AGPL-3.0-only, the project's licence. Submit only work you have permission to contribute. No contributor licence agreement is required. Third-party dependencies retain their own licences and notices. The LastPeek name and logo identify the official project; the code licence does not grant trademark rights or permission to imply an official hosted service or endorsement.

Pull requests run on GitHub-hosted runners without deployment secrets. Only checked changes on the official repository's `main` publish deployment images. Maintainers should keep publishing credentials away from pull-request code and never use `pull_request_target` to execute it.
