# Local-CI Linux runner — ubuntu-24.04, matching the `ubuntu-24.04` legs in
# .github/workflows/{ci,desktop,plugin}.yml.
#
# Build:  docker build -t openaxe-ci-linux docker/ci-linux
#         (run-linux-ci.sh builds automatically when the image is missing)
# Run:    pnpm ci:local:linux [--stage=...] [any ci-local.mjs flag]
#
# Notes:
# - Node 22 + pnpm 10.16.1 mirror .github/actions/setup-js + packageManager.
# - The apt list mirrors the "Install system dependencies (Linux)" steps in
#   desktop.yml / plugin.yml plus the cmake/ninja/ccache/pkg-config from
#   ci.yml core-tests.
# - Playwright browsers are installed at container-run time into a named
#   volume (see run-linux-ci.sh), not baked into the image, so browser
#   versions keep following pnpm-lock.yaml instead of the image build date.
# - On Apple Silicon, run with --platform linux/amd64 for runner fidelity
#   (CI is x86_64); it is slower under emulation than native arm64.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    git \
    ccache \
    cmake \
    ninja-build \
    pkg-config \
    libwebkit2gtk-4.1-dev \
    libgtk-3-dev \
    libasound2-dev \
    libpulse-dev \
    libcurl4-openssl-dev \
  && rm -rf /var/lib/apt/lists/*

# Node 22 LTS (matches actions/setup-node `node-version: 22`).
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@10.16.1 --activate

WORKDIR /work

# Pre-install Playwright's chromium system deps; the browsers themselves land
# in a cache volume at run time (see run-linux-ci.sh).
CMD ["node", "scripts/ci-local.mjs"]
