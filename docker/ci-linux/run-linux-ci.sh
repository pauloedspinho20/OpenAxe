#!/usr/bin/env bash
# Local-CI Linux leg — runs scripts/ci-local.mjs inside ubuntu-24.04 Docker,
# mirroring the `ubuntu-24.04` legs of ci.yml / desktop.yml / plugin.yml.
#
#   pnpm ci:local:linux                       # everything, in Docker
#   pnpm ci:local:linux --stage=core,desktop  # subset (any ci-local.mjs flag works)
#
# Caching: ccache and Playwright browsers persist in named volumes across
# runs (like actions/cache in CI). node_modules is NOT shared with the macOS
# host — pnpm installs natively inside the container, avoiding the
# wrong-architecture native-binding trap scripts/setup.mjs repairs on Mac.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE="${OPENAXE_CI_IMAGE:-openaxe-ci-linux}"
# CI runners are x86_64; on Apple Silicon this emulates (slower) but matches.
PLATFORM="${OPENAXE_CI_PLATFORM:-linux/amd64}"
# The seqlock stress test (vst3_monitor_tap) deadlocks under Rosetta emulation
# (host arch != container arch). Real x86 Linux runs it normally.
SKIP_MONITOR_TAP=0
if [ "$(uname -m)" != "${PLATFORM#linux/}" ]; then SKIP_MONITOR_TAP=1; fi

# The image must match the platform the containers run on. If a local image
# exists but for a different architecture (e.g. built natively on Apple
# Silicon), rebuild it for the requested platform instead of pulling.
if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  local_arch="$(docker image inspect "$IMAGE" --format '{{.Architecture}}')"
  want_arch="${PLATFORM#linux/}"
  if [ "$local_arch" != "$want_arch" ]; then
    echo "Rebuilding $IMAGE: local arch $local_arch != platform $PLATFORM"
    docker build --platform "$PLATFORM" -t "$IMAGE" "$ROOT/docker/ci-linux"
  fi
else
  echo "Building $IMAGE (first run only)…"
  docker build --platform "$PLATFORM" -t "$IMAGE" "$ROOT/docker/ci-linux"
fi

# System deps for Playwright chromium (cheap when already installed).
docker run --rm --platform "$PLATFORM" \
  -v openaxe-ci-playwright:/root/.cache/ms-playwright \
  "$IMAGE" bash -lc \
  "pnpm --filter @openaxe/web exec playwright install-deps chromium >/dev/null 2>&1 || true" || true

docker run --rm --platform "$PLATFORM" \
  -v "$ROOT:/work" \
  -v openaxe-ci-ccache:/root/.cache/ccache \
  -v openaxe-ci-playwright:/root/.cache/ms-playwright \
  `# node_modules overlays: the container gets its own Linux pnpm install` \
  `# without clobbering the macOS host's native bindings (see setup.mjs).` \
  -v openaxe-ci-nm:/work/node_modules \
  -v openaxe-ci-nm-web:/work/apps/web/node_modules \
  -v openaxe-ci-nm-desktop:/work/apps/desktop/node_modules \
  -v openaxe-ci-nm-landing:/work/apps/landing/node_modules \
  -v openaxe-ci-nm-ui:/work/packages/ui/node_modules \
  -e CCACHE_DIR=/root/.cache/ccache \
  -e PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright \
  -e OPENAXE_CI_SKIP_MONITOR_TAP="$SKIP_MONITOR_TAP" \
  "$IMAGE" node scripts/ci-local.mjs "$@"
