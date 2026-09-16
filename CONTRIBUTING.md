# Contributing to OpenAxe

Thanks for your interest in contributing! This project is free and open source (GPLv3), and
contributions of all sizes are welcome.

> **New here?** Start with [`README.md`](./README.md#development) for setup + task catalog and [`AGENTS.md`](./AGENTS.md) for verification/drift guards. This file adds branching, DCO, and release details.

## Before you start

- Check the [open issues](https://github.com/pauloedspinho20/OpenAxe/issues) — work is
  organized into epics (labeled `epic`), each with a task checklist. Comment on an epic or a
  specific task before starting significant work, so effort isn't duplicated. Filter by [`good first issue`](https://github.com/pauloedspinho20/OpenAxe/labels/good%20first%20issue) for starter tasks.
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

This is a pnpm + Turborepo monorepo. `apps/web` is the live product, `packages/ui` the design system, `apps/desktop` the native shell (C++ + webview.h + miniaudio), `packages/vst3` the plugin (iPlug2), `packages/core` the shared C++ engine. `apps/ios`/`apps/android` are scaffolding (#17). See [`README.md`](./README.md#project-structure) for the full layout.

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
git submodule update --init -- packages/core/third_party/dspark packages/core/third_party/daisysp
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

## Changing how an effect sounds

`packages/core`'s DSP is guarded by a golden-audio regression harness
(`packages/core/tests/dsp_regression_test.cpp`, issue #315). It renders five
deterministic stimuli through every compiled effect and compares a fingerprint
of each output — levels, onsets, L/R correlation, and a ten-band spectral shape
— against `packages/core/tests/golden/dsp_metrics.json`.

If your change alters an effect's output, that test fails and names the effect,
the stimulus, the metric, and both values:

```
delay/analog / impulse / band 1280Hz: golden 2.33 dB, got 3.01 dB
delay/ping-pong / impulse / onsetR: golden 4800 samples, got -1 samples
```

**If the change was not intended**, that is a regression — fix it.

**If it was intended**, re-bless the references and explain the diff:

```bash
cmake --build packages/core/build --target dsp_regression_test && ./packages/core/build/tests/dsp_regression_test --bless
```

Then commit the updated `dsp_metrics.json` **with the reason in your PR
description**. The diff is the evidence the change was deliberate, so a bless
with no explanation will be sent back. Adding a new effect or preset case also
needs a bless run — a case with no reference fails rather than passing quietly.

The fingerprint is metrics rather than raw audio on purpose: float results are
not bit-identical across the platforms CI runs, and a metric diff is reviewable
where a binary diff is not. See `packages/core/tests/dsp_metrics.h` for the
reasoning, and `dsp_regression_test.cpp` for the tolerances — band tolerance is
level-dependent, because a band 45 dB below the signal's own energy is a few
least-significant bits and drifts between toolchains, while the bands that
carry real energy stay tight.

## Branching

- **All feature branches → `dev`** (including Dependabot — `target-branch: dev` in `.github/dependabot.yml`). Open every pull request with base `dev` and merge via **squash** (one commit per feature, Conventional Commits `feat:`/`fix:`/`feat!:`).
- **`dev` → `main`** is the **only** PR that targets `main` (the release promotion). Merge it with a **merge commit**, not a squash, so `main` keeps `dev`'s ancestry. This relies on **Settings → General → Pull Requests → Allow merge commits** staying enabled — ancestry is what lets `auto-bump.mjs` see the real `feat:`/`fix:` commits (correct semver) and keeps the next promotion clean.
- **Bump, tag and back-merge are automatic** (`#Releasing` below). The push to `main` runs the local Woodpecker pipeline `.woodpecker/release-bump.yml` (`scripts/release-bump.sh`), which commits `chore(release): X.Y.Z` and then merges that release commit back into `dev` as `chore(sync): merge main vX.Y.Z back into dev` (issue #304). The back-merge keeps `dev` on the released `VERSION`, so branches cut from it are not born stale. It stays conflict-free while the two trees differ only by the bump; when it does conflict the pipeline fails loudly — do **not** silence it. Resolve by hand:
  ```bash
  git checkout dev && git merge --no-ff origin/main && git push origin dev
  ```
- **Hotfixes** branch from `main` (`hotfix/x.y.z`), PR back into `main`, get bumped/tagged by the same workflow, then merge `main → dev` so `dev` carries the fix.
- Branch protection on `main`/`dev` requires PR + required checks (Woodpecker, see `#Releasing`); `deleteBranchOnMerge` enabled.
- Use `.gitattributes` for generated/lockfile merge strategy.

## DCO — Developer Certificate of Origin

This project uses the [DCO](https://developercertificate.org/) (not a CLA). Every commit must have a `Signed-off-by` trailer:

```bash
git commit -s -m "feat(web): ..."
# adds: Signed-off-by: Your Name <you@example.com>
```

The [DCO App](https://github.com/apps/dco) checks PRs. By signing off you certify the [DCO 1.1](https://developercertificate.org/):

> You have the right to submit the contribution under the project's license and agree to the DCO.

## Releasing (desktop + plugin)

> **If you are not a maintainer you can ignore this section** — releases are cut from `main` only. Forks build unsigned dev artifacts (same DSP, no signing secrets) — see the note below.

The root `VERSION` file is the one source of truth — every `package.json`'s `"version"` and both `apps/desktop`/`packages/core` CMake `project()` versions are kept in sync with it (checked by `node scripts/sync-version.mjs --check` in CI and via pre-commit).

CI/CD runs entirely on the **self-hosted Woodpecker** (`.woodpecker/*.yml`, `docs/ci-woodpecker.md`, issues #427/#441) — versioning included, so a version is never minted unless the machine that builds it is up. GitHub Actions is no longer used for releases.

| Concern                                                                                | Runs on                                                             |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Version bump, `CHANGELOG`, release commit + tag `vX.Y.Z`, `main → dev` back-merge      | **Woodpecker** — `.woodpecker/release-bump.yml`                     |
| Tests (drift / lint / unit / e2e / core / desktop / plugin)                            | **Woodpecker** — `.woodpecker/ci-{mac,linux,win}.yml`               |
| Release builds → Cloudflare R2 + `sha256sums.txt` + `manifest.json` + landing redeploy | **Woodpecker** — `.woodpecker/release-*.yml`, `release-publish.yml` |
| Web app (`openaxe.pages.dev`)                                                          | Cloudflare Git integration, on merge to `main`                      |

Release flow:

1. Open PRs against `dev` (feature work), then `dev` → `main` when ready to release. Use Conventional Commits (`feat:`, `fix:`, `feat!:`/`BREAKING CHANGE:` etc.) — they drive the bump.
2. Merging the `dev` → `main` PR fires the local `.woodpecker/release-bump.yml` pipeline, which:
   - reads conventional commits since the last `v*` tag (`scripts/auto-bump.mjs`),
   - decides `patch` (`fix:`/`chore:`), `minor` (`feat:`), or `major` (`BREAKING CHANGE` / `!` — with `0.y.z` mapping breaking → minor until `1.0.0`),
   - bumps `VERSION`, runs `node scripts/sync-version.mjs`, prepends `CHANGELOG.md`,
   - commits `chore(release): X.Y.Z`, creates annotated tag `vX.Y.Z` and pushes both,
   - merges `main` back into `dev` (`chore(sync): …`) so `dev` carries the released `VERSION` — see `#Branching`. A conflict there fails the job loudly rather than leaving the drift in place.
3. Pushing the `v*` tag triggers the Woodpecker release pipelines: `.woodpecker/release-{mac,linux,win}.yml` (guard `tag == VERSION` → desktop `dmg`/`zip`/`deb` + plugin bundles → **R2**) and `.woodpecker/release-publish.yml` (polls R2 → `sha256sums.txt` + root `manifest.json` → rebuilds the landing `--source=r2` → deploys it to Cloudflare Pages `openaxe-site`).
4. Verify the R2 folder and the landing releases page — the web app's update check reads the landing's `releases-data.json`.

**Woodpecker is self-hosted and local-only**, so a release only happens while its server + mac/linux agents (and the smee forwarder that delivers GitHub's webhooks) are running. That is deliberate now: if the stack is down when `main` is pushed, **no version is minted** — there is no orphan tag to clean up. Once the stack is back, replay the missed run:

- **Bump / tag / back-merge:** Woodpecker UI → run the `release-bump` pipeline on `main`, or locally `github_token=<PAT> bash scripts/release-bump.sh`.
- **Build / publish** (when the tag exists): `bash scripts/woodpecker-manual.sh release` — VS Code task **Release: publish (build → R2 → landing)**.

> The `release` run also builds and deploys the landing (`openaxe-site`), which needs a Cloudflare API token (`Account → Cloudflare Pages → Edit`) as `CLOUDFLARE_API_TOKEN` in the environment or `woodpecker/.env` (the Woodpecker pipeline uses the `pages_api_token` secret instead). Without the token the landing is built but not deployed — run `bash scripts/woodpecker-manual.sh landing` once you have it.

Preview the next version locally with `node scripts/auto-bump.mjs --dry-run` — the bump is driven by the Conventional Commit types that landed on `main`.

> The local `release-bump` pipeline needs a PAT that can bypass branch protection on `main`/`dev` (it pushes the release commit, the tag, and the back-merge):
>
> 1. Create a classic PAT (https://github.com/settings/tokens) with `repo` scope
>    as pauloedspinho20, or a fine-grained PAT with Contents:write on this repo.
> 2. Add it as a **Woodpecker** repo secret named `github_token`
>    (Woodpecker UI → repo Settings → Secrets). It is no longer a GitHub Actions secret.
> 3. Ruleset protect-main-dev already has Bypass → pauloedspinho20 → Always,
>    so pushes authenticated as you bypass the PR requirement.

### Releasing — plugin specifics

The plugin rides the same `VERSION` → tag flow as desktop, but its matrix is nine artifacts (VST3/CLAP/AU × 3 OS, macOS universal `arm64;x86_64`) and macOS **must** be signed/notarized or Gatekeeper blocks the install.

See `.woodpecker/release-{mac,linux,win}.yml`:

1. The tag push (`v*`) is the trigger, after the `tag == VERSION` guard.
2. The `plugin` step runs `node scripts/ci-local.mjs --stage=plugin --skip-setup --with-sdks` (fetches the iPlug2 VST3/CLAP SDKs on a fresh agent), builds the `EXCLUDE_FROM_ALL` AU/CLAP targets, then `scripts/collect-plugin-bundles.mjs` zips them per platform:
   - **macOS:** VST3 + AU + CLAP; **Windows:** VST3 + CLAP; **Linux:** headless (no IGraphics backend), so no GUI bundles — `--allow-empty`, and the `.deb` is the Linux artifact.
3. `scripts/r2-upload.mjs` uploads the zip alongside the desktop installer to `r2://openaxe-releases/<tag>/`, and `release-publish.yml` writes `sha256sums.txt` + `manifest.json`.
4. Tests (`ctest`, plus `pluginval --strictness 10` / `auval` / VST3 validator / `clap-validator`, which SKIP when the tool/bundle is absent) run as part of the same plugin stage.

**Signing / notarization** runs only when the matching secrets are present; otherwise the pipeline builds **unsigned** dev artifacts (intentional for forks):

- **macOS:** `APPLE_DEVELOPER_ID_CERTIFICATE_P12` (base64 `.p12`), `APPLE_DEVELOPER_ID_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` — `codesign --options runtime --timestamp` + `xcrun notarytool submit --wait` + `xcrun stapler staple`.
- **Windows:** `WINDOWS_CERTIFICATE_P12` (base64), `WINDOWS_CERTIFICATE_PASSWORD` — `signtool sign` / `AzureSignTool` (Authenticode).
- **Linux:** no signing; `.deb` maintainer `OpenAxe <dev@openaxe.local>`.

### Forks / unsigned builds

If you fork the repo, the Woodpecker release pipelines run without the signing secrets and produce **unsigned** installers/bundles — intentionally (same DSP build, just not signed). For local testing use `pnpm package:desktop`, the `VST: Build` + `VST: Install bundle (macOS)` tasks, or `bash scripts/woodpecker-manual.sh release` (needs `rclone` plus R2 creds in `woodpecker/.env`).

## Commit / PR expectations

- Keep PRs scoped to one task from one epic where possible.
- Use Conventional Commits — they drive versioning (`feat:` → minor, `fix:` → patch, `BREAKING CHANGE` → major).
- Sign off commits: `git commit -s`.
- Pre-commit hooks (Husky + lint-staged) will auto-fix lint/format issues on staged files and check `sync-version`/`generate-tokens` drift where applicable.
- Reference the epic and/or task in your PR description (`Fixes #...`). The PR template checklist covers the verification steps — fill it.
