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
- **Real-time audio engine + full `extern "C"` API** (issue #14's follow-up
  PR): `include/nam_studio/engine.h` + `src/engine.cpp` add
  `nam_studio::engine::AudioEngine`, a layer on top of `GraphRig` that gives
  each block a live DSP object (NAM for the 5 amp-family kinds, one of the
  4 Dragonfly algorithms for `kReverb`, passthrough for kinds LSP/BYOD/
  AnalogTapeModel haven't wrapped yet), pre-allocated buffers, and real
  column-ordered signal routing. `include/nam_studio/api.h` + `src/api.cpp`
  expose it as a 20-function `extern "C"` surface (int32 ids, not
  `GraphRig`'s strings — portable across C/WASM/FFI): topology, `reset`/
  `process`, generic param get/set/info, NAM model management, reverb
  algorithm choice, and metering.
- **Diode Clipper** (`include/nam_studio/dsp/diode_clipper.h` +
  `src/dsp/diode_clipper.cpp`) — a wave digital filter model of a diode pair
  clamping a first-order RC lowpass (cutoff, drive, diode type [GZ34/1N34/
  1N4148], diode count), reimplemented from BYOD's `DiodeClipperWDF` using
  `chowdsp_wdf`'s header-only WDF primitives directly. Not a vendored
  `#include` of BYOD's own file — see "BYOD" below for why. Mono per
  channel, run independently per channel like the Dragonfly reverbs. Wired
  into a new `kDrive` `BlockKind` (`block.h`) - the first effect kind added
  since #13's original scaffold, since no "drive"/distortion kind existed
  to plug into. A `DriveModel` enum + `AudioEngine::SetDriveModel` (mirrors
  `ReverbAlgorithm`/`SetReverbAlgorithm`) is the seam future BYOD drive/fuzz
  wraps plug into as additional models, without needing another new
  `BlockKind`. Wired all the way through to the web app (`apps/web/src/
effects/Drive.ts`, `apps/web/public/wasm-core/driveWorklet.js`) - the
  app's first distortion/drive effect, no prior implementation replaced.
- **Tube Screamer, Zen Drive, MXR Distortion+** (`include/nam_studio/dsp/{tube_screamer,zen_drive,mxr_distortion}.h`
  - matching `src/dsp/*.cpp`) — three more BYOD WDF circuits reimplemented
    the same way as Diode Clipper (own hand-copied `chowdsp_wdf` circuit, no
    vendored BYOD source, no parameter smoothing), each individually verified
    buildable and correct before being added. All three join `DiodeClipper`
    as additional `DriveModel` enum values (`kTubeScreamer`/`kZenDrive`/
    `kMxrDistortion`) on the existing `kDrive` `BlockKind` - no new `BlockKind`
    or ABI shape needed, exactly the seam that enum was built for. Shared
    helpers (`internal::LogPot`/`InverseLogPot`/`SkewedRange`/`DcBlocker`,
    the `NonInvertingOpAmpRType` 3-port scattering matrix Tube Screamer and
    Zen Drive both use) live in `src/dsp/internal/wdf_common.h`, extracted
    once a second wrapper needed the same audio-taper/DC-blocking math Diode
    Clipper had already hand-derived. Not yet exported from the WASM build's
    `EXPORTED_FUNCTIONS` or reachable from the web app's model-selector UI -
    same "only export what's currently used" deferral `nam_studio_set_drive_model`
    itself already had with only one model available; still true with four.
    Two circuit-accurate wrinkles worth knowing if you touch these: Zen Drive
    and MXR Distortion+ both model a real single-supply op-amp bias network
    (a `setVoltage(4.5f)` call in their `Prepare`), so a freshly-`Reset`
    instance has a genuine power-on transient/DC bias in its first samples
    that decays through `DcBlocker` rather than starting silent - their own
    tests warm up on silence before measuring steady-state behavior, and
    check stereo independence by comparing two instances' left-channel output
    rather than asserting a silent channel stays silent.
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
have failed with duplicate symbols before that fix). `diode_clipper_test`
sweeps every parameter and processes a loud sine through it, asserting the
output stays finite and its peak is genuinely compressed below the linear
input level (proof the nonlinearity actually engages, not just that nothing
crashed) and that channels don't leak into each other. `tube_screamer_test`/
`zen_drive_test`/`mxr_distortion_test` follow the identical pattern for the
other three drive models (see the bias-network note above for why the
latter two warm up on silence and check independence via two-instance
comparison rather than a literal silent-in/silent-out assertion). `engine_test`
and `api_realtime_test` each add a `kDrive`/`NAM_STUDIO_BLOCK_DRIVE` case
doing the same real-nonlinearity check through the engine layer and the
full `extern "C"` surface respectively (not just the `DiodeClipper` class
directly), plus confirming `SetDriveModel`/`nam_studio_set_drive_model`
switches models independently per-block and is a safe no-op on a block of
the wrong kind.

## Vendored third-party DSP libraries

All added as git submodules under `third_party/`. Two of the five URLs in
issue #14's original text were wrong/renamed — corrected here after
verifying each repo directly on GitHub:

| Path                | Upstream                                                                                  | License | Wired into the build?                                          |
| ------------------- | ----------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------- |
| `nam-core`          | [`sdatkinson/NeuralAmpModelerCore`](https://github.com/sdatkinson/NeuralAmpModelerCore)   | MIT     | **Yes** — see `nam_amp.cpp` above                              |
| `dragonfly-reverb`  | [`michaelwillis/dragonfly-reverb`](https://github.com/michaelwillis/dragonfly-reverb)     | GPLv3   | **Yes** — see `dragonfly_hall_reverb.cpp` above                |
| `byod`              | [`Chowdhury-DSP/BYOD`](https://github.com/Chowdhury-DSP/BYOD)                             | GPLv3   | **Partially** — `chowdsp_wdf` only (4 drive models), see below |
| `analog-tape-model` | [`jatinchowdhury18/AnalogTapeModel`](https://github.com/jatinchowdhury18/AnalogTapeModel) | GPLv3   | No                                                             |
| `lsp-plugins`       | [`lsp-plugins/lsp-plugins`](https://github.com/lsp-plugins/lsp-plugins)                   | LGPLv3  | No                                                             |

Three of these libraries additionally vendor their own nested submodules —
after cloning this repo, run:

```bash
git submodule update --init --recursive -- packages/core/third_party/nam-core
git -C packages/core/third_party/dragonfly-reverb submodule update --init --depth 1 -- dpf
git -C packages/core/third_party/byod submodule update --init --depth 1 -- modules/chowdsp_wdf
```

`nam-core`'s nested submodules are Eigen (`gitlab.com/libeigen/eigen`) and
`AudioDSPTools`. `dragonfly-reverb`'s is `dpf` (DISTRHO Plugin Framework) —
only two of its header-only utilities are actually used
(`DistrhoPlugin.hpp` for a couple of macros, `extra/ScopedDenormalDisable.hpp`),
never its actual plugin runtime. `byod`'s own repo is checked out directly
(not itself a submodule init gap), but **all 10 of BYOD's own nested
submodules start uninitialized** — only `chowdsp_wdf` (a standalone,
header-only WDF circuit-modeling library, no JUCE/RTNeural dependency of
its own) is actually needed, for the reason below. `math_approx` (another
of BYOD's nested submodules) is not used: `chowdsp_wdf` has its own
built-in Wright-Omega approximation, which `diode_clipper.cpp` uses
instead of pulling in a second one for no accuracy gain.

**BYOD itself can't be compiled directly, at all — not even its simplest
file.** Every one of its 249 DSP processor source files gets a global
`pch.h` force-included by BYOD's own CMake
(`target_precompile_headers(BYOD PRIVATE pch.h)`), and that header
unconditionally pulls in JUCE, RTNeural, and Eigen — there's no
`#ifdef`-guarded path around it, even for a processor as simple as the
diode clipper. `diode_clipper.cpp` is therefore a hand-written
reimplementation of BYOD's `DiodeClipperWDF`
(`src/processors/drive/diode_circuits/DiodeClipperWDF.h`), built directly
on `chowdsp_wdf`'s dependency-free WDF primitives (`ResistorT`,
`CapacitorT`, `WDFParallelT`, `DiodePairT` — all header-only, no JUCE) —
the same pattern this file's own "Non-goals" section already anticipated
for AnalogTapeModel turning out messier than it looked (see below), which
turned out to apply here too, just for a different reason (a force-included
PCH rather than one runtime-switch branch). One simplification versus the
original: BYOD's parameter smoothing (`SmoothedValue`) is JUCE-only and
dropped rather than reimplemented — every other DSP wrapper in this
codebase (NamAmp, the Dragonfly reverbs) also applies parameter changes
immediately with no internal ramping, so adding it back just for this one
class would be inconsistent with the rest of the library, not a missing
feature.

The remaining two libraries (`analog-tape-model`, `lsp-plugins`) are
registered but not initialized/built — no `third_party/CMakeLists.txt`
exists yet for either.

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

**AnalogTapeModel was scouted more deeply and turned out messier than the
original pass suggested — investigated, not fixed.** Its top-level
`HysteresisProcessor` is deeply JUCE-bound, but the inner
`HysteresisProcessing` class is much closer to standalone — except its
`process()` picks a solver via a **runtime `switch`, not `if constexpr`**,
so the `STN` branch is compiled into every instantiation regardless of
which solver actually gets called. That branch alone pulls in RTNeural (a
full neural-net template library), `nlohmann::json`, and JUCE's
`BinaryData`/`String`/`MemoryInputStream` to load 231 pretrained model
files — none of which can be avoided just by never selecting `STN` at
runtime, since the compiler still needs it all resolved to build at all.
Getting a clean build means either patching the vendored header (`switch`
→ `if constexpr`, so only the self-contained RK2/RK4/NR4/NR8 solvers ever
get compiled) or vendoring RTNeural + `chowdsp_utils`/`xsimd` just to
satisfy a code path this project likely never calls. Whoever picks this up
next should budget for that decision, not treat it as a quick wrap like
Dragonfly's or the Diode Clipper's own turned out to be.

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

- DSP wrappers for the rest of AnalogTapeModel (tape delay), BYOD (BYOD has
  39+ other effects beyond the 4 drive models wrapped so far — modulation/
  fuzz/EQ, e.g. Big Muff, still a candidate for follow-up), and all of LSP
  Suite (compression/EQ). Their block kinds pass audio through unchanged in
  `AudioEngine` until they're wrapped.
- Preset/JSON (de)serialization.
- Full lock-free concurrency: `Process()` itself is allocation-free and its
  params are lock-free atomics, but topology mutation
  (add/remove/connect/disconnect) and NAM model loading are not claimed safe
  to call concurrently with `Process()` — no real host drives this from an
  audio thread yet (native tests + two browser AudioWorklets, see below).
- WASM/browser UI wiring beyond Reverb/Drive — NAM model loading, metering,
  and reverb algorithm switching aren't wired into the web app yet
  (`apps/web/public/wasm-core/dragonflyReverbWorklet.js`/`driveWorklet.js`,
  built on the shared `namStudioEffectBase.js`, only call
  `create`/`add_block`/`connect`/`reset`/`process`/`set_param`).
- iOS/Android: still unverified, those toolchains aren't installed in this
  environment.

## Build verification status

**Native (macOS, this environment): verified, not just authored.** CMake
4.4.2 configures, builds, and runs the full CTest suite (15/15 passing,
including the real NAM model load-and-process test, all four Dragonfly
Reverb algorithms' real impulse-response tests, the combined-binary
symbol-isolation regression test, and all four drive models' (Diode
Clipper, Tube Screamer, Zen Drive, MXR Distortion+) real nonlinear-clipping
tests) against Debug builds:

```bash
cmake -S packages/core -B packages/core/build -DNAM_STUDIO_BUILD_TESTS=ON -DCMAKE_BUILD_TYPE=Debug
cmake --build packages/core/build
ctest --test-dir packages/core/build --output-on-failure
```

**Emscripten: verified for issue #22's first slice.** `nam_studio_core`
itself stays a plain `STATIC` library (Emscripten's export/link flags only
apply to a final linked module); a small `nam_studio_core_wasm` executable
target (empty `src/wasm_entry.cpp`, no `main()` needed for the
`MODULARIZE=1` factory-function pattern) links it and gets the actual
Emscripten treatment. `scripts/build-core-wasm.sh` builds it and copies the
output into `apps/web/public/wasm-core/`, where
`dragonflyReverbWorklet.js` (a real `AudioWorkletProcessor`) calls into it.
Only 7 of the 20 `extern "C"` functions are exported so far (see
`CMakeLists.txt`'s `EXPORTED_FUNCTIONS` list) — enough for one graph with
one Reverb block; extend that list as more of the ABI gets used from the
browser.

**iOS/Android: still unverified** — those toolchains aren't installed in
this environment. The iOS/Android branches in `CMakeLists.txt` are unchanged
from #13's scaffold and remain authored-but-untested.

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

# WASM (web, via Emscripten) - verified for issue #22's first slice; use
# scripts/build-core-wasm.sh instead, which also copies the output into
# apps/web/public/wasm-core/
emcmake cmake -B build/wasm -DCMAKE_BUILD_TYPE=Release
cmake --build build/wasm --target nam_studio_core_wasm

# iOS - unverified
cmake -B build/ios -G Xcode -DCMAKE_SYSTEM_NAME=iOS
cmake --build build/ios

# Android (via NDK) - unverified
cmake -B build/android -DCMAKE_TOOLCHAIN_FILE=$NDK/build/cmake/android.toolchain.cmake \
      -DANDROID_ABI=arm64-v8a
cmake --build build/android
```
