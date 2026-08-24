# Changelog

All notable changes to OpenAxe are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[semver](https://semver.org/), driven by the root [`VERSION`](./VERSION) file (see
[CONTRIBUTING.md#releasing-desktop-builds](./CONTRIBUTING.md#releasing-desktop-builds)).

## [Unreleased]

## [0.2.4] - 2026-08-24

### Changed

- Dev to Main (#270) (1d856c3)

## [0.2.3] - 2026-08-24

### Changed

- chore: dependabot PRs target dev, docs clarify dev as only base (648955c)

## [0.2.2] - 2026-08-24

### Added

- OSS hygiene: `CODE_OF_CONDUCT.md`, `SECURITY.md`, `SUPPORT.md`, `THIRD_PARTY_NOTICES.md`, issue/PR templates, `FUNDING.yml` (GitHub Sponsors), `dependabot.yml`, `labeler.yml`, `stale.yml`, `DCO.yml`
- VS Code: `WASM: Build core`, 5 drift `--check` tasks, `Build Storybook`, `.vscode/{extensions,settings,launch}.json` (Chrome + lldb for desktop/plugin/core)
- Repo: `.gitattributes` (binary/generated, `pnpm-lock.yaml` merge), package metadata (`repository`/`bugs`/`homepage`/`license`)

### Changed

- **Branching:** `dev → main` now via **merge commit** (`--no-ff`), not squash — fixes recurring `added in both` conflicts on `plugin.yml`/`CMakeLists.txt` (PR #244)
- **CI enabled:** `ci.yml`/`desktop.yml`/`plugin.yml` (added `pull_request` path-filtered) + 5 drift checks must pass; removed `AGENTS.md` disabled banner
- **Docs:** `README.md` platform statuses (Desktop Live, VST3 Beta, DSP/design-system Partial), full 46-task catalog + drift guards + WASM + branching; `CONTRIBUTING.md` expanded setup, branching, DCO (`git commit -s`), fork/unsigned notes; `AGENTS.md` fixed `cmake -S` typo
- `VERSION` 0.2.0 → 0.2.2; `LICENSE` copyright 2024-2026 OpenAxe Contributors

### Fixed

- Merge PR #244 locally via merge commit (took `dev` superset for `.github/workflows/plugin.yml` signing/installers + `packages/vst3/CMakeLists.txt` CPack block)

## [0.2.1] - 2026-08-23

### Fixed

- Tag `v0.2.1` (hot-fix docs) — no functional change since `0.2.0`; reconciled `VERSION` drift noted in release flow audit

## [0.2.0] - 2026-08-23

### Added

- feat(desktop): replace RtAudio with JUCE's audio_devices module (ee9a1ce)
- feat(core+web): drive the C++ graph from the web path via one rig worklet (118629b)
- feat(core+desktop): decode IR files in the core, finishing the audio path (9d1ced8)
- feat(core+web): IR convolution in the core, replacing the web-only ConvolverNode (945cfa6)
- feat(core+web+desktop): move the amp tone stack into C++ (d011ddb)
- feat(core+web): run the web app's amp on the C++ core, dropping the second NAM engine (561367c)
- feat(core+web+desktop): move block trims and the reverb control map into C++ (7c8b863)
- feat(web+desktop): add no-sound mode + device selector, use it to survive audio-hardware contention (2370f92)
- feat(core+desktop+web): implement bypass and master bus on the native path (issue #42) (faa8fd8)
- feat(core+web): single source of truth for effect-param schema (issue #51) (a9c7261)
- feat(desktop): remove Web Audio entirely from the native path (d2f9ff0)
- feat(desktop): debug logging, crash backtrace, and webview devtools toggle (051e4c5)
- feat(desktop): native desktop app reusing the web UI (issue #15) (48e4286)
- feat(grid): protect cables, sonner toasts, smarter auto-wiring, cable follow (c3c8acb)
- feat(core+web): replace synthetic Mix/Level with native DSP controls (904f92e)
- feat(core+web): add DSPark Compressor, EQ, Noise Gate, Tremolo DSP + WASM + web UI (ac63b1a)
- feat(core+web): add Delay (3 models) and Ping-Pong Delay DSP + WASM + web UI (0b2df32)
- feat(core+web): add Chorus, Flanger, Phaser DSP wrappers, WASM worklets, and web UI (1a82d80)
- feat(web): add Dragonfly Reverb algorithm selector (Hall, Room, Plate, Early Reflections) (33c7db1)
- feat(web): wire Tube Screamer, Zen Drive, MXR Distortion+ drive models to WASM + web UI (eeda18e)
- feat(core): add Tube Screamer, Zen Drive, MXR Distortion+ drive models (dc4471c)
- feat: wire Diode Clipper into a new Drive BlockKind, end to end (#14, #22) (70d67db)
- feat(core): wrap BYOD's Diode Clipper (#14) (8056f3c)
- feat(web): disable not-yet-migrated effect blocks, show DSP vendor in inspector (c6031c9)
- feat(web): expose Dragonfly Reverb's Width/Predelay/Spin/Wander/Early Send (7a2d0c3)
- feat(web): compile packages/core to WASM, replace Freeverb with real Dragonfly Reverb (#22) (d37b29a)
- feat(core): add real-time extern "C" processing ABI (#14) (efa3fdf)
- feat(core): wrap remaining 3 Dragonfly Reverb algorithms, fix symbol collision (0111365)
- feat(core): wrap Dragonfly Hall Reverb with full 18-parameter surface (c900da6)
- feat(core): vendor DSP libraries, port audio graph engine, wrap NAM inference (#14) (d121118)
- feat(monorepo): scaffold pnpm + Turborepo workspace (#13) (1a7300a)
- feat(design-system): clean up Tone3000Browser CSS, replace buttons with shared component (b9ac7b2)
- feat(design-system): migrate 6 more dialogs to shared Dialog (cbeb188)
- feat(design-system): scaffold Storybook 8, write stories for all primitives and shared components (2eb725b)
- feat(design-system): migrate dialogs to shared components, deduplicate CSS (302d2fb)
- feat(design-system): extract tokens, add missing properties, fix naming, create shared components (5564786)

### Fixed

- fix(core+web): align grid dims TS<->C++ and rebuild WASM (#61) (#95) (0a108b6)
- fix(desktop): drop MessageManager::deleteInstance() to stop teardown crash (8d23f6a)
- fix(desktop): populate native device list so the FM3 and others are selectable (8069832)
- fix(desktop): only show the default audio device in the Input/Output pickers (269e49e)
- fix(desktop): delete JUCE MessageManager singleton on AudioIO teardown (3fed8dc)
- fix(desktop): harden StudioBridge::Call against stack-lifetime hazard (issue #59) (d596eaf)
- fix(web): serialize native audio engine start/stop to prevent races (b7410e7)
- fix(core+web): fix web rig message protocol so audio reaches blocks and output (89b253e)
- fix(desktop+web): account for Windows' multi-config nam_desktop.exe path, fix a flaky e2e locator (91e91eb)
- fix(desktop): stage into CPack's real staging dir, spawn pnpm through a shell on Windows (0f82bc0)
- fix(desktop): link ws2_32 on Windows for http_server.cpp's raw Winsock calls (0035e9d)
- fix(core): include <mutex> in engine.cpp for std::unique_lock (4b21b4a)
- fix(desktop): move POSIX socket headers behind the existing Windows guard (d139e22)
- fix(desktop): guard CrashHandler out on Windows, fixing the MSVC build (68e2cc9)
- fix(ci): exclude @nam/desktop from build-and-test's build step (30a91ca)
- fix(vercel): scope Vercel's build to @nam/web, stop it building the desktop app (f742182)
- fix(ci): fix format:check - prettier can't parse CMakeLists.txt, ignore generated WASM glue (41e4621)
- fix(desktop): refuse mismatched input/output devices instead of crashing or feeding back (issue #53) (e3a15d1)
- fix(web): harden audio lifecycle - suspend/resume, device loss, WASM errors (issue #49) (2f09ff3)
- fix(desktop): surface dropped effect params instead of silently ignoring them (issue #41) (d5296dd)
- fix(desktop): remove the audio-thread mutex, recover from suspend timeout (issue #43) (93932a1)
- fix(desktop): clamp I/O channels to device capabilities (issue #15) (bf46c8b)
- fix(web): ship wasm to prod and stop p5 parsing the bundle (c660e46)
- fix(core): update compressor param-count tests for the new Mix param (7 -> 8) (23e6f68)
- fix(e2e): pin Playwright 1.61.1 (WebKit PushAPIEnabled) and extend stability-test timeout (6747f0f)
- fix(core): Chorus/Flanger output wet-only signal; Phaser negative frequency clamp (6e03286)
- fix(e2e): update tests for disabled effect kinds and async WASM Reverb (9065693)
- fix(monorepo): declare Vite env vars in turbo.json, move .env files into apps/web (9dbf5cc)
- fix(e2e): update VS Code tasks and e2e tests for pnpm + current app UI (81fa7b3)
- fix: correct AudioArt import casing after folder rename (5d0554f)

### Changed

- Dev (#220) (0417d3e)
- Dev to main (#212) (03bc690)
- Dev (#105) (04117cf)
- Dev (#99) (82a4c73)
- Dev (#97) (6dfce48)
- chore(core+web): finish #55 cleanup - delete dead effect classes, fix desktop reverb routing (42dca5c)
- docs: define the C++-first boundary across web, desktop and plugin targets (0ea155c)
- docs(core): comment every function and document the DSP algorithms (187490e)
- chore(repo): run and build web + desktop independently or together (3a85c6d)
- chore(core+desktop+web): remove Drive effect and unused vendored DSP deps (f934a0e)
- test(desktop+core): stress-test concurrent mutation, fix a real block_states_ race (issue #52) (842f831)
- docs(root): cross-reference the desktop app commands and debugging guide (7cf9fe4)
- docs(desktop): add useful commands and debugging guide to README (2e53e65)
- Multiple layout changes and fixes (01da848)
- Documentation in chorus, flanger and phaser dsp headers (0b8a95a)
- Layout fixes (0f242ec)
- Bug fix (b4dcda3)
- chore(tasks): add composite setup task for web + C++ engine (a76d4c8)
- docs: add C++ build requirements to README, VS Code tasks for packages/core (bd7e076)
- docs(core): record LSP Suite/AnalogTapeModel scouting findings (bcdf90f)
- refactor(core): drop RTNeural, pedals will be NAM captures instead (a1e6fcb)
- Lint fix (6e95db6)
- Bug fix (f24406f)
- bug fixes (efb9d64)
- Bug fix (0845f91)
- chore(design-system): enable a11y error mode in Storybook, audit passes (d6ab085)
- refactor(components): move top-level dialogs into components/global/ (5de5fc6)
- refactor(components): organize all components into per-component folders (1ad2b04)
- refactor(design-system): organize shared components into per-component folders (d515e70)
- update readme (1e41dca)
- Fix tests (3309f6a)
- Multiple bug fixes (cdaf3c1)
- Multiple layout features and bug fixes (c5f95be)
- Multiple layout changes (f9014a9)
- Multiple developments (b9c7fb3)
- Use an outline instead of a border for the block card (5304185)
- Add preset scenes with MIDI control, a Splitter block, and NAM bypass (5669d56)
- Fix effect params (Mix/Level etc.) bleeding between different blocks (6fde398)
- Add Mix/Level knobs to every effect and in/out level to NAM model blocks (f2ae942)
- Move I/O into the header, add inspector bypass/meter, theme Tone3000 UI (a95e5b2)
- Fix every effect silently passing audio through unprocessed (1cee2f5)
- Gate the app behind a power-on overlay; fix silent Tone3000 import failure (f16f5c7)
- Fix Tone3000 import silently not reaching a just-added block (0e0c170)
- Add Playwright e2e suite, wire into CI, and add a Tone3000 My Models scope (08ba32a)
- Grid UX fixes, tone stack, Tone3000 catalog upgrades, and hardware polish (02900f7)
- Add tuner. Fix core blocks (7cdc75e)
- Add tuner. (0e5d909)
- Replace dual-chain rig with a routing-grid architecture (78a4b24)
- Show tone images in ChannelStrip amp/cab screens and Library tab (e00ef1b)
- Add amp tone controls (Bass, Mid, Treble, Presence) + slim size selector (c41da46)
- Live device switching — reconnect mic when input device or channel routing changes (d7f5160)
- Implement Tone3000 integration and Audio I/O management (ea717c4)
- Add effect parameter editing to FX slots (eecc3d9)
- Add light/dark theme, local model/IR loading, and functional FX slots (354abba)
- Add hardware-inspired UI: design system, primitives, dual-chain rack (c819c5d)
- Add local-first preset management with full state round-tripping (dc89dff)
- Add effects suite: 10 native-DSP effects plus ordering/bypass chain (f71a060)
- Add dual-chain rig, stereo mixer, and reactive channel-strip state (0eb2ce1)
- Add NAM WASM engine wrapper with IR convolution and asset cache (7b63595)
- Scaffold Vite + React + TS app with tooling and licensing (b9ffccc)

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
