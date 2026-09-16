# Governance

## Maintainer

- **Owner / BDFL:** [@pauloedspinho20](https://github.com/pauloedspinho20) — final review, releases, secrets.

## Decision Making

- Issues and Discussions are the forum. Epics (`epic` label) carry checklists; comment before starting large work.
- PRs require maintainer review; CI must be green (branch protection on `main`/`dev`).
- `feature/* → dev` via squash, `dev → main` via merge commit (`--no-ff`) — see `CONTRIBUTING.md#Branching`.

## Roles

- **Contributor:** anyone opening PRs/issues. Follow `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, DCO (`git commit -s`).
- **Maintainer:** can merge, cut releases (`VERSION`/`v*` via `auto-release.yml`), manage secrets.

As community grows, a lightweight RFC and `CODEOWNERS` per-path reviewers will be added.

## Releases

Automatic from `main` — a push to `main` runs `auto-release.yml` (bump `VERSION` + `CHANGELOG`, commit + tag `vX.Y.Z`, back-merge into `dev`); the tag then drives the self-hosted **Woodpecker** release pipelines (desktop/plugin builds → Cloudflare R2 + `manifest.json` + landing). See `CONTRIBUTING.md#Releasing`.

## Sponsorship

Via [GitHub Sponsors](https://github.com/sponsors/pauloedspinho20) — `FUNDING.yml`.
