# packages/core

Shared C++ DSP core — a single library housing all audio DSP and graph logic,
usable by every target with zero language bridges between DSP and platform
APIs (web via Emscripten/WASM, desktop, VST3/CLAP/AU/AAX, iOS, Android).

## What's real (issue #14, first PR)

- **Audio graph engine** (`include/nam_studio/{grid_config,block,graph_validation,graph_rig}.h`
  - matching `src/*.cpp`) — an original, dependency-free C++ port of the
    app's existing TypeScript graph engine (`apps/web/src/engine/GraphRig.ts`
    and friends). Blocks live on a grid, wired left-to-right by column;
    column ordering alone makes cycles structurally impossible, so there's no
    topological sort anywhere. Deliberately excludes anything Web-Audio- or
    real-time-processing-specific from the TS original (live node wiring,
    analyser taps, master bus, params) — this is the topology/bookkeeping
    layer only.
- **NAM inference wrapper** (`include/nam_studio/dsp/nam_amp.h` +
  `src/dsp/nam_amp.cpp`) — wraps NeuralAmpModelerCore's `nam::DSP`, exposing
  model loading, sample-rate-aware reset, real-time process, input/output
  level calibration (dBu), loudness, and slim-size quality control as a
  clean C++ class (`nam_studio::dsp::NamAmp`).
- **`extern "C"` API** (`include/nam_studio/api.h` + `src/api.cpp`) — opaque
  `NamStudioGraph` handle, lifecycle only (`nam_studio_graph_create`/
  `_destroy`). Real-time entrypoints (`nam_studio_process`,
  `nam_studio_load_nam_model`, etc.) aren't declared yet — that needs a
  real-time audio wiring design this PR doesn't attempt, and declaring an
  ABI before that design exists would just be something to break later.
- `include/nam_studio/core.h` + `src/core.cpp` — the pre-existing #13
  placeholder (`nam_studio::core::version()`), unchanged.

**Test suite** (`tests/`, CTest): `graph_validation_test` and `graph_rig_test`
port the boundary-value matrix from `graphValidation.test.ts`/
`GraphRig.test.ts` almost 1:1. `api_test` checks handle lifecycle.
`nam_amp_test` is a real integration test — it loads an actual `.nam` model
bundled with the vendored NeuralAmpModelerCore submodule
(`third_party/nam-core/example_models/lstm.nam`), resets it, processes an
impulse through it, and asserts every output sample is finite.

## Vendored third-party DSP libraries

All added as git submodules under `third_party/`. Two of the five URLs in
issue #14's original text were wrong/renamed — corrected here after
verifying each repo directly on GitHub:

