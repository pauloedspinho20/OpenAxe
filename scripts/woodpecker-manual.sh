#!/usr/bin/env bash
# Manual Woodpecker CI + release-to-R2 runner (issue #427).
#
# Runs, on demand (from a VSCode task or a terminal), exactly the stages the
# .woodpecker/*.yml pipelines perform — no Woodpecker server, agents or GitHub
# webhooks needed. Useful when you want a full CI + release without waiting
# for a tag/webhook, or when the smee forwarder isn't running.
#
#   bash scripts/woodpecker-manual.sh ci       # full CI: mac (native) + linux (Docker)
#   bash scripts/woodpecker-manual.sh release  # guard → desktop+plugin artifacts (mac+linux) → R2 → sha256sums+manifest → landing deploy
#   bash scripts/woodpecker-manual.sh landing  # landing build (from R2) + deploy to Cloudflare Pages only
#   bash scripts/woodpecker-manual.sh all      # ci then release (default)
#
# Secrets: R2 creds come from the environment (R2_ACCESS_KEY, R2_SECRET_KEY,
# R2_ACCOUNT_ID, R2_PUBLIC_URL) or, if unset, from woodpecker/.env
# (gitignored) — same values the Woodpecker UI secrets hold. The landing deploy
# additionally needs CLOUDFLARE_API_TOKEN (Account → Cloudflare Pages → Edit;
# also accepted as `pages_api_token`) plus an account id (CLOUDFLARE_ACCOUNT_ID,
# falling back to R2_ACCOUNT_ID). Without the token the landing is built but
# not deployed. Nothing is written anywhere else; nothing is printed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
R2_PUBLIC_URL_DEFAULT="https://pub-800f414cbfe9422e9faaa00ed34d2821.r2.dev"
# Staging dir: the mac and linux legs share apps/desktop/build and
# packages/vst3/build, and each leg's setup clears them (cache-path
# mismatch). Copy each artifact out the moment it's produced so a later leg
# can't wipe it before upload.
STAGE="${STAGE_DIR:-$ROOT/dist-release}"

step() { printf '\n\033[1m— %s —\033[0m\n' "$*"; }

# --- R2 credentials -------------------------------------------------------
load_env() {
  local envfile="$ROOT/woodpecker/.env"
  [ -f "$envfile" ] || return 0
  local key value
  while IFS='=' read -r key value; do
    key="${key// /}"
    value="${value//\"/}"; value="${value//\'/}"; value="${value%$'\r'}"
    case "$key" in
      r2_access_key|R2_ACCESS_KEY)
        [ -n "${R2_ACCESS_KEY:-}" ] || export R2_ACCESS_KEY="$value" ;;
      r2_secret_key|R2_SECRET_KEY)
        [ -n "${R2_SECRET_KEY:-}" ] || export R2_SECRET_KEY="$value" ;;
      r2_account_id|R2_ACCOUNT_ID)
        [ -n "${R2_ACCOUNT_ID:-}" ] || export R2_ACCOUNT_ID="$value" ;;
      R2_PUBLIC_URL)
        [ -n "${R2_PUBLIC_URL:-}" ] || export R2_PUBLIC_URL="$value" ;;
      pages_api_token|CLOUDFLARE_API_TOKEN)
        [ -n "${CLOUDFLARE_API_TOKEN:-}" ] || export CLOUDFLARE_API_TOKEN="$value" ;;
      CLOUDFLARE_ACCOUNT_ID)
        [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] || export CLOUDFLARE_ACCOUNT_ID="$value" ;;
    esac
  done < "$envfile"
}

require_r2() {
  local missing=()
  [ -n "${R2_ACCESS_KEY:-}" ] || missing+=(R2_ACCESS_KEY)
  [ -n "${R2_SECRET_KEY:-}" ] || missing+=(R2_SECRET_KEY)
  [ -n "${R2_ACCOUNT_ID:-}" ] || missing+=(R2_ACCOUNT_ID)
  if [ "${#missing[@]}" -gt 0 ]; then
    echo "Missing R2 credentials: ${missing[*]} — set them in your env or add to woodpecker/.env (same as the UI secrets)." >&2
    exit 1
  fi
  export R2_PUBLIC_URL="${R2_PUBLIC_URL:-$R2_PUBLIC_URL_DEFAULT}"
}

