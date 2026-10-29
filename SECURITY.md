# Security

Report vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/AlexanderHeffernan/LastPeek/security/advisories/new). If unavailable, contact the maintainer at heffernan.alexander@icloud.com. Do not publish exploit details, draft contents, credentials or review links in public issues. There is no guaranteed response time or bug-bounty programme.

Only the current `main` branch is maintained. LastPeek is early-stage software, not independently security-certified. The hosted instance is invite-only; do not rely on it as your only copy of irreplaceable or highly sensitive material.

## Boundaries

- A review link is an unlisted bearer capability, not a private invitation to a named person. Every holder can read shared history/media and leave feedback. Guest names are unverified. Revocation cannot erase downloaded copies.
- Drafts, accounts and original media stay on the operator's host. Private media is never served from `static/`. Passwords are scrypt-hashed; sessions and invitations are token-hashed. The database contains review capabilities and must be treated as sensitive.
- HTTPS, backups, disk capacity, OS/container updates and proxy trust are operator responsibilities. Never expose PostgreSQL or trust arbitrary forwarded client-IP headers.
- Cloudflare is an optional deployment provider, not an application requirement. On the official hosted instance its tunnel terminates public HTTPS; Cloudflare is therefore in the trust boundary. Avoid logging URL paths/query strings, which can contain review capabilities.
- Invite-only access and per-user upload quotas reduce abuse; they are not a general public-registration anti-abuse system. Draft/revision/comment text has no total per-account storage quota. Media is type-inspected but not antivirus-scanned or comprehensively video-decoded. Upload originals may contain EXIF/location metadata.

## Publication review

The initial publication review scanned all four existing commits and reachable refs with Gitleaks 8.30.1 (`--all --full-history`, redacted output): no findings. Historical file names and credential-related changes were also reviewed, including the original Safari prototype. No environment files, real drafts, credentials, signing keys or private media were found tracked. Public commit author identity and historical development notes remain intentionally visible. This is evidence of a review, not a guarantee that no vulnerability exists.

The review also removed an extra per-request password derivation for nonexistent accounts. Missing-account and wrong-password failures now both perform one comparison derivation after startup and return the same generic message. This reduces an account-enumeration timing signal; it is not a claim that entire HTTP responses are constant-time. Browser tests cover invalid-invitation signup denial, single-use invitations, administrator-only invitation creation, cross-site form/API rejection, cross-owner denial, private working copies and review/media revocation.

`npm audit` reports one underlying low-severity advisory, [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4), in `deepmerge` 4.3.1 through Svelte's build tooling (four affected dependency entries). Application draft input is not passed to that build-time merge. CI rejects moderate-or-higher dependency advisories. Do not use `npm audit fix --force` to install an incompatible framework downgrade; reassess when upstream releases a compatible fix.

See [deployment and recovery](docs/deployment.md) for operating requirements. Never run E2E tests against production: they create accounts and directly access the configured database.
