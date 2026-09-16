# Woodpecker CI runbook (issue #427)

Self-hosted CI on the local Mac. Code stays on GitHub (private); GitHub
Actions heavy legs get retired once this is proven (Phase 5).

## Modes

- **Manual / off-webhook (easiest):** `scripts/woodpecker-manual.sh` runs the
  exact stages the pipelines perform — no server, agents or webhook needed.
  `ci` = full mac+linux CI (`pnpm ci:local` + `ci:local:linux`); `release` =
  desktop dmg+deb + plugin bundles → R2 → sha256sums + manifest → landing
  build/deploy; `landing` = the landing step alone; `all` = both (`R2_*` creds
  from env or `woodpecker/.env`, same values as the UI secrets; the landing
  deploy also needs `CLOUDFLARE_API_TOKEN`). Wired as **VSCode tasks**:
  "Woodpecker: run CI manually (mac + linux)", "Woodpecker: release artifacts
  to R2 (mac + linux)", "Woodpecker: full manual run (CI + release to R2 +
  landing)", "Release: deploy landing to Cloudflare Pages".
- **Local-only server (current):** server at `http://localhost:8000`, no public URL.
  Repo activation REQUIRES a public _webhook_ URL (GitHub rejects
  `localhost`, so plain `Enable` fails with `could not create webhook in
forge`). Free workaround: a [smee.io](https://smee.io/new) channel as
  `WOODPECKER_EXPERT_WEBHOOK_HOST` (see `.env.example`) — activation then
  succeeds, and with a forwarder running (`npx smee-client --url
https://smee.io/<id> --target http://localhost:8000/api/hook`) even
  push-triggered builds work without a domain. Without the forwarder,
  builds trigger **manually in the UI**. Repo sync + commit statuses work
  either way (outbound HTTPS from the server).
- **Tunnel (later):** Cloudflare Tunnel + public hostname → webhook
  auto-builds on push/PR. Needs a domain; deferred with Windows pending.

## Layout

| Path                                                        | What                                                                                                                               |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `.woodpecker/ci-mac.yml`                                    | macOS agent, Local backend — full `ci-local.mjs` incl. e2e                                                                         |
| `.woodpecker/ci-linux.yml`                                  | Docker agent, `openaxe-ci-linux` image — no e2e (browsers install at run time, see `docker/ci-linux/run-linux-ci.sh`)              |
| `.woodpecker/ci-win.yml`                                    | UTM Win11 ARM agent, Local backend — provisional subset (JS stages + core); desktop/plugin join when green                         |
| `.woodpecker/release-bump.yml`                              | push to `main` → `scripts/release-bump.sh`: bump + `CHANGELOG` + commit + tag + back-merge into `dev` (needs `github_token`)       |
| `.woodpecker/release-{mac,linux,win}.yml`                   | tag guard → setup → desktop CPack → plugin bundles → `r2-upload.mjs` (mac zip = VST3 + AU + CLAP; win = VST3 + CLAP)               |
| `.woodpecker/release-publish.yml`                           | polls R2 (`--expect=macos,linux`; +windows when UTM live) → sha256sums + manifest → landing rebuild (`--source=r2`) → Pages deploy |
| `scripts/{r2-upload,r2-publish,collect-plugin-bundles}.mjs` | release tooling; `fetch-releases.mjs --source=r2` reads the R2 manifest                                                            |
| `woodpecker/docker-compose.yml`                             | server (SQLite volume `woodpecker-data`)                                                                                           |
| `woodpecker/agent-{mac,linux,win}.*`                        | the three agents                                                                                                                   |

The release `plugin` step runs `ci-local.mjs --stage=plugin --skip-setup --with-sdks`.
On an agent that has never built a plugin that fetches iPlug2's VST3/CLAP SDKs
(idempotent, only when the sentinel header is missing) before configuring, then
builds the two `EXCLUDE_FROM_ALL` targets (`openaxe_au`, `openaxe_clap`) so
`collect-plugin-bundles.mjs` packs VST3 + AU + CLAP into one zip.

## Official release flow (issue #441)

Everything runs here, versioning included, so the version and the artifacts
that ship it are produced by the same machine:

| Concern                                                                                | Where                                                            |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Bump `VERSION` + `CHANGELOG`, commit `chore(release): X.Y.Z`, tag `vX.Y.Z`, back-merge | Woodpecker — `.woodpecker/release-bump.yml`                      |
| Tests + release builds (desktop/plugin) → R2 + `sha256sums.txt` + `manifest.json`      | Woodpecker — `.woodpecker/release-*.yml` + `release-publish.yml` |

Flow: PR `dev → main` (merge commit) → `release-bump.yml` bumps/tags/back-merges →
tag `v*` → the per-OS `release-*.yml` legs (guard `tag == VERSION`) → R2 →
`release-publish.yml` → manifest + landing deploy on Cloudflare Pages.

### Keeping it seamless

Woodpecker is **local-only**, so nothing happens unless the whole stack is up:
the server (`docker compose up -d`), the macOS + Linux agents
(`woodpecker/agent-mac.sh`, `woodpecker/agent-linux.sh`) and the smee forwarder
(so GitHub's webhooks reach the server). That is deliberate — if the stack is
down when `main` is pushed, **no version is minted**, so there is no orphan tag
to clean up. Keep the stack running (ideally auto-started as services) for
hands-off releases.

Recovery once the stack is back:

- **Replay from the UI:** every pipeline (including `release-bump`) declares
  `manual` — open the project, pick the `main` branch (**Run pipeline**) to mint
  a missed version, then the `vX.Y.Z` tag for `release-{mac,linux}` +
  `release-publish`; or
- **Off-webhook bump:** `github_token=<PAT> bash scripts/release-bump.sh`; and
  **off-webhook publish:** `pnpm release:publish`
  (`scripts/woodpecker-manual.sh release`) — the VS Code task **Release:
  publish (build → R2 → landing)**.

> The landing deploy needs a Cloudflare API token with **Account → Cloudflare
> Pages → Edit**, supplied as `CLOUDFLARE_API_TOKEN` in the environment or
> `woodpecker/.env` (the Woodpecker pipeline uses the `pages_api_token` repo
> secret instead). Without it the manual script builds the landing but leaves
> it undeployed — run `bash scripts/woodpecker-manual.sh landing` afterwards to
> finish.

## First run

1. `cd woodpecker && cp .env.example .env` — fill `WOODPECKER_GITHUB_CLIENT/SECRET`
   (OAuth app, callback `http://localhost:8000/authorize`) and
   `WOODPECKER_AGENT_SECRET` (`openssl rand -hex 32`).
2. `docker compose up -d`, open `http://localhost:8000`, log in, activate the repo.
3. Start agents: `bash woodpecker/agent-mac.sh`, `bash woodpecker/agent-linux.sh`
   (Win: `woodpecker\agent-win.ps1` in the VM). Labels
   (`platform=darwin/arm64`, `linux/amd64`, `windows/arm64`) are passed by
   the scripts — no UI tagging needed; verify under Admin → Agents.
4. Woodpecker auto-runs `.woodpecker/*.yml` on push/PR to `dev`/`main`;
   in local-only mode use the UI's manual trigger.

## Secrets (UI → repo Settings → Secrets, never in git)

`r2_access_key`, `r2_secret_key`, `r2_account_id`, `pages_api_token`, and
`github_token` (a PAT with Contents:write + ruleset bypass, for the
`release-bump` push/tag/back-merge).

## Recovery

- Server data lives in the `woodpecker-data` Docker volume. Back up agent
  queue drain: stop agents first, then `docker compose stop server`.
- Full rebuild: `docker compose down -v` loses build history (repos re-sync
  on next start) — `.env` (OAuth + agent secret) is the only irreplaceable
  file; keep a copy off-machine.

## GitHub Actions status (Phase 5, done)

GitHub Actions is retired: `auto-release.yml` is **deleted** and the heavy
workflows (`ci.yml`, `desktop.yml`, `plugin.yml`, `release.yml`, `pages.yml`)
are **disabled** in repo settings, so no private-repo minutes are spent.
Woodpecker is the CI/release engine of record — see "Official release flow"
above, and `CONTRIBUTING.md#releasing-desktop--plugin`.