tag() { echo "${CI_COMMIT_TAG:-v$(cat "$ROOT"/VERSION)}"; }

# --- CI -------------------------------------------------------------------
run_ci() {
  step "macOS CI (drift, lint, build, unit, e2e, core, desktop, plugin)"
  (cd "$ROOT" && pnpm ci:local)
  step "Linux CI (same stages in ubuntu-24.04 Docker)"
  (cd "$ROOT" && pnpm ci:local:linux)
}

# --- Release legs ----------------------------------------------------------
# Mirrors .woodpecker/release-mac.yml. The plugin stage needs the web build
# first (bundles copy apps/web/dist into the plugin UI at build time).
mac_release_leg() {
  local t="$1"
  step "macOS leg 1/3 — setup"
  (cd "$ROOT" && node scripts/ci-local.mjs --stage=setup)
  step "macOS leg 2/3 — web build + desktop package (dmg)"
  (cd "$ROOT" && pnpm build)
  (cd "$ROOT" && pnpm --filter @openaxe/desktop package)
  cp "$ROOT"/apps/desktop/build/openaxe-desktop-*.dmg "$STAGE"/ 2>/dev/null || true
  step "macOS leg 3/3 — plugin build + bundles"
  (cd "$ROOT" && node scripts/ci-local.mjs --stage=plugin --skip-setup --with-sdks)
  # AU and CLAP are EXCLUDE_FROM_ALL, so the default build only stages the
  # VST3 (and a plist-only AU stub) — build both explicitly for the real
  # .component/.clap bundles.
  (cd "$ROOT" && cmake --build packages/vst3/build --config Release --target openaxe_au openaxe_clap -j)
  (cd "$ROOT" && node scripts/collect-plugin-bundles.mjs --platform=macos --tag="$t")
  cp "$ROOT"/packages/vst3/build/openaxe-plugin-bundles-macos-*.zip "$STAGE"/ 2>/dev/null || true
}

# Same mounts as docker/ci-linux/run-linux-ci.sh; build dirs live under the
# repo bind mount, so artifacts (deb, linux bundles) land on the host.
linux_run() {
  local platform="${OPENAXE_CI_PLATFORM:-linux/amd64}"
  local image="${OPENAXE_CI_IMAGE:-openaxe-ci-linux}"
  # Image must match the run platform — rebuild when absent or wrong arch
  # (native arm64 builds silently break the amd64 runner otherwise).
  if docker image inspect "$image" >/dev/null 2>&1; then
    local arch
    arch="$(docker image inspect "$image" --format '{{.Architecture}}')"
    if [ "$arch" != "${platform#linux/}" ]; then
      step "Rebuilding $image (local arch $arch != platform $platform)"
      docker build --platform "$platform" -t "$image" "$ROOT/docker/ci-linux"
    fi
  else
    step "Building $image (first run only)"
    docker build --platform "$platform" -t "$image" "$ROOT/docker/ci-linux"
  fi
  # The seqlock stress test (vst3_monitor_tap) deadlocks under Rosetta
  # emulation — skip it when the host arch != the container arch.
  local skip_tap=0
  if [ "$(uname -m)" != "${platform#linux/}" ]; then skip_tap=1; fi
  docker run --rm --platform "$platform" \
    -v "$ROOT:/work" \
    -v openaxe-ci-ccache:/root/.cache/ccache \
    -v openaxe-ci-nm:/work/node_modules \
    -v openaxe-ci-nm-web:/work/apps/web/node_modules \
    -v openaxe-ci-nm-desktop:/work/apps/desktop/node_modules \
    -v openaxe-ci-nm-landing:/work/apps/landing/node_modules \
    -v openaxe-ci-nm-ui:/work/packages/ui/node_modules \
    -e CCACHE_DIR=/root/.cache/ccache \
    -e OPENAXE_CI_SKIP_MONITOR_TAP="$skip_tap" \
    "$image" bash -lc "$*"
}

