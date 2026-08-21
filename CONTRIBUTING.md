# Contributing to NAM Web Studio

Thanks for your interest in contributing! This project is free and open source (GPLv3), and
contributions of all sizes are welcome.

## Before you start

- Check the [open issues](https://github.com/pauloedspinho20/NAM-Web-Studio/issues) — work is
  organized into epics (labeled `epic`), each with a task checklist. Comment on an epic or a
  specific task before starting significant work, so effort isn't duplicated.
- If you want to add a new effect or DSP component, read the licensing note below first —
  it affects which upstream source you're allowed to port from.

## Licensing rules for contributed code

This project ships under **GPLv3**. That means:

- Code you write yourself, or MIT/BSD/public-domain sources (e.g. Tuna.js, Airwindows, Freeverb),
  can always be included.
- GPLv2/v3-licensed sources (e.g. Dragonfly Reverb, ChowDSP, Guitarix/Rakarrack) can be ported in,
  but you must note the original project, license, and version in a comment near the port and in
  the PR description. Verify the _specific module_ you're borrowing from is actually GPL (some of
  these projects mix licenses per file).
- Do not add dependencies with more restrictive or incompatible licenses (e.g. proprietary,
  source-available-but-non-free) without raising it in an issue first.

## Development setup

This is a pnpm + Turborepo monorepo (see [README.md](./README.md#project-structure) for the full
layout): the web app lives in `apps/web`, shared design-system components in `packages/ui`, and
`packages/core`/`packages/vst3`/`apps/desktop`/`apps/ios`/`apps/android` are scaffolding for
platform targets tracked by their own issues (#14-#17).

```bash
pnpm install
pnpm dev
```

> `.npmrc` sets `strict-peer-dependencies=true` — a genuinely unmet peer fails `pnpm install`
> outright. If install fails on a peer you didn't touch, it's likely a pre-existing unmet peer
> elsewhere in the tree that your change's dependency resolution just surfaced; check
> `pnpm-lock.yaml`'s current pin before assuming your change is at fault, and prefer a
> `pnpm.overrides` pin (see root `package.json`) over loosening the strict setting.

Useful scripts (run at the repo root; Turborepo fans them out to the relevant package):

- `pnpm lint` — oxlint
- `pnpm format` / `pnpm format:check` — Prettier
- `pnpm test` / `pnpm test:run` — Vitest (watch / single run)
- `pnpm test:e2e` — Playwright e2e (chromium/firefox/webkit desktop + a mobile viewport project,
  see `apps/web/playwright.config.ts`); run `pnpm --filter @nam/web exec playwright install` once
  first to fetch the browser binaries. These hit a real browser's Web Audio API against the actual
  Vite dev server, which Vitest's jsdom environment can't reach - use them for anything that needs
  a real AudioContext, not as a substitute for unit tests.
- `pnpm build` — typecheck + production build (web app + `packages/ui`; the native desktop app is
  opt-in via `pnpm build:desktop` / `pnpm build:all`)
- `pnpm dev:desktop` / `pnpm dev:all` — run the native desktop app, or web + desktop side by side
  (see [README.md](./README.md#development))
- `pnpm storybook` / `pnpm build-storybook` — Storybook dev server / static build, scanning
  `packages/ui`'s component stories

All five (`lint`, `format:check`, `build`, `test:run`, `test:e2e`) must pass before a PR is merged —
CI runs them on every push and pull request.

## Commit / PR expectations

- Keep PRs scoped to one task from one epic where possible.
- Pre-commit hooks (Husky + lint-staged) will auto-fix lint/format issues on staged files.
- Reference the epic and/or task in your PR description.
