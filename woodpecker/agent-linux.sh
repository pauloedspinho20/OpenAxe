#!/bin/bash
# Linux agent (Docker backend) — runs ci-linux.yml steps in openaxe-ci-linux.
# Auth via WOODPECKER_AGENT_SECRET env; label via WOODPECKER_AGENT_LABELS (v3 CLI).
set -euo pipefail

VERSION="${WOODPECKER_VERSION:-v3.18.1}"
# Auto-load the secret from woodpecker/.env when not exported (see agent-mac.sh).
if [ -z "${WOODPECKER_AGENT_SECRET:-}" ]; then
  _dotenv="$(cd "$(dirname "$0")" && pwd)/.env"
  if [ -f "$_dotenv" ]; then
    WOODPECKER_AGENT_SECRET="$(grep -E '^WOODPECKER_AGENT_SECRET=' "$_dotenv" | cut -d= -f2-)"
    export WOODPECKER_AGENT_SECRET
  fi
  unset _dotenv
fi
: "${WOODPECKER_AGENT_SECRET:?set WOODPECKER_AGENT_SECRET (same value as server .env)}"

# (Re)build the CI image if missing — same image docker/ci-linux documents.
if ! docker image inspect openaxe-ci-linux:latest >/dev/null 2>&1; then
  docker build -t openaxe-ci-linux docker/ci-linux
fi

exec docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e WOODPECKER_SERVER=host.docker.internal:9000 \
  -e WOODPECKER_AGENT_SECRET="$WOODPECKER_AGENT_SECRET" \
  -e WOODPECKER_AGENT_LABELS=platform=linux/amd64 \
  -e WOODPECKER_BACKEND=docker \
  --add-host host.docker.internal:host-gateway \
  "woodpeckerci/woodpecker-agent:${VERSION}"
