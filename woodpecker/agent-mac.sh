#!/bin/bash
# macOS agent (native, Local backend) — runs ci-mac.yml steps directly on the Mac.
# Prereqs: node 22 + pnpm 10.16.1 on PATH, Xcode CLT, CMake, Docker (for images).
# Auth via WOODPECKER_AGENT_SECRET env; label via --labels below (v3 CLI).
# If flags differ on your version, run: ~/.woodpecker/bin/woodpecker-agent --help
set -euo pipefail

VERSION="${WOODPECKER_VERSION:-v3.18.1}"
BINDIR="$HOME/.woodpecker/bin"
BIN="$BINDIR/woodpecker-agent"
mkdir -p "$BINDIR"
if [ ! -x "$BIN" ]; then
  # Release ships a tarball (underscore arch), not a bare binary.
  tmp="$(mktemp -d)"
  curl -fSL -o "$tmp/agent.tgz" \
    "https://github.com/woodpecker-ci/woodpecker/releases/download/${VERSION}/woodpecker-agent_darwin_arm64.tar.gz"
  tar -xzf "$tmp/agent.tgz" -C "$tmp"
  cp "$tmp"/woodpecker-agent* "$BIN" 2>/dev/null || cp "$(find "$tmp" -maxdepth 2 -name 'woodpecker-agent*' -type f | head -1)" "$BIN"
  chmod +x "$BIN"
  rm -rf "$tmp"
fi

# Auto-load the secret from woodpecker/.env when not exported, so a literal
# placeholder can never reach the server (v3 rejects unknown tokens outright).
if [ -z "${WOODPECKER_AGENT_SECRET:-}" ]; then
  _dotenv="$(cd "$(dirname "$0")" && pwd)/.env"
  if [ -f "$_dotenv" ]; then
    WOODPECKER_AGENT_SECRET="$(grep -E '^WOODPECKER_AGENT_SECRET=' "$_dotenv" | cut -d= -f2-)"
    export WOODPECKER_AGENT_SECRET
  fi
  unset _dotenv
fi
: "${WOODPECKER_AGENT_SECRET:?set WOODPECKER_AGENT_SECRET (same value as server .env)}"
# Ensure toolchain is on PATH for launchd and plain-terminal runs alike.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# Persist agent ID in $HOME (avoids /etc write errors + re-registration each start).
export WOODPECKER_AGENT_CONFIG_FILE="${WOODPECKER_AGENT_CONFIG_FILE:-$HOME/.woodpecker/agent.conf}"
mkdir -p "$(dirname "$WOODPECKER_AGENT_CONFIG_FILE")"
# Labels ride on the command line — no UI tagging step needed.
exec "$BIN" \
  --server localhost:9000 \
  --labels platform=darwin/arm64 \
  --backend-engine local
