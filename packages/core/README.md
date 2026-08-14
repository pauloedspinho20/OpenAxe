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
- **All four Dragonfly Reverb algorithms** (`include/nam_studio/dsp/dragonfly_{hall,room,plate,early_reflections}_reverb.h`
  - matching `src/dsp/*.cpp`) — wrap each of Dragonfly's `DragonflyReverbDSP`
    classes (freeverb3-based), exposing their full parameter surfaces:
    `DragonflyHallReverb` (18 params: dry/early/late levels, size, width,
    predelay, diffuse, low/high cut+crossover+multiplier, spin, wander, decay,
    early send, modulation), `DragonflyRoomReverb` (17 params, its own
    size/damping/boost controls), `DragonflyPlateReverb` (9 params, including
    an algorithm selector across its 3 internal plate models), and
    `DragonflyEarlyReflections` (7 params, no late-reverb tail — just the
    discrete early-reflection pattern). Stereo. Replaces the app's current
    basic Freeverb effect with a full modulated, frequency-dependent-decay
    reverb suite.
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
`dragonfly_{hall,room,plate,early_reflections}_reverb_test` each sweep every
one of that algorithm's parameters to their min/max and process a real
stereo impulse through it, asserting a genuine non-silent, finite reverb
tail comes out. `dragonfly_all_algorithms_test` constructs and processes
audio through all four algorithms in one executable - the actual regression
test for the symbol-isolation fix described below (linking any two would
have failed with duplicate symbols before that fix).

## Vendored third-party DSP libraries

All added as git submodules under `third_party/`. Two of the five URLs in
issue #14's original text were wrong/renamed — corrected here after
verifying each repo directly on GitHub:

