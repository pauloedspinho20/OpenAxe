# Changelog

All notable changes to NAM Web Studio are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[semver](https://semver.org/), driven by the root [`VERSION`](./VERSION) file (see
[CONTRIBUTING.md#releasing-desktop-builds](./CONTRIBUTING.md#releasing-desktop-builds)).

## [Unreleased]

### Added

- Versioning system: a single `VERSION` file drives every `package.json`'s version and both
  CMake projects' `project()` version, checked in CI (`scripts/sync-version.mjs`). Pushing a
  `v*` tag now builds and publishes desktop installers to a GitHub Release
  (`.github/workflows/release.yml`) (#54).
