# <img src="./apps/desktop/packaging/openaxe-256.png" width="28" valign="middle" alt="OpenAxe logo" /> OpenAxe

A free, open-source guitar/bass amp, cabinet, and effects suite — in the spirit of Amplitube / Guitar Rig — built on [Neural Amp Modeler](https://github.com/sdatkinson/NeuralAmpModelerCore) (NAM). Runs as a **web app** (live), **desktop app** (live, C++ + webview.h + JUCE), **VST3/CLAP/AU plugin** (live, iPlug2 — beta) — **mobile** (iOS + Android) planned — all sharing the same C++ DSP engine and design system.

> **Contributing?** Start with [`AGENTS.md`](./AGENTS.md) (agent/contributor orientation + verification commands), then [`CONTRIBUTING.md`](./CONTRIBUTING.md) (setup, licensing, branching, releases, DCO) and [`ARCHITECTURE.md`](./ARCHITECTURE.md) (what belongs in `packages/core` vs a front end). Good first issues: [`good first issue`](https://github.com/pauloedspinho20/OpenAxe/labels/good%20first%20issue).

See [ARCHITECTURE.md](./ARCHITECTURE.md) for how the C++ core and the four front
ends divide responsibility (what belongs in `packages/core` vs a front end, the
per-target status of that split, the migration order, and the latency budget).

## Project decisions

| Area             | Decision                                                                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Distribution     | Free & open source, licensed [GPLv3](./LICENSE)                                                                                                                                          |
| Stack            | Vite + React + TypeScript SPA (web) / C++ + webview.h + JUCE `audio_devices` (desktop) / iPlug2 (VST3) / native (mobile)                                                                 |
| Signal graph     | **Modular grid (GraphRig)** — blocks placed on a 4×10 grid, cabled left-to-right                                                                                                         |
| Audio (web)      | AudioWorklet + WASM — the same C++ core as native, compiled via Emscripten (#22 shipped)                                                                                                 |
| Audio (native)   | C++ DSP core → direct call (no FFI, no language bridge)                                                                                                                                  |
| Shared DSP core  | **C++** — wraps Dragonfly Reverb, DSPark, NeuralAmpModelerCore (pedals/outboard gear also modeled as NAM captures, not a separate engine)                                                |
| State management | [Zustand](https://github.com/pmndrs/zustand)                                                                                                                                             |
| CSS              | CSS Modules + CSS custom properties (two hardware-inspired finishes: Carbon / Aluminum)                                                                                                  |
| Persistence      | IndexedDB (web) / filesystem (desktop/mobile)                                                                                                                                            |
| Monorepo (#13)   | pnpm + Turborepo workspaces: `apps/web`, `apps/desktop`, `apps/landing`, `apps/ios`, `apps/android`, `packages/core` (C++), `packages/vst3` (iPlug2), `packages/ui`, `packages/defaults` |

## Platform targets

| Target            | Status  | Tech                                                                                                                     | Latency Target          | Issue                                                       |
| ----------------- | ------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ----------------------------------------------------------- |
| **Web**           | Live    | Vite + React + AudioWorklet running the C++ core as WASM (one `RigWorkletNode` owns the whole graph)                     | ~15ms round-trip        | [#22](https://github.com/pauloedspinho20/OpenAxe/issues/22) |
| **Desktop**       | Live    | C++ + webview.h + JUCE `audio_devices` + React UI (webview)                                                              | <5ms round-trip         | [#15](https://github.com/pauloedspinho20/OpenAxe/issues/15) |
| **VST3/CLAP/AU**  | Beta    | iPlug2 (C++) + webview (React) + `packages/core` — same React UI as web/desktop, loopback HTTP + `window.openAxe` bridge | <5ms (DAW audio thread) | [#16](https://github.com/pauloedspinho20/OpenAxe/issues/16) |
| **iOS**           | Planned | SwiftUI + CoreAudio + C++ via ObjC++ bridge                                                                              | 5-8ms round-trip        | [#17](https://github.com/pauloedspinho20/OpenAxe/issues/17) |
| **Android**       | Planned | Jetpack Compose + AAudio/Oboe + C++ via JNI                                                                              | ~20ms round-trip        | [#17](https://github.com/pauloedspinho20/OpenAxe/issues/17) |
| **Shared DSP**    | Live    | C++ library with extern "C" API (`packages/core`) — drives web (WASM), desktop and plugin                                | —                       | [#14](https://github.com/pauloedspinho20/OpenAxe/issues/14) |
| **Design System** | Live    | Storybook + `packages/ui/` + token pipeline (`design-tokens.json` → CSS + `packages/vst3/generated/tokens.h`)            | —                       | [#21](https://github.com/pauloedspinho20/OpenAxe/issues/21) |

### Why these choices

- **C++ for DSP core** — All 3 vendored DSP libraries are C++ (Dragonfly, DSPark, NAMCore). Wrapping them in Rust requires FFI layers for no algorithmic benefit. C++ compiles natively everywhere — desktop, VST3, iOS, Android, and WASM (via Emscripten). One language, no bridges between DSP and platform APIs.
- **Desktop: C++ + webview.h** — React UI runs in a native system webview, same process as audio engine. Zero IPC overhead for parameter changes. 5-10MB binary vs 150MB+. JUCE `audio_devices` after RtAudio CoreAudio crash (see `apps/desktop/CMakeLists.txt`). webview.h ships no menu bar, so `src/mac_menu.mm` installs the standard App/Edit/Window menus — without an Edit menu macOS gives you no ⌘C/⌘V in text fields (#300 H1).
- **VST3: iPlug2 (C++, MIT), not JUCE** — Direct C++ DSP integration. MIT license avoids JUCE's proprietary/AGPL restrictions. Supports VST3, CLAP, AU, AAX Native. Editor is the same React SPA as web/desktop via `IWebViewControl` + loopback HTTP + `window.openAxe` bridge (no IGraphics fork).
- **Mobile: Native shells** — C++ DSP runs directly on the device's audio hardware via JNI (Android) and ObjC++ bridge (iOS). No WASM runtime, no webview, no JS bridge in the audio path.

### What every platform shares

- **C++ DSP core** (`packages/core/`) — NAM inference, 15 effects, audio graph logic. Exposed via `extern "C"` API for maximum portability. Wraps best-in-class C++ libraries.
- **Design tokens** — Single source of truth (`packages/ui/tokens/design-tokens.json`) generating CSS custom properties (web/desktop) and `packages/vst3/generated/tokens.h` (C++ `IColor`/`constexpr float`) via `node packages/ui/scripts/generate-tokens.mjs [--target=css|cpp]`.
- **React components** — Shared between web, desktop _and_ VST3 plugin (all via webview). Mobile reimplements primitives natively (Compose/SwiftUI) consuming the same design tokens.

## Architecture

### Signal graph (GraphRig)

```
                                                          ┌──────────────────────────────┐
  Input ─► [IN rail] ─► Block ─► Block ─► Block ─► ... ─► [OUT rail] ─► Master bus ─► Output
 (mic/       (left)    (Amp/A)  (Gate)   (Delay)          (right)        (level/mute)
interface)
```

- **Block types**: `Amp` / `AmpCab` / `Pedal` / `Outboard` (NAM captures via NeuralAmpModelerCore), `Cab` (IR convolution), 14 effects, `Mixer`, `Splitter`, `Send`/`Return` ×2 — 26 kinds in total (`NamStudioBlockKind` in `packages/core/include/openaxe/api.h`)
- Blocks sit on a **4-row × 10-column grid** with IN/OUT rails
- Graph validates connections for feedback loops; automatic semi-smart wiring on block placement

### Effects suite

15 effect blocks, all in `packages/core` — every front end runs the same C++
code (web via WASM in an AudioWorklet, desktop and plugin by direct call), so
there is no separate per-platform implementation to keep in step. Headers live
in `packages/core/include/openaxe/dsp/`.

The DSP is **written from scratch** rather than extracted from LSP, BYOD or
ChowDSP: those depend on JUCE `dsp`/`AudioBuffer` or pull in large plugin
frameworks, so they can't be compiled standalone into a portable core (the
reasoning is recorded per-file, e.g. `dsp/chorus.h`). Reverb, amp modelling and
cab IR are the exceptions — they wrap vendored libraries.

| Effect          | Implementation                                                           |
| --------------- | ------------------------------------------------------------------------ |
| Noise Gate      | `noise_gate.h`                                                           |
| Compressor      | `compressor.h`                                                           |
| Parametric EQ   | `equalizer.h`                                                            |
| Chorus          | `chorus.h`                                                               |
| Flanger         | `flanger.h`                                                              |
| Phaser          | `phaser.h`                                                               |
| Tremolo         | `tremolo.h` — stereo + harmonic modes (#268)                             |
| Ring Mod        | `ring_mod.h` — sine carrier, diode/transformer saturation (#268)         |
| Filter          | `filter.h` — Wah / Envelope / 4-pole Moog-style ladder (#268)            |
| Pitch Shifter   | `pitch_shifter.h` — Whammy (±12 st) + Detune (#268)                      |
| Granular Delay  | `granular_delay.h` — 2 Hann grains, freeze/hold, per-grain ±12 st (#268) |
| Rotary          | `rotary.h` — mda/Faust Leslie: horn/drum, mic distance, drive (#268)     |
| Delay           | `delay.h` — digital / analog / tape models                               |
| Ping-Pong Delay | `ping_pong_delay.h`                                                      |
| Reverb          | Dragonfly Reverb (GPLv3) — hall / room / plate / early reflections       |

Vendored libraries and their licences: [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

### Amp modeling

| Target              | Library                                 | Integration                                                                                                                                                       |
| ------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **All platforms**   | NeuralAmpModelerCore (MIT, C++)         | ✓ Direct C++ link — same code everywhere                                                                                                                          |
| **Web**             | NAMCore compiled to WASM via Emscripten | AudioWorklet + SAB params                                                                                                                                         |
| **Pedals/outboard** | NeuralAmpModelerCore (MIT, C++)         | Same engine, not a separate one — NAM's format isn't amp-specific, so pedal captures reuse the amp wrapper directly (RTNeural was evaluated and dropped for this) |

### Design system

Two hardware finishes: **Carbon** (dark, TX-6-style) and **Aluminum** (light, OP-1-style). 9 primitives in `packages/ui/src/primitives/` (Knob, Fader, HardwareButton, IconButton, Led, Meter, Toggle, Panel, Chip) + 8 in `packages/ui/src/shared/` (Dialog, FormField, OutlineButton, Pagination, Select, StatusText, Toaster, Wordmark). Tokens in `packages/ui/tokens/design-tokens.json` → `packages/ui/tokens/{colors,spacing,typography,shadows}.css` and `packages/vst3/generated/tokens.h` via `node packages/ui/scripts/generate-tokens.mjs`.

## Project structure

pnpm + Turborepo monorepo (#13). `apps/ios` and `apps/android` are placeholders (README + issue #17). Everything else is live/built.

```
OpenAxe/
├── apps/
│   ├── web/                  # Vite + React app (the current live product)
│   │   ├── src/
│   │   │   ├── components/       # App-specific React UI (grid, global, scenes, midi, presets...)
│   │   │   ├── effects/          # Web audio effect DSP modules + param schema
│   │   │   ├── engine/           # Audio engine (GraphRig, AudioContext lifecycle)
│   │   │   ├── hooks/            # React hooks
│   │   │   ├── midi/             # MIDI message handling
│   │   │   ├── presets/          # Preset capture, storage, sharing
│   │   │   ├── scenes/           # Scene bank
│   │   │   ├── settings/         # App settings
│   │   │   ├── state/            # Zustand stores
│   │   │   ├── storage/          # IndexedDB
│   │   │   ├── test/             # Vitest setup
│   │   │   ├── tone3000/         # Tone3000 API
│   │   │   └── tuner/            # Pitch detection
│   │   └── e2e/                  # Playwright E2E tests
│   ├── desktop/               # Native desktop shell — C++ + webview.h + JUCE audio_devices + React UI (#15), see apps/desktop/README.md
│   ├── ios/                   # Placeholder — SwiftUI + C++ via ObjC++ bridge (#17)
│   └── android/               # Placeholder — Jetpack Compose + C++ via JNI (#17)
├── packages/
│   ├── core/                  # C++ DSP library — graph engine, NAM, Dragonfly Reverb done (#14)
│   │   ├── include/openaxe/    # Graph engine, dsp/ wrappers, extern "C" lifecycle API
│   │   ├── src/                   # Implementation + tests/ (CTest, all passing)
│   │   └── third_party/           # Dragonfly (wired), NAMCore (wired), DSPark (wired)
│   ├── vst3/                   # VST3 + standalone plugin (iPlug2 + packages/core, WHOLE_ARCHIVE) — live/beta (#16), see packages/vst3/README.md
│   ├── defaults/               # Factory presets/scenes shared by every front end
│   └── ui/                     # Shared React component library + design tokens
│       ├── src/primitives/         # Knob, Fader, HardwareButton, IconButton, Led, Meter, Toggle, Panel, Chip
│       ├── src/shared/              # Dialog, FormField, OutlineButton, Pagination, Select, StatusText, Toaster, Wordmark
│       └── tokens/                  # CSS custom properties + design-tokens.json → generated/tokens.h
├── .storybook/                # Storybook, scans packages/ui stories
├── .github/workflows/         # CI (ci.yml, desktop.yml, plugin.yml, release.yml, auto-release.yml)
├── scripts/                   # setup.mjs, drift guards, sync-version, auto-bump, build-core-wasm.sh
├── .vscode/tasks.json         # 59 tasks — mirrors every command below (⇧⌘B)
├── pnpm-workspace.yaml
└── turbo.json
```

## Development

### Requirements

- [Node.js](https://nodejs.org) 22+ and [pnpm](https://pnpm.io) 10.16.1 (`corepack enable`) — for `apps/web` and `packages/ui`. `.nvmrc` pins 22.
- [CMake](https://cmake.org) 3.22+ and a C++20 compiler (Clang, GCC, or MSVC) — for `packages/core`, `apps/desktop`, `packages/vst3`. Not needed for pure web-app work. On macOS with CMake.app: **Tools → How to Install For Command Line Use** first.
- Git — vendored DSP libs under `packages/core/third_party/` are git submodules.
- Emscripten SDK (optional) — only for `bash scripts/build-core-wasm.sh` (see WASM section).
- Linux desktop/plugin builds need `libwebkit2gtk-4.1-dev libgtk-3-dev libasound2-dev libpulse-dev` (see `desktop.yml`/`plugin.yml`).

```bash
# One-time setup (idempotent) — submodules + pnpm install (repairs Rosetta x64 binaries) + CMake configure
node scripts/setup.mjs
# Web-only variant (no C++ toolchain / submodules)
node scripts/setup.mjs --web-only
# Then:
pnpm dev          # web dev server (Vite)
pnpm dev:desktop  # desktop native shell (debug + bundled UI)
pnpm dev:all      # both, parallel (or use VS Code tasks below)
```

> **Rosetta / wrong-arch pnpm:** If `pnpm` was installed under Rosetta (`darwin-x64`), `pnpm install` succeeds but `pnpm build` fails on `rolldown`/`lightningcss`/`oxlint` native bindings. Fix: `node scripts/setup.mjs` (reinstalls correct arch) or `npm exec pnpm@10.16.1 -- install`. Detect with `node -p process.arch` vs `pnpm --version` arch.

### Quick start (VS Code)

`Terminal → Run Task` (`⇧⌘B` / `Ctrl+Shift+B`) — **59 tasks** mirror every CLI below:

- `Setup: everything` — start here (submodules + install + CMake). `Setup: everything (web only, no C++)` for frontend-only.
- `Web: Dev server` → Vite, `Build` (default `build`), `Lint`/`Format check`/`Format write`, `Test (watch)`/`Test (run once)` (default `test`)/`Test coverage`/`E2E test`/`Storybook`/`Full check (lint+format+build+test+e2e)` (mirrors `ci.yml`).
- `C++: Init submodules` → `C++: Configure` → `C++: Build` → `C++: Test` (+ `Setup & run everything (web + C++)`).
- `Desktop: Configure (with tests)` → `Desktop: Build` → `Desktop: C++ tests` → `Desktop: Dev (Debug build + launch)` / `Dev (fast)` / `Dev (attach to web dev server)` → `Dev: web + desktop (parallel)` → `Build: web + desktop` → `Desktop: Package` → `Desktop: Full check`.
- `VST: Configure (Release/Debug)` → `VST: Build (×2)` → `VST: Build CLAP`/`AU` → `VST: Test` → `VST: Full check` → `VST: Standalone` → `VST: Install bundle (macOS)`/`Install CLAP`/`Install AU` → `VST: Reveal VST3 bundle` → **`VST: Export (all-in-one) — web + VST3/CLAP/AU + install`** (one-click: web UI, SDK fetch, all three formats, ctest, install) → `VST: Generate design tokens (CSS/C++ header/all)` → `VST: Design tokens drift check` → `VST: TSan build & test` → `VST: RTSan build & test (Clang 18+)` → `VST: Validators`.
- Drift/WASM: **`Drift: all checks (matches ci.yml)`** runs all six guards in CI order; individual tasks are `Drift: gen-param-schema --check` / `--target=automation-map`, `check-grid-dims --check`, `check-wasm-exports --check`, `sync-version --check`, plus `WASM: Build core` and `Build Storybook`.

See [`.vscode/tasks.json`](./.vscode/tasks.json) for the full list and `AGENTS.md#Verification commands` for the CLI equivalents.

### pnpm scripts (run at repo root — Turborepo fans out)

| Script                                    | Purpose                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| `pnpm dev` / `pnpm dev:web`               | Vite dev server (`apps/web`) — no C++ toolchain needed                         |
| `pnpm dev:desktop`                        | Debug-build and launch native desktop app (`apps/desktop`)                     |
| `pnpm dev:desktop:attach`                 | Same, pointed at Vite dev server (`OPENAXE_UI_URL=http://localhost:5173`, HMR) |
| `pnpm dev:all`                            | Both dev targets in parallel                                                   |
| `pnpm build` / `pnpm build:web`           | Typecheck + production build of web app + `packages/ui`                        |
| `pnpm build:desktop`                      | Release build of native desktop app + bundled UI                               |
| `pnpm build:all`                          | Web + desktop (all Turbo `build` targets)                                      |
| `pnpm package:desktop`                    | Desktop build + CPack installer (`.dmg` / `.zip` / `.deb`)                     |
| `pnpm lint`                               | oxlint                                                                         |
| `pnpm check:grid`                         | Drift: `node scripts/check-grid-dims.mjs`                                      |
| `pnpm format` / `pnpm format:check`       | Prettier                                                                       |
| `pnpm test` / `pnpm test:run`             | Vitest (watch / one-shot)                                                      |
| `pnpm test:e2e`                           | Playwright E2E (real `AudioContext` — jsdom can't)                             |
| `pnpm storybook` / `pnpm build-storybook` | Storybook dev server / static build (`packages/ui`)                            |

`pnpm dev`/`build` cover **web only**; `:desktop`/`:all` opt into native. The two apps are independent — `pnpm dev:all` or two terminals side-by-side; desktop serves bundled UI on ephemeral loopback, never collides with Vite 5173.

### Drift guards (run if you touch duplicated values)

| Check                                         | Command                                                                                                                        | Fix                                                                     | When                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Param schema (web ↔ core + plugin automation) | `node scripts/gen-param-schema.mjs --check` (+ `--target=automation-map` for `packages/vst3/generated/automation_param_map.h`) | remove `--check`                                                        | Edit `packages/core/param_schema.json` / `apps/web/src/effects/paramSchema.ts` / `api.h` ranges |
| Grid dims (TS ↔ C++ `4×10`)                   | `node scripts/check-grid-dims.mjs --check`                                                                                     | `--fix`                                                                 | Edit `apps/web/src/engine/gridConfig.ts` or `packages/core/include/openaxe/grid_config.h`       |
| WASM exports                                  | `node scripts/check-wasm-exports.mjs --check`                                                                                  | `--fix` rewrites `EXPORTED_FUNCTIONS` in `packages/core/CMakeLists.txt` | Add `_nam_studio_*` symbol called from JS                                                       |
| Version sync                                  | `node scripts/sync-version.mjs --check`                                                                                        | run without flag (syncs `VERSION` → 5 `package.json` + CMake)           | Bump version (don't edit `package.json` manually)                                               |
| Design tokens                                 | `node packages/ui/scripts/generate-tokens.mjs --check` (`--target=css`/`cpp`)                                                  | run without flag                                                        | Edit `packages/ui/tokens/design-tokens.json`                                                    |

CI runs all five on every push/PR (`ci.yml`). Locally run the `Drift: * --check` tasks or the commands above.

### C++ DSP core (`packages/core`)

Not part of pnpm/Turborepo — CMake/CTest:

```bash
# One-time: pull vendored DSP library submodules (selective, fast)
node scripts/setup.mjs --submodules-only
# or manually:
git submodule update --init --recursive -- packages/core/third_party/nam-core
git -C packages/core/third_party/dragonfly-reverb submodule update --init --depth 1 -- dpf

cmake -S packages/core -B packages/core/build -DOPENAXE_BUILD_TESTS=ON -DCMAKE_BUILD_TYPE=Debug
cmake --build packages/core/build
ctest --test-dir packages/core/build --output-on-failure
```

VS Code: `C++: Init submodules` → `C++: Configure` → `C++: Build` → `C++: Test` (each depends on previous).

See [packages/core/README.md](./packages/core/README.md) for what's implemented (graph engine, NAM inference, all 4 Dragonfly Reverb algorithms), vendored-library licensing, and gotchas.

#### WASM build (manual, Emscripten)

```bash
bash scripts/build-core-wasm.sh   # needs emsdk on PATH — overwrites apps/web/public/wasm-core/{js,wasm}
```

Run after changing `packages/core/include/openaxe/api.h` or `EXPORTED_FUNCTIONS`. Check diff (or lack thereof). Guarded by `node scripts/check-wasm-exports.mjs --check` in CI.

### Desktop app (`apps/desktop`)

Native shell reuses web UI, drives `packages/core` directly (no Web Audio). See [apps/desktop/README.md](./apps/desktop/README.md) for full command list + debugging.

```bash
pnpm dev:desktop          # Debug build + bundle UI + launch window
pnpm build:desktop        # Release build + bundle UI
pnpm package:desktop      # build + CPack -> build/openaxe-desktop-<v>.dmg|.zip|.deb

# Side by side with Vite HMR:
pnpm dev:web              # terminal 1
pnpm dev:desktop:attach   # terminal 2 (OPENAXE_UI_URL=http://localhost:5173)

# C++ tests (needs OPENAXE_DESKTOP_BUILD_TESTS=ON):
cmake -S apps/desktop -B apps/desktop/build -DOPENAXE_DESKTOP_BUILD_TESTS=ON -DCMAKE_BUILD_TYPE=Debug
cmake --build apps/desktop/build
ctest --test-dir apps/desktop/build --output-on-failure   # audio_io, bridge, latency
```

VS Code: `Desktop: Configure (with tests)` → `Desktop: Build` → `Desktop: C++ tests` → `Desktop: Dev (×3 variants)` → `Dev: web + desktop (parallel)` → `Build: web + desktop` → `Desktop: Package` → `Desktop: Full check`.

Debugging: `apps/desktop/build/bin/openaxe_desktop.log` (mirrors stderr + backtrace on segfault), `OPENAXE_DESKTOP_DEBUG=1` enables webview inspector, `~/Library/Logs/DiagnosticReports/openaxe_desktop-*.crash`, or `lldb -- build/bin/openaxe_desktop`. Full guide in [desktop README](./apps/desktop/README.md#debugging).

### VST3 / CLAP / AU plugin (`packages/vst3`)

iPlug2 + `packages/core` (`WHOLE_ARCHIVE`) + **React webview** — the same `apps/web` SPA as web and desktop, no IGraphics fork. Metal/NanoVG on macOS. See [packages/vst3/README.md](./packages/vst3/README.md).

How the editor is wired (issue #300):

- **The UI ships inside the bundle.** Each plugin target copies `apps/web/dist`
  into `Contents/Resources/ui` as a build step, and `src/ui_root.cpp` finds it at
  runtime via `dladdr` on the plugin's own module — so it works wherever the host
  loaded the bundle from. If you build the plugin without building the web app
  first you get a loud warning and the "UI not found" placeholder.
- **The bridge polyfill is served, not injected.** `src/http_server.cpp` splices
  `src/bridge_polyfill.cpp`'s script into `index.html` before the SPA's module
  scripts run. That ordering matters: the React app decides web-vs-native once,
  at module scope, so a polyfill injected after page load would leave it on the
  Web Audio path — which made the host prompt for microphone access.
- **The app knows it's a plugin.** The polyfill publishes
  `window.openAxe.shell = "plugin"`, and `shellOwnsAudioDevice()` in
  `apps/web/src/native/openaxe.ts` gates the device pickers, power gate and
  buffer-size controls that the DAW owns instead.
- **The window is host-resizable** (`PLUG_HOST_RESIZE`, `EUIResizerMode::Size`),
  and the webview control is re-targeted rather than recreated, so a resize keeps
  the React tree.

`OPENAXE_UI_URL=http://127.0.0.1:5173` points the webview at Vite, but note the
polyfill can't be spliced into Vite's HTML, so the bridge is unavailable in that
mode until a Vite plugin does the same injection (#300 A1).

```bash
# One-click export (builds web UI, fetches SDKs if needed, builds VST3+CLAP+AU, tests, installs to ~/Library/Audio/Plug-Ins/*):
# VS Code: Tasks → VST: Export (all-in-one) — web + VST3/CLAP/AU + install

# Or manually:
pnpm build  # web UI for the plugin webview
cmake -S packages/vst3 -B packages/vst3/build -DCMAKE_BUILD_TYPE=Release
cmake --build packages/vst3/build --config Release -j      # VST3 (default)
cmake --build packages/vst3/build --target openaxe_clap --config Release  # CLAP
cmake --build packages/vst3/build --target openaxe_au --config Release     # AU (macOS)
ctest --test-dir packages/vst3/build --output-on-failure   # 15 non-validator tests: smoke, latency, suspend, param_surface, state, asset, realtime_safety, editor, primitives, grid, ui_serving, midi, app_storage, input_routing + validators (SKIP if the tool is absent)
# Sanitizers:
cmake -S packages/vst3 -B packages/vst3/build-tsan -DOPENAXE_VST3_ENABLE_TSAN=ON -DCMAKE_BUILD_TYPE=RelWithDebInfo && cmake --build packages/vst3/build-tsan && ctest --test-dir packages/vst3/build-tsan --output-on-failure # issue #130, Linux only
cmake -S packages/vst3 -B packages/vst3/build-rtsan -DOPENAXE_VST3_ENABLE_RTSAN=ON && cmake --build packages/vst3/build-rtsan && ctest --test-dir packages/vst3/build-rtsan --output-on-failure -R realtime # Clang 18+

# No DAW — builds OpenAxe.app on macOS, a bare binary elsewhere:
cmake --build packages/vst3/build --target openaxe_standalone && open packages/vst3/build/OpenAxe.app
# Dev HMR — point plugin webview at Vite:
# terminal 1: pnpm dev:web
# terminal 2: OPENAXE_UI_URL=http://127.0.0.1:5173 open /Applications/REAPER.app
```

VS Code: `VST: Configure (Release/Debug)` → `VST: Build (×2)` → `VST: Build CLAP`/`AU` → `VST: Test` → `VST: Full check` → `VST: Standalone` → `VST: Install bundle (macOS)` / `Install CLAP` / `Install AU` / `Reveal VST3 bundle` → **`VST: Export (all-in-one)`** → `Generate design tokens (CSS/C++ header/all)` → `Design tokens drift check` → `TSan`/`RTSan`/`Validators`.

Design tokens: `node packages/ui/scripts/generate-tokens.mjs [--target=css|cpp] [--check]`.

### Verification (what CI runs)

```bash
pnpm lint
pnpm format:check
pnpm build              # web + packages/ui (desktop excluded — separate job)
pnpm test:run
pnpm test:e2e           # needs: pnpm --filter @openaxe/web exec playwright install --with-deps chromium firefox webkit (once)
pnpm build-storybook
node scripts/gen-param-schema.mjs --check
node scripts/gen-param-schema.mjs --check --target=automation-map
node scripts/check-grid-dims.mjs --check
node scripts/check-wasm-exports.mjs --check
node scripts/sync-version.mjs --check
node packages/ui/scripts/generate-tokens.mjs --check
```

Or **Run Task** `Full check (lint + format + build + test + e2e)` + `C++: Test` + `Desktop: Full check` + `VST: Full check`. Branch protection requires all green on `main`/`dev` PRs.

### Branching

`feature/* → dev` via **squash** (one commit per feature). `dev → main` is the only PR targeting `main`; `auto-release.yml` then merges `main` back into `dev` automatically so `dev` never falls behind on `VERSION` and the next `dev→main` doesn't conflict on `added in both` files (see `CONTRIBUTING.md#Branching`). Releases cut from `main` (`VERSION` + `v*` tag → `auto-release.yml` → `release.yml`/`plugin.yml`).

## Roadmap

| #   | Epic                                                | Status   |
| --- | --------------------------------------------------- | -------- |
| 1   | Project scaffolding, tooling & licensing            | ✓ Closed |
| 2   | Audio engine core — NAM WASM integration            | ✓ Closed |
| 3   | Dual signal-chain / stereo architecture             | ✓ Closed |
| 4   | Effects suite                                       | ✓ Closed |
| 5   | Preset management (local-first)                     | ✓ Closed |
| 6   | Tone3000 integration                                | ✓ Closed |
| 7   | Guitar/bass tuner                                   | ✓ Closed |
| 8   | UI/UX & design system                               | ✓ Closed |
| 9   | Audio I/O management                                | ✓ Closed |
| 10  | Offline / PWA support                               | ✓ Closed |
| 11  | Testing, performance & QA                           | Open     |
| 12  | Deployment & release                                | Open     |
| 13  | Monorepo scaffold                                   | ✓ Closed |
| 14  | Shared C++ DSP core + best-in-class DSP libraries   | ✓ Closed |
| 15  | Desktop app (C++ + webview.h + JUCE)                | Live     |
| 16  | VST3/CLAP/AU/AAX Plugin (iPlug2, C++)               | Beta     |
| 17  | Mobile apps (native Kotlin/Swift + C++ shared core) | Open     |
| 18  | CI/CD cross-platform build pipeline                 | Live     |
| 21  | Design system: Storybook + CSS deduplication        | ✓ Closed |
| 22  | Web: WASM DSP migration (C++ Emscripten + SAB)      | ✓ Closed |

## License

[GPLv3](./LICENSE) — keeps this and any derivative work free and open. `Copyright (C) 2024-2026 OpenAxe Contributors`. The shared DSP core wraps GPLv3/LGPLv3/MIT/BSD-3 C++ libraries. iPlug2 (VST3/AU/AAX) is MIT. See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, branching, DCO sign-off, and licensing rules. Third-party notices: [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
