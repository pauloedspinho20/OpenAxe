# Changelog

All notable changes to OpenAxe are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[semver](https://semver.org/), driven by the root [`VERSION`](./VERSION) file (see
[CONTRIBUTING.md#releasing-desktop-builds](./CONTRIBUTING.md#releasing-desktop-builds)).

## [Unreleased]

### Changed

- Rebrand: "NAM Web Studio" is now **OpenAxe** (#151). npm scope `@nam/*` →
  `@openaxe/*`; CMake projects/options/targets and env vars
  (`OPENAXE_UI_URL`, `OPENAXE_DESKTOP_DEBUG`) renamed; new OpenAxe logo,
  favicon set, PWA icons and desktop app icons. The `extern "C"` ABI prefix
  `nam_studio_*` is deliberately unchanged — it is baked into the committed
  prebuilt WASM artifacts and can only move atomically with a rebuild (see
  `packages/core/include/openaxe/api.h`). Persisted storage names (IndexedDB
  `nam-web-studio`, localStorage keys, the desktop keychain service) are also
  unchanged so no user data is orphaned.

### Added

- Versioning system: a single `VERSION` file drives every `package.json`'s version and both
  CMake projects' `project()` version, checked in CI (`scripts/sync-version.mjs`). Pushing a
  `v*` tag now builds and publishes desktop installers to a GitHub Release
  (`.github/workflows/release.yml`) (#54).
