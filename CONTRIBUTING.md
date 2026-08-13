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

```bash
npm install --legacy-peer-deps
npm run dev
```

> `--legacy-peer-deps` works around a known npm/arborist resolution issue with the current
> `vitest` + `@vitest/coverage-v8` peer dependency graph — safe to use here.

Useful scripts:

- `npm run lint` — oxlint
- `npm run format` / `npm run format:check` — Prettier
- `npm run test` / `npm run test:run` — Vitest (watch / single run)
- `npm run test:e2e` — Playwright e2e (chromium/firefox/webkit desktop + a mobile viewport project,
  see `playwright.config.ts`); run `npx playwright install` once first to fetch the browser
  binaries. These hit a real browser's Web Audio API against the actual Vite dev server, which
  Vitest's jsdom environment can't reach - use them for anything that needs a real AudioContext,
  not as a substitute for unit tests.
- `npm run build` — typecheck + production build

All five (`lint`, `format:check`, `build`, `test:run`, `test:e2e`) must pass before a PR is merged —
CI runs them on every push and pull request.

## Commit / PR expectations

- Keep PRs scoped to one task from one epic where possible.
- Pre-commit hooks (Husky + lint-staged) will auto-fix lint/format issues on staged files.
- Reference the epic and/or task in your PR description.
