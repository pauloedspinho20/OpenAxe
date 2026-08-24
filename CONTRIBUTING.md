# Contributing to OpenAxe

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
  see `apps/web/playwright.config.ts`); run `pnpm --filter @openaxe/web exec playwright install` once
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

## Releasing (desktop builds) — fully automatic

The root `VERSION` file is the one source of truth for the product's version — every
`package.json`'s `"version"` field and both `apps/desktop/CMakeLists.txt`'s and
`packages/core/CMakeLists.txt`'s CMake `project()` version are kept in sync with it (checked by
`node scripts/sync-version.mjs --check`, which also runs in CI).

Releases are **fully automatic — no manual bump or tag**. Merging to `main` is the only trigger:

1. Open PRs against `dev` (feature work), then `dev` → `main` when ready to release. Use
   Conventional Commits (`feat:`, `fix:`, `feat!:`/`BREAKING CHANGE:` etc.) — they drive the bump.
2. Merging the `dev` → `main` PR fires `.github/workflows/auto-release.yml`, which:
   - reads conventional commits since the last `v*` tag (`scripts/auto-bump.mjs`),
   - decides `patch` (`fix:`/`chore:`), `minor` (`feat:`), or `major` (`BREAKING CHANGE` / `!` — with `0.y.z` mapping breaking → minor until `1.0.0`),
   - bumps `VERSION`, runs `node scripts/sync-version.mjs`, prepends `CHANGELOG.md`,
   - commits `chore(release): X.Y.Z [skip ci]`, creates annotated tag `vX.Y.Z` and pushes both.
3. Pushing the `v*` tag triggers `.github/workflows/release.yml`, which builds the desktop app for all
   three platforms (same matrix as `desktop.yml`) and publishes the installers as public assets
   on a GitHub Release for that tag — see [CHANGELOG.md](./CHANGELOG.md).

Manual escape hatch: `Actions → Auto Release → Run workflow` with `bump: major/minor/patch` to force
a bump, or locally `node scripts/auto-bump.mjs --dry-run` to preview / `node scripts/auto-bump.mjs --tag && git push && git push --tags` if you need to cut a release outside CI.

> Requires a PAT that can bypass branch protection on `main`:
>
> 1. Create a classic PAT (https://github.com/settings/tokens) with `repo` scope
>    as pauloedspinho20, or a fine-grained PAT with Contents:write on this repo.
> 2. Add it as repo secret `RELEASE_PAT` (Settings → Secrets → Actions → New secret).
> 3. Ruleset protect-main-dev already has Bypass → pauloedspinho20 → Always,
>    so pushes authenticated as you bypass the PR requirement.
>    If RELEASE_PAT is missing the workflow falls back to GITHUB_TOKEN and the
>    push will be rejected by branch protection (intentional — add the secret).

## Releasing (plugin builds) — same flow, heavier matrix

The plugin reuses the same `VERSION` + tag flow as desktop, but its matrix is
nine artifacts (VST3/CLAP/AU × 3 OS, macOS universal `arm64;x86_64`) and
macOS **must** be signed/notarized or Gatekeeper blocks the install.

See `.github/workflows/plugin.yml` (and `release.yml` for desktop):

1. `VERSION` → tag `v*` flow is identical (auto-release, or manual `vX.Y.Z`).
2. Pushing the `v*` tag triggers `plugin.yml` on all three runners. It:
   - `pnpm build` the web UI (for the webview), configures `packages/vst3`
     with `-DCMAKE_OSX_ARCHITECTURES="arm64;x86_64"` on macOS, builds all three
     bundles, runs `ctest` (smoke + `pluginval --strictness 10`/`auval`/`validator`/`clap-validator` — `SKIP` when tool/bundle absent), then
     `cpack` to `.pkg` (macOS `productbuild` → `/Library/Audio/Plug-Ins/*`), `.msi`/`ZIP` (Windows `WIX`), `.deb`+`.tar.gz` (Linux).
   - Attaches every installer/bundle as a public asset on the same GitHub
     Release that `release.yml` created for desktop — versioned from `VERSION`.
3. **Signing / notarization** runs only when the matching secrets are present;
   otherwise the workflow builds **unsigned** dev artifacts (same as `desktop.yml`):
   - **macOS:** `APPLE_DEVELOPER_ID_CERTIFICATE_P12` (base64 `.p12`), `APPLE_DEVELOPER_ID_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` — `codesign --options runtime --timestamp` + `xcrun notarytool submit --wait` + `xcrun stapler staple`.
   - **Windows:** `WINDOWS_CERTIFICATE_P12` (base64), `WINDOWS_CERTIFICATE_PASSWORD` — `signtool sign` / `AzureSignTool` (Authenticode).
   - **Linux:** no signing; `.deb` maintainer `OpenAxe <dev@openaxe.local>`.
     Add each as repo secret `Settings → Secrets → Actions`. If a secret is
     missing the corresponding step is skipped with a `::warning::` and the
     artifact is still uploaded unsigned — intentional for forks.

> **Cost note:** `plugin.yml` is the heaviest workflow in the repo. It is
> intentionally `workflow_dispatch` + `tags: v*` only (not `push`/`pull_request`)
> — see `AGENTS.md` (CI disabled repo-wide for cost). Confirm the cost
> tradeoff with the maintainer before enabling it on `push`.

## Commit / PR expectations

- Keep PRs scoped to one task from one epic where possible.
- Pre-commit hooks (Husky + lint-staged) will auto-fix lint/format issues on staged files.
- Reference the epic and/or task in your PR description.
