# Pull Request

## Summary

<!-- What does this change and why? Link epic/issue: Fixes #... -->
<!-- Base branch: dev for all feature PRs (only dev→main targets main) — see CONTRIBUTING.md#Branching -->

## Checklist

- [ ] Title uses Conventional Commits (`feat:`, `fix:`, `docs:`, `feat!:` / `BREAKING CHANGE:`) — drives `scripts/auto-bump.mjs`
- [ ] One epic / one task scope (or explain why broader)
- [ ] Licensing: new DSP/port noted with upstream + license/version in code comment + PR description (see CONTRIBUTING.md)
- [ ] DCO sign-off: `git commit -s` (`Signed-off-by`)
- [ ] Ran locally (checked as applicable):
  - [ ] `pnpm lint` / `pnpm format:check` / `pnpm build` / `pnpm test:run`
  - [ ] `pnpm test:e2e` (if touched `apps/web` AudioContext / e2e)
  - [ ] `node scripts/gen-param-schema.mjs --check` (and `--target=automation-map` if plugin params)
  - [ ] `node scripts/check-grid-dims.mjs --check`
  - [ ] `node scripts/check-wasm-exports.mjs --check` (and `bash scripts/build-core-wasm.sh` if `api.h` / `EXPORTED_FUNCTIONS`)
  - [ ] `node scripts/sync-version.mjs --check` (never bump `package.json` manually)
  - [ ] `node packages/ui/scripts/generate-tokens.mjs --check`
  - [ ] `cmake` / `ctest` for `packages/core` / `apps/desktop` / `packages/vst3` if touched
- [ ] Updated docs (`README.md`, `AGENTS.md`, `CONTRIBUTING.md`, package READMEs) if needed
- [ ] Screenshots / recording if UI

## Testing

<!-- How was this verified? -->

## Breaking changes

<!-- List or "None" -->