linux_release_leg() {
  local t="$1"
  step "Linux leg 1/3 — setup (Docker)"
  linux_run "node scripts/ci-local.mjs --stage=setup"
  step "Linux leg 2/3 — web build + desktop package (deb)"
  linux_run "pnpm build"
  linux_run "pnpm --filter @openaxe/desktop package"
  cp "$ROOT"/apps/desktop/build/openaxe-desktop-*.deb "$STAGE"/ 2>/dev/null || true
  step "Linux leg 3/3 — plugin build + bundles"
  linux_run "node scripts/ci-local.mjs --stage=plugin --skip-setup"
  linux_run "node scripts/collect-plugin-bundles.mjs --platform=linux --tag=$t --allow-empty"
  echo "  note: Linux plugin bundles are headless — none are produced (see r2-publish.mjs); the .deb is the Linux release artifact."
}

# --- Release to R2 ----------------------------------------------------------
run_release() {
  load_env
  local t
  t="$(tag)"
  step "Guard: releasing $t (VERSION=$(cat "$ROOT"/VERSION))"
  rm -rf "$STAGE"
  mkdir -p "$STAGE"
  mac_release_leg "$t"
  linux_release_leg "$t"
  require_r2
  step "Uploading staged artifacts to R2 (r2://openaxe-releases/$t/)"
  (cd "$ROOT" && node scripts/r2-upload.mjs --tag="$t" \
    "$STAGE"/openaxe-desktop-*.dmg \
    "$STAGE"/openaxe-desktop-*.deb \
    "$STAGE"/openaxe-plugin-bundles-*.zip)
  step "Publishing sha256sums.txt + manifest.json"
  (cd "$ROOT" && node scripts/r2-publish.mjs --tag="$t" --expect=macos,linux)
  landing_build_deploy "$t"
  echo
  echo "✔ Release $t is live at: ${R2_PUBLIC_URL:-$R2_PUBLIC_URL_DEFAULT}/$t/"
}

# Build the landing against the R2 manifest and deploy it to Cloudflare Pages
# (mirrors release-publish.yml's `landing` step). When CLOUDFLARE_API_TOKEN is
# unset the landing is still built but not deployed.
landing_build_deploy() {
  local t="$1"
  step "Landing 1/2 — build from R2 ($t)"
  (cd "$ROOT" && RELEASES_SOURCE=r2 R2_PUBLIC_URL="${R2_PUBLIC_URL:-$R2_PUBLIC_URL_DEFAULT}" \
    pnpm --filter @openaxe/landing build)
  # The landing prebuild rewrites this generated fallback; keep the tree clean.
  git -C "$ROOT" checkout -- apps/landing/src/generated/releases.json 2>/dev/null || true
  if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
    echo "  skip  CLOUDFLARE_API_TOKEN not set — landing built but NOT deployed (see woodpecker/.env.example)" >&2
    return 0
  fi
  step "Landing 2/2 — deploy to Cloudflare Pages (openaxe-site)"
  # --branch=main: deploy to the project's production branch even from a topic
  # branch or a detached tag checkout (issue #441).
  (cd "$ROOT" && CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" \
    CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-${R2_ACCOUNT_ID:-}}" \
    npx --yes wrangler pages deploy apps/landing/dist --project-name=openaxe-site --branch=main --commit-dirty=true)
}

usage() { sed -n '3,20p' "$0"; }

case "${1:-all}" in
  ci)      run_ci ;;
  release) run_release ;;
  landing) load_env; landing_build_deploy "$(tag)" ;;
  all)     run_ci && run_release ;;
  -h|--help) usage ;;
  *) echo "Unknown command: $1" >&2; usage >&2; exit 1 ;;
esac