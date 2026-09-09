#!/bin/bash
# Linux agent (Docker backend) — runs ci-linux.yml steps in openaxe-ci-linux.
# Labels are assigned in the Woodpecker UI (Agents → this agent → platform=linux/amd64).
set -euo pipefail

VERSION="${WOODPECKER_VERSION:-v3.18.1}"
: "${WOODPECKER_AGENT_SECRET:?set WOODPECKER_AGENT_SECRET (same value as server .env)}"

# (Re)build the CI image if missing — same image docker/ci-linux documents.
if ! docker image inspect openaxe-ci-linux:latest >/dev/null 2>&1; then
  docker build -t openaxe-ci-linux docker/ci-linux
fi

exec docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e WOODPECKER_SERVER=host.docker.internal:9000 \
  -e WOODPECKER_AGENT_SECRET="$WOODPECKER_AGENT_SECRET" \
  -e WOODPECKER_BACKEND=docker \
  --add-host host.docker.internal:host-gateway \
  "woodpeckerci/woodpecker-agent:${VERSION}" agent
