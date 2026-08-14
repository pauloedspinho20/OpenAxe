# NAM Web Studio

A free, open-source guitar/bass amp, cabinet, and effects suite — in the spirit of Amplitube / Guitar Rig — built on [Neural Amp Modeler](https://github.com/sdatkinson/NeuralAmpModelerCore) (NAM). Runs as a **web app** today; planned for **desktop**, **VST3/CLAP/AU/AAX plugin**, and **mobile** (iOS + Android) — all sharing the same C++ DSP engine and design system.

Runs entirely in the browser: no native app required, no backend, no account. Works offline once installed as a PWA.

## Project decisions

| Area               | Decision                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Distribution       | Free & open source, licensed [GPLv3](./LICENSE)                                                                                         |
| Stack              | Vite + React + TypeScript SPA (web) / C++ + webview.h (desktop) / iPlug2 (VST3) / native (mobile)                                       |
| Signal graph       | **Modular grid (GraphRig)** — blocks placed on a 3×8 grid, cabled left-to-right                                                         |
| Audio (web)        | AudioWorklet + WASM (C++ compiled via Emscripten, migrating to SAB lock-free params)                                                    |
| Audio (native)     | C++ DSP core → direct call (no FFI, no language bridge)                                                                                 |
| Shared DSP core    | **C++** — wraps Dragonfly Reverb, ChowTapeModel, BYOD, LSP Suite, NeuralAmpModelerCore, RTNeural                                        |
| State management   | [Zustand](https://github.com/pmndrs/zustand)                                                                                            |
| CSS                | CSS Modules + CSS custom properties (two hardware-inspired finishes: Carbon / Aluminum)                                                 |
| Persistence        | IndexedDB (web) / filesystem (desktop/mobile)                                                                                           |
| Monorepo (planned) | pnpm workspaces: `apps/web`, `apps/desktop`, `apps/ios`, `apps/android`, `packages/core` (C++), `packages/vst3` (iPlug2), `packages/ui` |

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

- **C++ for DSP core, not Rust** — All 6 DSP libraries are C++ (Dragonfly, ChowTapeModel, BYOD, LSP, NAMCore, RTNeural). Wrapping them in Rust requires 6 FFI layers for no algorithmic benefit. C++ compiles natively everywhere — desktop, VST3, iOS, Android, and WASM (via Emscripten). One language, no bridges between DSP and platform APIs.
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

| Effect        | Web (current)                | Shared DSP (#14)                                          | Web upgrade (#22) |
| ------------- | ---------------------------- | --------------------------------------------------------- | ----------------- |
| Noise Gate    | Custom AudioWorkletProcessor | LSP Gate (LGPLv3)                                         | LSP → WASM        |
| Compressor    | DynamicsCompressorNode       | LSP Compressor (LGPLv3) + Airwindows Pressure4 (MIT)      | LSP → WASM        |
| Parametric EQ | BiquadFilterNodes            | LSP Parametric EQ (LGPLv3, 16-band)                       | LSP → WASM        |
| Drive         | WaveShaperNode, 3 curves     | BYOD (GPLv3, 43+ models) + ChowCentaur (BSD-3)            | BYOD → WASM       |
| Chorus        | LFO-modulated DelayNode      | BYOD Chorus (GPLv3)                                       | BYOD → WASM       |
| Flanger       | LFO-modulated DelayNode      | BYOD Flanger (GPLv3)                                      | BYOD → WASM       |
| Phaser        | Allpass cascade              | ChowPhaser (BSD-3) or BYOD Phaser4/8 (GPLv3)              | ChowPhaser → WASM |
| Tremolo       | LFO × GainNode               | BYOD Tremolo (GPLv3)                                      | Evaluate          |
| Delay         | Feedback + tone filter       | ChowTapeModel (GPLv3, physical tape) + LSP Delay (LGPLv3) | ChowTape → WASM   |
| Ping-Pong     | Cross-coupled delay          | Keep as native routing                                    | Keep native nodes |
| Reverb        | Freeverb (1993 algorithm)    | Dragonfly Reverb (GPLv3, hall/room/plate/studio)          | Dragonfly → WASM  |

### Amp modeling

| Target            | Library                                 | Integration                            |
| ----------------- | --------------------------------------- | -------------------------------------- |
| **All platforms** | NeuralAmpModelerCore (MIT, C++)         | Direct C++ link — same code everywhere |
| **Web**           | NAMCore compiled to WASM via Emscripten | AudioWorklet + SAB params              |
| **Neural pedals** | RTNeural (BSD-3, C++)                   | Direct C++ link                        |

### Design system

Two hardware finishes: **Carbon** (dark, TX-6-style) and **Aluminum** (light, OP-1-style). 7 primitive components in `src/components/primitives/` (Knob, Fader, HardwareButton, Led, Meter, Toggle, Panel). Design tokens in CSS custom properties, generated to C++/Kotlin/Swift constants for other platforms.

## Project structure

```
NAM-Web-Studio/
├── src/
│   ├── components/           # React UI
│   │   ├── primitives/       # Design-system components
│   │   ├── grid/             # Signal graph grid editor
│   │   ├── scenes/           # Scene bar and manager
│   │   ├── midi/             # MIDI manager
│   │   └── presets/          # Preset browser
│   ├── effects/              # 10 audio effect DSP modules
│   ├── engine/               # Audio engine (GraphRig, AudioContext lifecycle)
│   ├── hooks/                # React hooks
│   ├── midi/                 # MIDI message handling
│   ├── presets/              # Preset capture, storage, sharing
│   ├── scenes/               # Scene bank
│   ├── settings/             # App settings
│   ├── state/                # Zustand stores
│   ├── storage/              # IndexedDB
│   ├── test/                 # Vitest setup
│   ├── tone3000/             # Tone3000 API
│   └── tuner/                # Pitch detection
├── e2e/                      # Playwright E2E tests
└── .github/workflows/        # CI
```

### Planned monorepo structure (#13)

```
NAM-Web-Studio/
├── apps/
│   ├── web/              # Current Vite + React app
│   ├── desktop/          # C++ + webview.h (or Tauri v2) + React UI
│   ├── ios/              # SwiftUI + C++ via ObjC++ bridge
│   └── android/          # Jetpack Compose + C++ via JNI
├── packages/
│   ├── core/             # C++ library: NAM DSP, effects, audio graph
│   │   └── third_party/  # Dragonfly, ChowTape, BYOD, LSP, NAMCore, RTNeural
│   ├── vst3/             # iPlug2 (C++) VST3/CLAP/AU/AAX plugin
│   └── ui/               # React component library + design tokens + Storybook
│       └── tokens/       # design-tokens.json → CSS/C++/Kotlin/Swift generator
├── CMakeLists.txt        # Top-level C++ build
├── pnpm-workspace.yaml
└── turbo.json
```

## Development

```bash
npm install --legacy-peer-deps
npm run dev
```

| Script                            | Purpose                      |
| --------------------------------- | ---------------------------- |
| `npm run dev`                     | Start Vite dev server        |
| `npm run build`                   | Typecheck + production build |
| `npm run lint`                    | oxlint                       |
| `npm run format` / `format:check` | Prettier                     |
| `npm run test` / `test:run`       | Vitest                       |
| `npm run test:e2e`                | Playwright E2E               |

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
