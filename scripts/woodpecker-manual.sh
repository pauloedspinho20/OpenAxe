#!/usr/bin/env bash
# Manual Woodpecker CI + release-to-R2 runner (issue #427).
#
# Runs, on demand (from a VSCode task or a terminal), exactly the stages the
# .woodpecker/*.yml pipelines perform — no Woodpecker server, agents or GitHub
# webhooks needed. Useful when you want a full CI + release without waiting
# for a tag/webhook, or when the smee forwarder isn't running.
#
#   bash scripts/woodpecker-manual.sh ci       # full CI: mac (native) + linux (Docker)
#   bash scripts/woodpecker-manual.sh release  # guard → desktop+plugin artifacts (mac+linux) → R2 → sha256sums+manifest
#   bash scripts/woodpecker-manual.sh all      # ci then release (default)
#
# Secrets: R2 creds come from the environment (R2_ACCESS_KEY, R2_SECRET_KEY,
# R2_ACCOUNT_ID, R2_PUBLIC_URL) or, if unset, from woodpecker/.env
# (gitignored) — same values the Woodpecker UI secrets hold. Nothing is
# written anywhere else; nothing is printed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
R2_PUBLIC_URL_DEFAULT="https://pub-800f414cbfe9422e9faaa00ed34d2821.r2.dev"

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
  step "macOS leg 1/3 — setup"
  (cd "$ROOT" && node scripts/ci-local.mjs --stage=setup)
  step "macOS leg 2/3 — web build + desktop package (dmg)"
  (cd "$ROOT" && pnpm build)
  (cd "$ROOT" && pnpm --filter @openaxe/desktop package)
  step "macOS leg 3/3 — plugin build + bundles"
  (cd "$ROOT" && node scripts/ci-local.mjs --stage=plugin --skip-setup)
  (cd "$ROOT" && node scripts/collect-plugin-bundles.mjs --platform=macos)
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
  docker run --rm --platform "$platform" \
    -v "$ROOT:/work" \
    -v openaxe-ci-ccache:/root/.cache/ccache \
    -v openaxe-ci-nm:/work/node_modules \
    -v openaxe-ci-nm-web:/work/apps/web/node_modules \
    -v openaxe-ci-nm-desktop:/work/apps/desktop/node_modules \
    -v openaxe-ci-nm-landing:/work/apps/landing/node_modules \
    -v openaxe-ci-nm-ui:/work/packages/ui/node_modules \
    -e CCACHE_DIR=/root/.cache/ccache \
    "$image" bash -lc "$*"
}

linux_release_leg() {
  step "Linux leg 1/3 — setup (Docker)"
  linux_run "node scripts/ci-local.mjs --stage=setup"
  step "Linux leg 2/3 — web build + desktop package (deb)"
  linux_run "pnpm build"
  linux_run "pnpm --filter @openaxe/desktop package"
  step "Linux leg 3/3 — plugin build + bundles"
  linux_run "node scripts/ci-local.mjs --stage=plugin --skip-setup"
  linux_run "node scripts/collect-plugin-bundles.mjs --platform=linux"
}

# --- Release to R2 ----------------------------------------------------------
run_release() {
  load_env
  local t
  t="$(tag)"
  step "Guard: releasing $t (VERSION=$(cat "$ROOT"/VERSION))"
  mac_release_leg
  linux_release_leg
  require_r2
  step "Uploading artifacts to R2 (r2://openaxe-releases/$t/)"
  (cd "$ROOT" && node scripts/r2-upload.mjs --tag="$t" \
    "apps/desktop/build/openaxe-desktop-*.dmg" \
    "apps/desktop/build/openaxe-desktop-*.deb" \
    "packages/vst3/build/openaxe-plugin-bundles-*.zip")
  step "Publishing sha256sums.txt + manifest.json"
  (cd "$ROOT" && node scripts/r2-publish.mjs --tag="$t" --expect=macos,linux)
  echo
  echo "✔ Release $t is live at: ${R2_PUBLIC_URL:-$R2_PUBLIC_URL_DEFAULT}/$t/"
}

usage() { sed -n '2,13p' "$0"; }

case "${1:-all}" in
  ci)      run_ci ;;
  release) run_release ;;
  all)     run_ci && run_release ;;
  -h|--help) usage ;;
  *) echo "Unknown command: $1" >&2; usage >&2; exit 1 ;;
esac