#!/usr/bin/env bash
# Local auto-release (issue #441): runs on the self-hosted Woodpecker when a
# push lands on `main`. Bumps VERSION + CHANGELOG (conventional commits), commits
# `chore(release): X.Y.Z`, creates the annotated tag, pushes both, then merges
# `main` back into `dev`.
#
# Doing this locally (instead of in GitHub Actions) keeps the version and the
# build on the same machine: if the Woodpecker stack is down, no version is
# minted — there is no orphan tag to clean up. Replay a missed run from the
# Woodpecker UI (the pipeline accepts `manual`).
#
# Requires a `github_token` Woodpecker secret (a PAT with Contents:write +
# bypass on the protect-main-dev ruleset) — see woodpecker/.env.example.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TOKEN="${github_token:-${GITHUB_TOKEN:-}}"
: "${TOKEN:?missing github_token secret (Woodpecker repo Settings -> Secrets)}"
REPO="${CI_REPO:-pauloedspinho20/OpenAxe}"

git config user.name "openaxe-release"
git config user.email "release@openaxe.local"
git remote set-url origin "https://x-access-token:${TOKEN}@github.com/${REPO}.git"

# Re-entrancy guard: the release commit pushed by a previous run of this pipeline
# triggers a `push` event too. Skip it rather than bump again.
if git log -1 --pretty=%s | grep -qE '^chore\(release\):'; then
  echo "release-bump: HEAD is a release commit — nothing to do."
  exit 0
fi

# auto-bump needs the tag history to diff against.
git fetch --tags --quiet origin
if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
  git fetch --unshallow --tags --quiet origin
fi

# Writes VERSION + syncs package.json + prepends CHANGELOG, commits, and tags.
# No-op (exit 0, no commit) when there is nothing to bump.
node scripts/auto-bump.mjs --tag

if ! git log -1 --pretty=%s | grep -qE '^chore\(release\):'; then
  echo "release-bump: no release commit — nothing to publish."
  exit 0
fi

NEXT="$(cat VERSION)"
echo "release-bump: releasing v${NEXT}"

# Push the tag first so the tag-triggered release legs start; then main, whose
# push event the re-entrancy guard above will no-op.
git push origin "v${NEXT}"
git push origin HEAD:main

# Back-merge the release commit into dev (issue #304).
git fetch --quiet origin main dev
git checkout -B dev origin/dev
if ! git merge --no-ff origin/main -m "chore(sync): merge main v${NEXT} back into dev"; then
  git merge --abort || true
  echo "release-bump: back-merge of main v${NEXT} into dev conflicts — resolve by hand:" >&2
  echo "  git checkout dev && git merge --no-ff origin/main && git push origin dev" >&2
  exit 1
fi
git push origin dev

DEV_VERSION="$(git show dev:VERSION | tr -d '[:space:]')"
if [ "$DEV_VERSION" != "$NEXT" ]; then
  echo "release-bump: dev is on ${DEV_VERSION} after the back-merge, expected ${NEXT}" >&2
  exit 1
fi
echo "release-bump: v${NEXT} released; dev is back in sync"