| Path                | Upstream                                                                                  | License | Wired into the build?             |
| ------------------- | ----------------------------------------------------------------------------------------- | ------- | --------------------------------- |
| `nam-core`          | [`sdatkinson/NeuralAmpModelerCore`](https://github.com/sdatkinson/NeuralAmpModelerCore)   | MIT     | **Yes** — see `nam_amp.cpp` above |
| `dragonfly-reverb`  | [`michaelwillis/dragonfly-reverb`](https://github.com/michaelwillis/dragonfly-reverb)     | GPLv3   | No                                |
| `analog-tape-model` | [`jatinchowdhury18/AnalogTapeModel`](https://github.com/jatinchowdhury18/AnalogTapeModel) | GPLv3   | No                                |
| `byod`              | [`Chowdhury-DSP/BYOD`](https://github.com/Chowdhury-DSP/BYOD)                             | GPLv3   | No                                |
| `lsp-plugins`       | [`lsp-plugins/lsp-plugins`](https://github.com/lsp-plugins/lsp-plugins)                   | LGPLv3  | No                                |

`nam-core` additionally vendors its own nested submodules (Eigen from
`gitlab.com/libeigen/eigen`, plus `AudioDSPTools`) — after cloning this repo,
run:

```bash
git submodule update --init --recursive -- packages/core/third_party/nam-core
```

The other four libraries are registered but not initialized/built — no
`third_party/CMakeLists.txt` exists yet, since each has real build-flag
decisions (Dragonfly Reverb's upstream dependency on DPF/DISTRHO plugin
scaffolding, BYOD/AnalogTapeModel both being JUCE-based plugins whose DSP
classes need extracting independently of their surrounding plugin/app
scaffolding, LSP's own build system) that belong with whichever PR actually
wraps each one.

**RTNeural was evaluated and deliberately dropped, not vendored.** It's a
generic neural-inference engine (no built-in amp/pedal-specific behavior at
all) used elsewhere in the Chowdhury-DSP ecosystem for standalone
neural-pedal captures (e.g. a Klon Centaur emulation). This project doesn't
need a second neural engine for that: pedal/outboard gear will be modeled
as NAM captures too (NAM's format isn't amp-specific — it captures any
nonlinear audio device), reusing the same `NamAmp` wrapper and graph engine
already built here rather than adding a second, narrower inference engine
alongside it.

This also means the remaining four libraries' effect wrapping doesn't
depend on RTNeural, despite two of them referencing it as their own nested
submodule: BYOD (`modules/RTNeural`) and AnalogTapeModel
(`Plugin/modules/RTNeural`) both pull it in for a few of their neural/
Centaur-style optional modules, but the bulk of both libraries' effects
(diode clippers, tube/transistor stages, tape hysteresis and wow/flutter)
are pure DSP with no neural component. Wrapping those means extracting the
specific DSP processor class(es) for the chosen effect directly — the same
pattern already used for NAMCore (glob just the DSP sources, skip the
plugin/tool/test scaffolding) — which naturally avoids RTNeural, JUCE, and
each library's other plugin-framework dependencies entirely. Dragonfly
Reverb (DPF-based, no RTNeural) and LSP Suite (no git submodules at all)
don't raise this concern in the first place.

## Non-goals (not yet — tracked for follow-up work)

- DSP wrappers for the other four libraries (reverb, tape delay/drive,
  compression/EQ).
- `extern "C"` audio-processing entrypoints (process, load-model,
  parameters) — needs a real-time wiring design first.
- Wiring the graph engine and the NAM wrapper together (they're independent,
  both tested, but not yet unified behind one API).
- Preset/JSON (de)serialization.
- WASM/browser UI wiring — Emscripten isn't installed in the environment
  this was built in (see below), so there's nothing to wire yet.

## Build verification status

**Native (macOS, this environment): verified, not just authored.** CMake
4.4.2 (installed via CMake.app, not on `PATH` — use the full path,
`/Applications/CMake.app/Contents/bin/cmake`) configures, builds, and runs
the full CTest suite (4/4 passing, including the real NAM model
load-and-process test) against Debug builds:

```bash
CMAKE=/Applications/CMake.app/Contents/bin/cmake
$CMAKE -S packages/core -B packages/core/build -DNAM_STUDIO_BUILD_TESTS=ON -DCMAKE_BUILD_TYPE=Debug
$CMAKE --build packages/core/build
$CMAKE --build packages/core/build --target test  # or: ctest --test-dir packages/core/build
```

**Emscripten/iOS/Android: still unverified** — those toolchains aren't
installed in this environment. The `if(EMSCRIPTEN)`/iOS/Android branches in
`CMakeLists.txt` are unchanged from #13's scaffold and remain
authored-but-untested.

### A gotcha worth knowing if you extend this

`nam_studio_core` is a `STATIC` library. NeuralAmpModelerCore's architecture
parsers (LSTM, WaveNet, ConvNet, Linear) each self-register via a static
initializer with no other symbol anything here calls directly. A plain
static-archive link only pulls in object files that resolve a currently
undefined symbol, so those registration-only translation units get silently
dropped — `get_dsp()` then fails at runtime with "No config parser
registered for architecture: ...". Any executable that needs NAM model
loading to actually work must link `nam_studio_core` with whole-archive
semantics, e.g. `$<LINK_LIBRARY:WHOLE_ARCHIVE,nam_studio_core>` (CMake
3.24+, portable across GNU/Apple/MSVC linkers) — see `tests/CMakeLists.txt`
for the pattern `nam_amp_test` uses.

## Build targets (native verified; others authored, not yet buildable here)

```bash
# Native desktop (macOS, Windows, Linux) - the one verified above
cmake -B build/native -DCMAKE_BUILD_TYPE=Release
cmake --build build/native

# WASM (web, via Emscripten) - unverified, emcc not installed here
emcmake cmake -B build/wasm -DCMAKE_BUILD_TYPE=Release
cmake --build build/wasm

# iOS - unverified
cmake -B build/ios -G Xcode -DCMAKE_SYSTEM_NAME=iOS
cmake --build build/ios

# Android (via NDK) - unverified
cmake -B build/android -DCMAKE_TOOLCHAIN_FILE=$NDK/build/cmake/android.toolchain.cmake \
      -DANDROID_ABI=arm64-v8a
cmake --build build/android
```
