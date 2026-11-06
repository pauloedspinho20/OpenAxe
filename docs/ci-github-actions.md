# CI/CD runbook — GitHub Actions

Everything — tests, native builds, releases — runs on GitHub-hosted runners.
This replaces the self-hosted Woodpecker setup from issues #427/#441.

## Why the split went away

#427 moved the heavy jobs onto a local Woodpecker because Actions minutes were
billed on a **private** repo and macOS runners bill at **×10**. On a **public**
repo, standard GitHub-hosted runners are free and unmetered on Linux, Windows
_and_ macOS, so the saving disappeared — while the costs of the split stayed:

- Releases could only be cut while a Mac, three agents and a smee forwarder
  were running.
- CI ran `pull_request` on the Local backend — no container — so once the repo
  was public, a fork PR would have been arbitrary code execution on a personal
  machine.
- Two pipeline definitions had to be kept in step by hand.

## Workflows

| File               | Trigger                                                | What it does                                                                                                            |
| ------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`           | push + PR to `main`/`dev`                              | Drift guards, lint, format, typecheck, build, unit, e2e, and the `packages/core` C++ suite. **This is the merge gate.** |
| `desktop.yml`      | push + PR touching desktop/web/core/ui                 | Builds the native shell on all three OSes. PRs build+link; pushes also package and upload.                              |
| `plugin.yml`       | push + PR touching `packages/vst3`/core, and `v*` tags | VST3 / CLAP / AU across three OSes, plus validators.                                                                    |
| `release.yml`      | `v*` tag, or `workflow_dispatch`                       | The release path — see below.                                                                                           |
| `auto-release.yml` | push to `main`                                         | Bumps `VERSION`, writes `CHANGELOG`, commits `chore(release): X.Y.Z`, tags `vX.Y.Z`, back-merges `main` into `dev`.     |
| `pages.yml`        | `apps/landing` changes                                 | Landing preview build.                                                                                                  |
| `stale.yml`        | weekly                                                 | Marks inactive issues/PRs.                                                                                              |

Every workflow runs the **full 3-OS matrix** on every event. The `full-ci`
label, the Linux-only PR legs and the weekly backstop were all artefacts of
billed minutes and are gone; a PR now gets real macOS and Windows compile
coverage instead of a Linux approximation of it.

## The release path

```
dev -> main
  |- auto-release.yml : bump VERSION + CHANGELOG -> commit -> tag vX.Y.Z -> back-merge to dev
       |- release.yml (on the tag)
            |- guard    : tag == VERSION, or stop
            |- build x3 : macos-14 / windows-latest / ubuntu-24.04
            |             desktop package -> plugin bundles -> upload to R2
            |- publish  : poll R2 -> sha256sums.txt + manifest.json
            |             -> mirror the artifacts onto the GitHub Release
            |- landing  : build against the R2 manifest -> Cloudflare Pages
```

**R2 stays the source of truth.** `apps/landing`'s `fetch-releases.mjs
--source=r2` reads the root `manifest.json`, and the in-app update check reads
the landing's `releases-data.json`. The GitHub Release is a convenience mirror
— on a public repo the Releases tab is where people look for downloads — but
nothing reads it programmatically.

All the real work lives in plain Node under `scripts/`, which is why the
pipelines were portable in the first place:

| Script                               | Role                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `scripts/ci-local.mjs`               | The shared build driver (`--stage=setup`, `core`, `desktop`, `plugin`, …). |
| `scripts/collect-plugin-bundles.mjs` | Zips VST3/AU/CLAP per platform.                                            |
| `scripts/r2-upload.mjs`              | Uploads artifacts to `r2://openaxe-releases/<tag>/` via rclone.            |
| `scripts/r2-publish.mjs`             | Polls R2, writes `sha256sums.txt` + `manifest.json`.                       |
| `scripts/release-local.sh`           | Runs the same stages on your own machine (see below).                      |

### Per-platform notes

- **Windows** now builds **x64** on a hosted runner. The old UTM agent produced
  **ARM64**, which was a consequence of the host Mac rather than a target
  choice — x64 is what nearly every Windows user needs.
- **Linux** builds the plugin headless (no IGraphics backend, SDKs not
  fetched), so it produces no GUI bundles. The `.deb` is the Linux artifact;
  `collect-plugin-bundles.mjs --allow-empty` keeps that from failing the release.
- **macOS** builds VST3 + AU + CLAP. AU and CLAP are `EXCLUDE_FROM_ALL`, so the
  workflow builds those targets explicitly.

### Required secrets

Set under **Settings → Secrets and variables → Actions**:

| Secret                 | Used by                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `R2_ACCESS_KEY`        | `release.yml` build + publish                                                          |
| `R2_SECRET_KEY`        | `release.yml` build + publish                                                          |
| `R2_ACCOUNT_ID`        | `release.yml` build + publish, and as the Cloudflare account id for the landing deploy |
| `CLOUDFLARE_API_TOKEN` | `release.yml` landing deploy (Account → Cloudflare Pages → Edit)                       |
| `RELEASE_PAT`          | `auto-release.yml` — pushes the release commit and tag past branch protection          |

`R2_PUBLIC_URL` is **not** a secret; it is the public download host and lives in
the workflow's `env:`.

Signing secrets (`APPLE_*`, `WINDOWS_CERTIFICATE_*`, `KEYCHAIN_PASSWORD`) are
optional — every signing step is guarded on the secret being non-empty and the
build falls back to **unsigned** artifacts, which is what forks get. Note that
unsigned macOS builds are Gatekeeper-blocked on install; signing was not wired
into the old Woodpecker release legs either, so this is a pre-existing gap
rather than a regression.

## Running a release by hand

`scripts/release-local.sh` runs the same stages on your own machine — useful
when Actions is degraded, or to reproduce a failing leg:

```bash
bash scripts/release-local.sh release   # build -> R2 -> sha256sums + manifest -> landing
bash scripts/release-local.sh landing   # landing build + deploy only
bash scripts/release-local.sh ci        # full local CI: mac native + linux Docker
```

Credentials come from the environment, or from a **gitignored `.env` at the
repo root** holding the same values as the Actions secrets:

```
R2_ACCESS_KEY=
R2_SECRET_KEY=
R2_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
```

Needs `rclone` on `PATH` (`brew install rclone`, `apt install rclone`,
`choco install rclone`).

## Reproducing the Linux leg locally

`pnpm ci:local:linux` runs `scripts/ci-local.mjs` inside the `ubuntu-24.04`
image in `docker/ci-linux/`, mirroring the Linux legs of `ci.yml`,
`desktop.yml` and `plugin.yml`. ccache and Playwright browsers persist in named
volumes across runs.

## Fork pull requests

- Fork PRs **never** receive repository secrets — GitHub withholds them from
  `pull_request` runs. Signing and R2 steps degrade to no-ops or unsigned builds.
- **Settings → Actions → General → Fork pull request workflows from outside
  collaborators** should be **"Require approval for all outside collaborators"**.
  The default gates only _first-time_ contributors.
- **Workflow permissions** should default to read-only; `release.yml` requests
  `contents: write` on just the one job that needs it.
