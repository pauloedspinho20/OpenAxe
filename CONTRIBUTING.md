# Contributing to OpenAxe

Thanks for your interest in contributing! This project is free and open source (GPLv3), and
contributions of all sizes are welcome.

> **New here?** Start with [`README.md`](./README.md#development) for setup + task catalog and [`AGENTS.md`](./AGENTS.md) for verification/drift guards. This file adds branching, DCO, and release details.

## Before you start

- Check the [open issues](https://github.com/pauloedspinho20/NAM-Web-Studio/issues) — work is
  organized into epics (labeled `epic`), each with a task checklist. Comment on an epic or a
  specific task before starting significant work, so effort isn't duplicated. Filter by [`good first issue`](https://github.com/pauloedspinho20/NAM-Web-Studio/labels/good%20first%20issue) for starter tasks.
- If you want to add a new effect or DSP component, read the licensing note below first —
  it affects which upstream source you're allowed to port from.
- Read [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) and [`SECURITY.md`](./SECURITY.md).

## Licensing rules for contributed code

This project ships under **GPLv3**. That means:

- Code you write yourself, or MIT/BSD/public-domain sources (e.g. Tuna.js, Airwindows, Freeverb),
  can always be included.
- GPLv2/v3-licensed sources (e.g. Dragonfly Reverb, ChowDSP, Guitarix/Rakarrack) can be ported in,
  but you must note the original project, license, and version in a comment near the port and in
  the PR description. Also add it to [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md). Verify the _specific module_ you're borrowing from is actually GPL (some of
  these projects mix licenses per file).
- Do not add dependencies with more restrictive or incompatible licenses (e.g. proprietary,
  source-available-but-non-free) without raising it in an issue first.

## Development setup

This is a pnpm + Turborepo monorepo. `apps/web` is the live product, `packages/ui` the design system, `apps/desktop` the native shell (C++ + webview.h + JUCE), `packages/vst3` the plugin (iPlug2), `packages/core` the shared C++ engine. `apps/ios`/`apps/android` are scaffolding (#17). See [`README.md`](./README.md#project-structure) for the full layout.

**One-command setup (idempotent — repairs wrong-arch binaries):**

```bash
node scripts/setup.mjs              # submodules + pnpm install + CMake configure (core + desktop)
node scripts/setup.mjs --web-only   # web-only, no C++ toolchain needed
pnpm dev                            # Vite dev server (apps/web)
pnpm dev:desktop                     # desktop native shell (debug + bundled UI)
pnpm dev:all                        # both, parallel
```

**Manual steps (if not using `setup.mjs`):**

```bash
pnpm install
# C++ submodules (selective, fast — not full --recursive):
git submodule update --init --recursive -- packages/core/third_party/nam-core
git -C packages/core/third_party/dragonfly-reverb submodule update --init --depth 1 -- dpf
# Optional Emscripten: bash scripts/build-core-wasm.sh (needs emsdk on PATH)
```

**Requirements:** Node 22 + pnpm 10.16.1 (`corepack enable`, `.nvmrc` pins 22), CMake 3.22+ C++20 (Clang/GCC/MSVC), Git. Linux desktop/plugin: `libwebkit2gtk-4.1-dev libgtk-3-dev libasound2-dev libpulse-dev`. Playwright: `pnpm --filter @openaxe/web exec playwright install --with-deps chromium firefox webkit` (once).

> `.npmrc` `strict-peer-dependencies=true` — a genuinely unmet peer fails `pnpm install` outright. If install fails on a peer you didn't touch, check `pnpm-lock.yaml`'s pin and prefer a `pnpm.overrides` pin (see root `package.json` `valibot`) over loosening the strict setting. Rosetta `darwin-x64` pnpm installs wrong-arch `rolldown`/`lightningcss`/`oxlint` — fix with `node scripts/setup.mjs`.

**Useful scripts** (run at repo root; Turborepo fans out):

- `pnpm lint` — oxlint
- `pnpm format` / `pnpm format:check` — Prettier
- `pnpm test` / `pnpm test:run` — Vitest (watch / single run)
- `pnpm test:e2e` — Playwright e2e (real `AudioContext` — needs browsers installed, see above)
- `pnpm build` — typecheck + production build (web + `packages/ui`; desktop is `pnpm build:desktop` / `build:all`)
- `pnpm dev:desktop` / `pnpm dev:all` — native desktop app / web + desktop side by side (see [`README.md`](./README.md#development))
- `pnpm storybook` / `pnpm build-storybook` — Storybook dev server / static build (`packages/ui`)
- Drift guards: `node scripts/gen-param-schema.mjs --check` (add `--target=automation-map` for plugin), `node scripts/check-grid-dims.mjs --check`, `node scripts/check-wasm-exports.mjs --check`, `node scripts/sync-version.mjs --check`, `node packages/ui/scripts/generate-tokens.mjs --check`

All checks must pass before merge — CI runs them on every push/PR to `main`/`dev` (see [`AGENTS.md`](./AGENTS.md#verification-commands) + `README.md#Verification`).

**VS Code:** Use `Terminal → Run Task` (`⇧⌘B`) — 46 tasks mirror every command above (`Setup: everything`, `Web: Dev server`, `C++: Configure/Build/Test`, `Desktop: …`, `VST: …`, drift/WASM tasks). See [`README.md`](./README.md#development) and [`.vscode/tasks.json`](./.vscode/tasks.json).

## Branching

- **Feature branches** → `dev` via **squash** (one commit per feature, Conventional Commits `feat:`/`fix:`/`feat!:`).
- **`dev` → `main`** via **merge commit** (`--no-ff`) — not squash. This preserves ancestry so the next `dev→main` doesn't conflict on `added in both` files (e.g. `plugin.yml`, `CMakeLists.txt`) and keeps `git merge-base` advancing. See `README.md#Branching`.
- Branch protection on `main`/`dev` requires PR + required CI checks; `deleteBranchOnMerge` enabled.
- Use `.gitattributes` for generated/lockfile merge strategy.

## DCO — Developer Certificate of Origin

This project uses the [DCO](https://developercertificate.org/) (not a CLA). Every commit must have a `Signed-off-by` trailer:

```bash
git commit -s -m "feat(web): ..."
# adds: Signed-off-by: Your Name <you@example.com>
```

The [DCO App](https://github.com/apps/dco) checks PRs. By signing off you certify the [DCO 1.1](https://developercertificate.org/):

> You have the right to submit the contribution under the project's license and agree to the DCO.

## Releasing (desktop + plugin) — fully automatic

> **If you are not a maintainer you can ignore this section** — releases are cut from `main` only. Forks build unsigned dev artifacts (same DSP, no signing secrets) — see note below.

The root `VERSION` file is the one source of truth — every `package.json`'s `"version"` and both `apps/desktop`/`packages/core` CMake `project()` versions are kept in sync with it (checked by `node scripts/sync-version.mjs --check` in CI and via pre-commit).

Releases are **fully automatic — no manual bump or tag**. Merging to `main` is the only trigger:

1. Open PRs against `dev` (feature work), then `dev` → `main` (merge commit) when ready to release. Use
   Conventional Commits (`feat:`, `fix:`, `feat!:`/`BREAKING CHANGE:` etc.) — they drive the bump.
2. Merging the `dev` → `main` PR fires `.github/workflows/auto-release.yml`, which:
   - reads conventional commits since the last `v*` tag (`scripts/auto-bump.mjs`),
   - decides `patch` (`fix:`/`chore:`), `minor` (`feat:`), or `major` (`BREAKING CHANGE` / `!` — with `0.y.z` mapping breaking → minor until `1.0.0`),
   - bumps `VERSION`, runs `node scripts/sync-version.mjs`, prepends `CHANGELOG.md`,
   - commits `chore(release): X.Y.Z` (with `[skip ci]` only if needed), creates annotated tag `vX.Y.Z` and pushes both.
3. Pushing the `v*` tag triggers `.github/workflows/release.yml` (desktop: 3-OS `dmg`/`zip`/`deb` via `desktop.yml` matrix) and `.github/workflows/plugin.yml` (plugin: 9 artifacts VST3/CLAP/AU × 3 OS) which publish installers as public assets on a GitHub Release for that tag — see [CHANGELOG.md](./CHANGELOG.md).

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

### Releasing — plugin specifics

The plugin reuses the same `VERSION` → tag flow as desktop, but its matrix is
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
   - On PRs (path-filtered to `packages/vst3/**` etc.), `plugin.yml` builds/tests only (no signing/packaging) to keep cost low.
3. **Signing / notarization** runs only when the matching secrets are present;
   otherwise the workflow builds **unsigned** dev artifacts (same as `desktop.yml`):
   - **macOS:** `APPLE_DEVELOPER_ID_CERTIFICATE_P12` (base64 `.p12`), `APPLE_DEVELOPER_ID_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` — `codesign --options runtime --timestamp` + `xcrun notarytool submit --wait` + `xcrun stapler staple`.
   - **Windows:** `WINDOWS_CERTIFICATE_P12` (base64), `WINDOWS_CERTIFICATE_PASSWORD` — `signtool sign` / `AzureSignTool` (Authenticode).
   - **Linux:** no signing; `.deb` maintainer `OpenAxe <dev@openaxe.local>`.
     Add each as repo secret `Settings → Secrets → Actions`. If a secret is
     missing the corresponding step is skipped with a `::warning::` and the
     artifact is still uploaded unsigned — intentional for forks (you get the same DSP build, just not signed).

> **Cost:** `plugin.yml` is the heaviest workflow (9 artifacts + signing). Tag pushes always run it; PRs only on plugin/core path. Confirm before broadening triggers.

### Forks / unsigned builds

If you fork the repo, `release.yml`/`plugin.yml` will still run on your `v*` tags but without signing secrets they produce **unsigned** installers/bundles + `::warning::` — intentionally. For local testing use `pnpm package:desktop` or `VST: Build` + `VST: Install bundle (macOS)` tasks.

## Commit / PR expectations

- Keep PRs scoped to one task from one epic where possible.
- Use Conventional Commits — they drive versioning (`feat:` → minor, `fix:` → patch, `BREAKING CHANGE` → major).
- Sign off commits: `git commit -s`.
- Pre-commit hooks (Husky + lint-staged) will auto-fix lint/format issues on staged files and check `sync-version`/`generate-tokens` drift where applicable.
- Reference the epic and/or task in your PR description (`Fixes #...`). The PR template checklist covers the verification steps — fill it.
