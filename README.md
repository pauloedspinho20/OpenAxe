# NAM Web Studio

A free, open-source guitar/bass amp, cabinet, and effects suite — in the spirit of Amplitube / Guitar Rig — built on [Neural Amp Modeler](https://github.com/sdatkinson/NeuralAmpModelerCore) (NAM). Runs as a **web app** today; planned for **desktop**, **VST3/CLAP/AU/AAX plugin**, and **mobile** (iOS + Android) — all sharing the same C++ DSP engine and design system.

Runs entirely in the browser: no native app required, no backend, no account. Works offline once installed as a PWA.

## Project decisions

| Area             | Decision                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Distribution     | Free & open source, licensed [GPLv3](./LICENSE)                                                                                                                     |
| Stack            | Vite + React + TypeScript SPA (web) / C++ + webview.h (desktop) / iPlug2 (VST3) / native (mobile)                                                                   |
| Signal graph     | **Modular grid (GraphRig)** — blocks placed on a 3×8 grid, cabled left-to-right                                                                                     |
| Audio (web)      | AudioWorklet + WASM (C++ compiled via Emscripten, migrating to SAB lock-free params)                                                                                |
| Audio (native)   | C++ DSP core → direct call (no FFI, no language bridge)                                                                                                             |
| Shared DSP core  | **C++** — wraps Dragonfly Reverb, AnalogTapeModel, BYOD, LSP Suite, NeuralAmpModelerCore (pedals/outboard gear also modeled as NAM captures, not a separate engine) |
| State management | [Zustand](https://github.com/pmndrs/zustand)                                                                                                                        |
| CSS              | CSS Modules + CSS custom properties (two hardware-inspired finishes: Carbon / Aluminum)                                                                             |
| Persistence      | IndexedDB (web) / filesystem (desktop/mobile)                                                                                                                       |
| Monorepo (#13)   | pnpm + Turborepo workspaces: `apps/web`, `apps/desktop`, `apps/ios`, `apps/android`, `packages/core` (C++), `packages/vst3` (iPlug2), `packages/ui`                 |

## Platform targets

| Target               | Status  | Tech                                                            | Latency Target          | Issue                                                              |
| -------------------- | ------- | --------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------ |
| **Web**              | Live    | Vite + React + AudioWorklet + WASM                              | ~15ms round-trip        | —                                                                  |
| **Web DSP upgrade**  | Planned | C++ → Emscripten → WASM + SAB params                            | Same, higher quality    | [#22](https://github.com/pauloedspinho20/NAM-Web-Studio/issues/22) |
| **Desktop**          | Planned | C++ + webview.h (or Tauri v2) + React UI                        | <5ms round-trip         | [#15](https://github.com/pauloedspinho20/NAM-Web-Studio/issues/15) |
| **VST3/CLAP/AU/AAX** | Planned | iPlug2 (C++) + custom IGraphics editor                          | <5ms (DAW audio thread) | [#16](https://github.com/pauloedspinho20/NAM-Web-Studio/issues/16) |
| **iOS**              | Planned | SwiftUI + CoreAudio + C++ via ObjC++ bridge                     | 5-8ms round-trip        | [#17](https://github.com/pauloedspinho20/NAM-Web-Studio/issues/17) |
| **Android**          | Planned | Jetpack Compose + AAudio/Oboe + C++ via JNI                     | ~20ms round-trip        | [#17](https://github.com/pauloedspinho20/NAM-Web-Studio/issues/17) |
| **Shared DSP**       | Planned | C++ library with extern "C" API                                 | —                       | [#14](https://github.com/pauloedspinho20/NAM-Web-Studio/issues/14) |
| **Design System**    | Planned | Storybook + extracted `packages/ui/` with design token pipeline | —                       | [#21](https://github.com/pauloedspinho20/NAM-Web-Studio/issues/21) |

### Why these choices

- **C++ for DSP core, not Rust** — All 5 DSP libraries are C++ (Dragonfly, AnalogTapeModel, BYOD, LSP, NAMCore). Wrapping them in Rust requires 5 FFI layers for no algorithmic benefit. C++ compiles natively everywhere — desktop, VST3, iOS, Android, and WASM (via Emscripten). One language, no bridges between DSP and platform APIs.
- **Desktop: C++ + webview.h, not Electron** — React UI runs in a native system webview, same process as audio engine. Zero IPC overhead for parameter changes. 5-10MB binary vs 150MB+. Tauri v2 kept as an alternative for its bundling/signing tooling.
- **VST3: iPlug2 (C++, MIT), not JUCE** — Direct C++ DSP integration. MIT license avoids JUCE's proprietary/AGPL restrictions. Supports VST3, CLAP, AU, AAX Native. iOS/AUv3 for mobile. WebAudio Module (WAM) for browser.
- **Mobile: Native shells, not Tauri v2 mobile or React Native** — C++ DSP runs directly on the device's audio hardware via JNI (Android) and ObjC++ bridge (iOS). No WASM runtime, no webview, no JS bridge in the audio path.

### What every platform shares

- **C++ DSP core** (`packages/core/`) — NAM inference, 10 effects, audio graph logic. Exposed via `extern "C"` API for maximum portability. Wraps best-in-class C++ libraries.
- **Design tokens** — Single source of truth (`packages/ui/tokens/design-tokens.json`) generating CSS custom properties (web/desktop), C++ constants (VST3 iPlug2), Kotlin constants (Android Compose), Swift constants (iOS SwiftUI).
- **React components** — Shared between web and desktop (webview). VST3 and mobile reimplement primitives natively (IGraphics widgets, Compose/SwiftUI views) consuming the same tokens.

## Architecture

### Signal graph (GraphRig)

```
                                                          ┌──────────────────────────────┐
  Input ─► [IN rail] ─► Block ─► Block ─► Block ─► ... ─► [OUT rail] ─► Master bus ─► Output
 (mic/       (left)    (Amp/A)  (Gate)   (Delay)          (right)        (level/mute)
interface)
```

- **Block types**: `Amp` (NAM model via NeuralAmpModelerCore), `Cab` (IR convolution), 10 effects, `Mixer`, `Splitter`
- Blocks sit on a **3-row × 8-column grid** with IN/OUT rails
- Graph validates connections for feedback loops; automatic semi-smart wiring on block placement

### Effects suite

| Effect        | Web (current)                | Shared DSP (#14)                                                              | Web upgrade (#22) |
| ------------- | ---------------------------- | ----------------------------------------------------------------------------- | ----------------- |
| Noise Gate    | Custom AudioWorkletProcessor | LSP Gate (LGPLv3)                                                             | LSP → WASM        |
| Compressor    | DynamicsCompressorNode       | LSP Compressor (LGPLv3) + Airwindows Pressure4 (MIT)                          | LSP → WASM        |
| Parametric EQ | BiquadFilterNodes            | LSP Parametric EQ (LGPLv3, 16-band)                                           | LSP → WASM        |
| Drive         | WaveShaperNode, 3 curves     | BYOD (GPLv3, 43+ models) + ChowCentaur (BSD-3)                                | BYOD → WASM       |
| Chorus        | LFO-modulated DelayNode      | BYOD Chorus (GPLv3)                                                           | BYOD → WASM       |
| Flanger       | LFO-modulated DelayNode      | BYOD Flanger (GPLv3)                                                          | BYOD → WASM       |
| Phaser        | Allpass cascade              | ChowPhaser (BSD-3) or BYOD Phaser4/8 (GPLv3)                                  | ChowPhaser → WASM |
| Tremolo       | LFO × GainNode               | BYOD Tremolo (GPLv3)                                                          | Evaluate          |
| Delay         | Feedback + tone filter       | AnalogTapeModel (GPLv3, physical tape) + LSP Delay (LGPLv3)                   | ChowTape → WASM   |
| Ping-Pong     | Cross-coupled delay          | Keep as native routing                                                        | Keep native nodes |
| Reverb        | Freeverb (1993 algorithm)    | ✓ Dragonfly Reverb (GPLv3, hall/room/plate/early-reflections — all 4 wrapped) | Dragonfly → WASM  |

### Amp modeling

| Target              | Library                                 | Integration                                                                                                                                                       |
| ------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **All platforms**   | NeuralAmpModelerCore (MIT, C++)         | ✓ Direct C++ link — same code everywhere                                                                                                                          |
| **Web**             | NAMCore compiled to WASM via Emscripten | AudioWorklet + SAB params                                                                                                                                         |
| **Pedals/outboard** | NeuralAmpModelerCore (MIT, C++)         | Same engine, not a separate one — NAM's format isn't amp-specific, so pedal captures reuse the amp wrapper directly (RTNeural was evaluated and dropped for this) |

### Design system

Two hardware finishes: **Carbon** (dark, TX-6-style) and **Aluminum** (light, OP-1-style). 7 primitive components in `packages/ui/src/primitives/` (Knob, Fader, HardwareButton, Led, Meter, Toggle, Panel). Design tokens in CSS custom properties, transcribed into `packages/ui/tokens/design-tokens.json`; a generator to C++/Kotlin/Swift constants for other platforms is future work.

## Project structure

pnpm + Turborepo monorepo (#13). `apps/ios`, `apps/android`, and `packages/vst3` are placeholders — each holds a README pointing at the issue that builds it out (#17, #17, #16); `apps/desktop` is a working native shell (see above); `packages/core` has a real, tested C++ audio graph engine, full NAM inference wrapper, and all four Dragonfly Reverb algorithms, with three more DSP libraries still to wrap (#14).

```
NAM-Web-Studio/
├── apps/
│   ├── web/                  # Vite + React app (the current live product)
│   │   ├── src/
│   │   │   ├── components/       # App-specific React UI (grid, global, scenes, midi, presets...)
│   │   │   ├── effects/          # 10 audio effect DSP modules
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
│   ├── desktop/               # Native desktop shell — C++ + webview.h + React UI (#15), see apps/desktop/README.md
│   ├── ios/                   # Placeholder — SwiftUI + C++ via ObjC++ bridge (#17)
│   └── android/               # Placeholder — Jetpack Compose + C++ via JNI (#17)
├── packages/
│   ├── core/                  # C++ DSP library — graph engine, NAM, Dragonfly Reverb done (#14)
│   │   ├── include/nam_studio/    # Graph engine, dsp/ wrappers, extern "C" lifecycle API
│   │   ├── src/                   # Implementation + tests/ (CTest, all passing)
│   │   └── third_party/           # Dragonfly (wired), NAMCore (wired), AnalogTapeModel/BYOD/LSP (vendored, not yet wrapped)
│   ├── vst3/                   # Placeholder — iPlug2 (C++) VST3/CLAP/AU/AAX plugin (#16)
│   └── ui/                     # Shared React component library + design tokens
│       ├── src/primitives/         # Knob, Fader, HardwareButton, Led, Meter, Toggle, Panel
│       ├── src/shared/              # Dialog, FormField, OutlineButton, StatusText, Wordmark
│       └── tokens/                  # CSS custom properties + design-tokens.json
├── .storybook/                # Storybook, scans packages/ui stories
├── .github/workflows/         # CI
├── pnpm-workspace.yaml
└── turbo.json
```

## Development

### Requirements

- [Node.js](https://nodejs.org) 22+ and [pnpm](https://pnpm.io) (`corepack enable`, or install directly) — for `apps/web` and `packages/ui`.
- [CMake](https://cmake.org) 3.22+ and a C++20 compiler (Clang, GCC, or MSVC) — for `packages/core`, the shared C++ DSP library (#14). Not needed for pure web-app work. On macOS, if you installed CMake via CMake.app rather than Homebrew, run **Tools → How to Install For Command Line Use** from CMake.app first, or the `cmake` command below won't resolve.
- Git — the vendored DSP libraries under `packages/core/third_party/` are git submodules; see below to initialize them.

```bash
pnpm install
pnpm dev
```

Scripts run at the repo root via Turborepo, fanning out to the relevant workspace package (currently `apps/web`, `packages/ui`):

| Script                                    | Purpose                                             |
| ----------------------------------------- | --------------------------------------------------- |
| `pnpm dev`                                | Start Vite dev server (`apps/web`)                  |
| `pnpm build`                              | Typecheck + production build                        |
| `pnpm lint`                               | oxlint                                              |
| `pnpm format` / `pnpm format:check`       | Prettier                                            |
| `pnpm test` / `pnpm test:run`             | Vitest                                              |
| `pnpm test:e2e`                           | Playwright E2E                                      |
| `pnpm storybook` / `pnpm build-storybook` | Storybook dev server / static build (`packages/ui`) |

### C++ DSP core (`packages/core`)

Not part of the pnpm/Turborepo workspace — built and tested independently with CMake/CTest:

```bash
# One-time: pull in the vendored DSP library submodules
git submodule update --init --recursive -- packages/core/third_party/nam-core
git -C packages/core/third_party/dragonfly-reverb submodule update --init --depth 1 -- dpf

# Configure, build, and run the test suite
cmake -S packages/core -B packages/core/build -DNAM_STUDIO_BUILD_TESTS=ON
cmake --build packages/core/build
ctest --test-dir packages/core/build --output-on-failure
```

VS Code users: the same steps are available as tasks (**Terminal → Run Task**) — `C++: Init submodules`, `C++: Configure`, `C++: Build`, `C++: Test`, each depending on the previous.

See [packages/core/README.md](./packages/core/README.md) for what's implemented so far (audio graph engine, NAM inference, all four Dragonfly Reverb algorithms), vendored-library licensing, and known build gotchas.

### Desktop app (`apps/desktop`, issue #15)

The native desktop shell reuses the web UI and drives `packages/core` directly (no Web Audio in the audio path). See [apps/desktop/README.md](./apps/desktop/README.md) for architecture, the full command list, and a debugging guide.

```bash
pnpm --filter @nam/desktop dev      # Debug build + bundle UI + launch the window
pnpm --filter @nam/desktop build    # Release build + bundle UI
pnpm --filter @nam/desktop package  # build + CPack -> build/nam-studio-desktop-<v>.dmg|.zip|.deb

# C++ tests (configure once with NAM_DESKTOP_BUILD_TESTS=ON):
cmake -S apps/desktop -B apps/desktop/build -DNAM_DESKTOP_BUILD_TESTS=ON -DCMAKE_BUILD_TYPE=Debug
cmake --build apps/desktop/build
ctest --test-dir apps/desktop/build --output-on-failure   # audio_io, bridge, latency
```

Debugging a random crash: read `apps/desktop/build/bin/nam_desktop.log` (mirrors stderr, appends a backtrace on a segfault/abort), run with `NAM_DESKTOP_DEBUG=1` to enable the webview inspector, or grab the OS crash report from `~/Library/Logs/DiagnosticReports/nam_desktop-*.crash`. Full details in the [desktop README](./apps/desktop/README.md#debugging).

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
| 10  | Offline / PWA support                               | Open     |
| 11  | Testing, performance & QA                           | Open     |
| 12  | Deployment & release                                | Open     |
| 13  | Monorepo scaffold                                   | Open     |
| 14  | Shared C++ DSP core + best-in-class DSP libraries   | Open     |
| 15  | Desktop app (C++ + webview.h / Tauri v2)            | Open     |
| 16  | VST3/CLAP/AU/AAX Plugin (iPlug2, C++)               | Open     |
| 17  | Mobile apps (native Kotlin/Swift + C++ shared core) | Open     |
| 18  | CI/CD cross-platform build pipeline                 | Open     |
| 21  | Design system: Storybook + CSS deduplication        | Open     |
| 22  | Web: WASM DSP migration (C++ Emscripten + SAB)      | Open     |

## License

[GPLv3](./LICENSE) — keeps this and any derivative work free and open. The shared DSP core wraps GPLv3/LGPLv3/MIT/BSD-3 C++ libraries. iPlug2 (VST3/AU/AAX) is MIT. See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup instructions and licensing rules.