| Path                | Upstream                                                                                  | License | Wired into the build?                           |
| ------------------- | ----------------------------------------------------------------------------------------- | ------- | ----------------------------------------------- |
| `nam-core`          | [`sdatkinson/NeuralAmpModelerCore`](https://github.com/sdatkinson/NeuralAmpModelerCore)   | MIT     | **Yes** — see `nam_amp.cpp` above               |
| `dragonfly-reverb`  | [`michaelwillis/dragonfly-reverb`](https://github.com/michaelwillis/dragonfly-reverb)     | GPLv3   | **Yes** — see `dragonfly_hall_reverb.cpp` above |
| `analog-tape-model` | [`jatinchowdhury18/AnalogTapeModel`](https://github.com/jatinchowdhury18/AnalogTapeModel) | GPLv3   | No                                              |
| `byod`              | [`Chowdhury-DSP/BYOD`](https://github.com/Chowdhury-DSP/BYOD)                             | GPLv3   | No                                              |
| `lsp-plugins`       | [`lsp-plugins/lsp-plugins`](https://github.com/lsp-plugins/lsp-plugins)                   | LGPLv3  | No                                              |

Two of the five wired/pending libraries additionally vendor their own
nested submodules — after cloning this repo, run:

```bash
git submodule update --init --recursive -- packages/core/third_party/nam-core
git -C packages/core/third_party/dragonfly-reverb submodule update --init --depth 1 -- dpf
```

`nam-core`'s nested submodules are Eigen (`gitlab.com/libeigen/eigen`) and
`AudioDSPTools`. `dragonfly-reverb`'s is `dpf` (DISTRHO Plugin Framework) —
only two of its header-only utilities are actually used
(`DistrhoPlugin.hpp` for a couple of macros, `extra/ScopedDenormalDisable.hpp`),
never its actual plugin runtime.

The other three libraries are registered but not initialized/built — no
`third_party/CMakeLists.txt` exists yet, since each has real build-flag
decisions (BYOD/AnalogTapeModel both being JUCE-based plugins whose DSP
classes need extracting independently of their surrounding plugin/app
scaffolding) that belong with whichever PR actually wraps each one.

**`lsp-plugins/lsp-plugins` (vendored here) is the wrong repo to wrap
against — investigated, not yet fixed.** Since its 1.2.0 release the
`lsp-plugins/lsp-plugins` repo was decomposed into separate subprojects;
what's checked out at `third_party/lsp-plugins` is now just an empty
orchestration shell with no DSP source in it (`src/` contains only a
`Makefile`). The actual `Compressor`/`Equalizer`/`Gate` classes live in a
separate repo, [`lsp-plugins/lsp-dsp-units`](https://github.com/lsp-plugins/lsp-dsp-units)
(LGPLv3, clean `include/`+`src/main/` split, no JUCE), which itself depends
on `lsp-common-lib` and `lsp-dsp-lib`. The latter is a genuine
multi-architecture SIMD dispatch library (separate `x86`/`arm`/`aarch64`/
`generic` source trees, functions bound as runtime function pointers via
an explicit, idempotent `lsp::dsp::init()` call) that very likely needs
different compiler flags per source file — reverse-engineering that from
its own Makefile is real, open-ended work, not a quick fix like Dragonfly's
three build wrinkles were. Whoever picks up LSP Suite next should swap the
vendored submodule for `lsp-dsp-units` (+ its two dependencies) rather than
trying to use what's currently checked out.

AnalogTapeModel was also scouted: its top-level `HysteresisProcessor` is
deeply JUCE-bound (`AudioProcessorValueTreeState`, `AudioBuffer<float>`),
but the inner `HysteresisProcessing` class underneath is templated on
plain `double`s and much closer to standalone — modulo an optional `xsimd`
SIMD path (togglable via a `HYSTERESIS_USE_SIMD` define), one
`juce::FloatVectorOperations::multiply` call in its STN solver branch, and
a JUCE leak-detector macro. Smaller lift than LSP, still not zero. BYOD
hasn't been investigated yet.

**RTNeural was evaluated and deliberately dropped, not vendored.** It's a
generic neural-inference engine (no built-in amp/pedal-specific behavior at
all) used elsewhere in the Chowdhury-DSP ecosystem for standalone
neural-pedal captures (e.g. a Klon Centaur emulation). This project doesn't
need a second neural engine for that: pedal/outboard gear will be modeled
as NAM captures too (NAM's format isn't amp-specific — it captures any
nonlinear audio device), reusing the same `NamAmp` wrapper and graph engine
already built here rather than adding a second, narrower inference engine
alongside it.

This also means the remaining libraries' effect wrapping doesn't depend on
RTNeural, despite two of them referencing it as their own nested submodule:
BYOD (`modules/RTNeural`) and AnalogTapeModel (`Plugin/modules/RTNeural`)
both pull it in for a few of their neural/Centaur-style optional modules,
but the bulk of both libraries' effects (diode clippers, tube/transistor
stages, tape hysteresis and wow/flutter) are pure DSP with no neural
component. Wrapping those means extracting the specific DSP processor
class(es) for the chosen effect directly — the same pattern already used
for NAMCore and Dragonfly Reverb (glob just the DSP sources, skip the
plugin/tool/test scaffolding) — which naturally avoids RTNeural, JUCE, and
each library's other plugin-framework dependencies entirely. LSP Suite (no
git submodules at all) doesn't raise this concern in the first place.

## Non-goals (not yet — tracked for follow-up work)

- DSP wrappers for the other three libraries (tape delay/drive,
  compression/EQ). All four Dragonfly Reverb algorithms are now wrapped.
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
the full CTest suite (9/9 passing, including the real NAM model
load-and-process test, all four Dragonfly Reverb algorithms' real
impulse-response tests, and the combined-binary symbol-isolation
regression test) against Debug builds:

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

**Dragonfly Reverb needed four fixes only discoverable by actually trying
to build it:**

1. The underlying freeverb3 library (`common/freeverb/`) uses dynamic
   exception specifications (`throw(std::bad_alloc)`) removed in C++17.
   It (and anything that includes its headers, including each wrapper's
   own `.cpp`) must compile at C++14 - hence each algorithm gets its own
   `dragonfly_<algo>_reverb_vendor` CMake target with `CXX_STANDARD 14`,
   linked into the C++20 `nam_studio_core` target. Mixing standards across
   translation units in one binary is fine; only same-TU consistency
   matters.
2. freeverb3 needs `-DLIBFV3_FLOAT` defined (it picks its internal sample
   type - float/double/long double - via one of four macros; Dragonfly's
   own Makefile always builds with the float variant).
3. `common/freeverb/*.cpp` is **not** a safe glob target - it also contains
   files (`blockDelay.cpp`, `compmodel.cpp`, etc.) used only by Dragonfly's
   other reverb algorithms, which need the external FFTW library. Every
   algorithm here only needs the same specific 17 files (16 freeverb3 + one
   more) listed in each `plugins/dragonfly-*-reverb/Makefile`'s
   `FILES_COMMON` (identical list across all four plugins) - each wrapper
   `#include`s them by name rather than globbing.
4. **All four algorithms define an identically-named `DragonflyReverbDSP`
   class** (and depend on identically-named freeverb3 classes like
   `fv3::zrev2_f`). Linking any two into the same final binary is a
   duplicate-symbol conflict. The fix: each wrapper `.cpp` compiles its own
   freeverb3 sources + its own `DSP.cpp` entirely inside one anonymous
   namespace, in one translation unit (see `dragonfly_hall_reverb.cpp`'s
   header comment for why a _partial_ wrap - just `DSP.cpp`, leaving
   freeverb3 externally linked - was tried first and rejected: it compiles,
   but produces a silent linkage _mismatch_ rather than a clean error).
   Because the real class is now invisible outside its own `.cpp`, the
   public header can't forward-declare it the normal way - each header
   uses an opaque `void*` instead of `std::unique_ptr<DragonflyReverbDSP>`.
   `dragonfly_all_algorithms_test` is the regression test proving this:
   before the fix, linking it (which uses all four wrapper classes) failed
   with duplicate symbols; after, it passes.

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
