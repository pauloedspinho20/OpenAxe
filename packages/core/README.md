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
  4 Dragonfly algorithms for `kReverb`, one of the 4 DSPark effects for
  `kCompressor`/`kEq`/`kNoiseGate`/`kTremolo`, hand-written wrappers for
  `kChorus`/`kFlanger`/`kPhaser`/`kDelay`/`kPingPongDelay`, and passthrough
  for `kCab`/`kMixer`/`kSplitter`, which aren't DSP effect kinds), pre-allocated
  buffers, and real column-ordered signal routing.
  `include/nam_studio/api.h` + `src/api.cpp`
  expose it as an `extern "C"` surface (int32 ids, not `GraphRig`'s strings —
  portable across C/WASM/FFI): topology, `reset`/`process`, generic param
  get/set/info, NAM model management, reverb algorithm choice, and metering.
- **Compressor, EQ, Noise Gate, Tremolo** (`include/nam_studio/dsp/{compressor,equalizer,noise_gate,tremolo}.h`
  - matching `src/dsp/*.cpp`) — four DSPark processors wrapped behind the same
    thin-class interface as the Dragonfly reverbs, via a generic adapter
    (`src/dsp/internal/dspark_wrapper.h`) that any future DSPark effect plugs
    into with just a param table. `Compressor` (7 params: threshold/ratio/
    attack/release/knee/makeup_gain/character — Clean/Opto/FET/Varimu),
    `Equalizer` (12 params: 4 bands × frequency/gain/Q, low-shelf/2 mid
    peaks/high-shelf), `NoiseGate` (6 params: threshold/hysteresis/attack/
    hold/release/range), `Tremolo` (3 params: rate/depth/shape — Sine/
    Triangle/Square, stereo with the right LFO 180°-offset). Envelope times
    are in ms. These are the last four kinds issue #22 had still running on
    native Web Audio nodes — wired to the web app via `apps/web/public/
wasm-core/{compressor,eq,noiseGate,tremolo}Worklet.js` and the matching
    TS classes.
- **Convolver** (`include/nam_studio/dsp/convolver.h` + `src/dsp/convolver.cpp`)
  — cabinet/room impulse-response convolution, the DSP behind a Cab block.
  Partitioned convolution in the standard two-part form: a direct time-domain FIR
  for the first 64 taps, then FFT partitions through a frequency-domain delay
  line (with a small hand-written radix-2 FFT, so no new third-party dependency).
  That shape is what makes it **zero-latency for any block size** - a purely
  block-based FFT scheme would either delay the stream or leave a gap in it. A
  2048-tap cab IR costs roughly 40x less than a direct FIR would.
- **WAV decoder** (`include/nam_studio/dsp/wav.h` + `src/dsp/wav.cpp`) — decodes
  a WAV file held in memory (8/16/24/32-bit PCM, 32/64-bit float, any channel
  count folded to mono, WAVE_FORMAT_EXTENSIBLE, unknown chunks skipped) and
  resamples with a windowed-sinc kernel. Only a browser gets audio decoding for
  free, so this is what lets the desktop app and a plugin load an impulse response
  at all - bytes in, samples out, the same shape as loading a NAM model from JSON.
  A malformed or compressed file returns nullopt rather than throwing.
- **Tone stack** (`include/nam_studio/dsp/tone_stack.h` + `src/dsp/tone_stack.cpp`)
  — the 4-band Bass/Mid/Treble/Presence stack the engine runs after every NAM
  model (low shelf 100Hz, peaking 1kHz Q0.7, high shelf 5kHz, peaking 8kHz Q0.5,
  each ±12dB). Frequencies and slopes match the Web Audio `BiquadFilterNode`
  chain the web app used to own privately, so moving it here didn't change how
  the web app sounds - and the desktop app, which had no tone controls at all,
  now matches it. Flat is bit-exact passthrough, so an un-EQ'd amp costs nothing.
- `include/nam_studio/core.h` + `src/core.cpp` — the pre-existing #13
  placeholder (`nam_studio::core::version()`), unchanged.

**Test suite** (`tests/`, CTest): `graph_validation_test` and `graph_rig_test`
port the boundary-value matrix from `graphValidation.test.ts`/
`GraphRig.test.ts` almost 1:1. `api_test` checks handle lifecycle.
`nam_amp_test` is a real integration test — it loads an actual `.nam` model
bundled with the vendored NeuralAmpModelerCore submodule
(`third_party/nam-core/example_models/lstm.nam`), resets it, processes an
impulse through it, and asserts every output sample is finite.
`wav_test` builds WAV files byte by byte in memory to cover each sample format,
stereo folding, 24-bit sign extension, extensible headers and the malformed cases
(truncated, compressed, no data chunk), plus the resampler's length and frequency
behaviour.
`convolver_test` checks the convolver against brute-force direct convolution for
every combination of IR length and block size (including block sizes that aren't a
multiple of the partition), which is the only way to catch the off-by-one errors a
frequency-domain delay line invites - they sound like a comb filter rather than an
obvious failure.
`tone_stack_test` measures the stack's actual frequency response - each band
boosting and cutting its own region while leaving the others alone, holding at
96kHz, and staying bit-exact while flat.
`dragonfly_{hall,room,plate,early_reflections}_reverb_test` each sweep every
one of that algorithm's parameters to their min/max and process a real
stereo impulse through it, asserting a genuine non-silent, finite reverb
tail comes out. `dragonfly_all_algorithms_test` constructs and processes
audio through all four algorithms in one executable - the actual regression
test for the symbol-isolation fix described below (linking any two would
have failed with duplicate symbols before that fix). `compressor_test`/`equalizer_test`/`noise_gate_test`/
`tremolo_test` do the same parameter-sweep + real-audio pattern for the four
DSPark wrappers (a loud sine comes out measurably compressed/gated/modulated,
a band boost measurably louder than a cut, silence measurably crushed), and
`engine_test`'s DSPark case + `api_realtime_test`'s `TestEndToEndDsparkRig`
run all four kinds in a chain through the engine and the full `extern "C"`
surface.

## Vendored third-party DSP libraries

All added as git submodules under `third_party/`, and all wired into the
build — every one backs a real effect kind:

| Path               | Upstream                                                                                | License | Wired into the build?                                       |
| ------------------ | --------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------- |
| `nam-core`         | [`sdatkinson/NeuralAmpModelerCore`](https://github.com/sdatkinson/NeuralAmpModelerCore) | MIT     | **Yes** — see `nam_amp.cpp` above                           |
| `dragonfly-reverb` | [`michaelwillis/dragonfly-reverb`](https://github.com/michaelwillis/dragonfly-reverb)   | GPLv3   | **Yes** — see `dragonfly_hall_reverb.cpp` above             |
| `dspark`           | [`CristianMoresi/DSPark`](https://github.com/CristianMoresi/DSPark)                     | MIT     | **Yes** — Compressor/Equalizer/NoiseGate/Tremolo, see above |

Two of these libraries additionally vendor their own nested submodules —
after cloning this repo, run:

```bash
git submodule update --init --recursive -- packages/core/third_party/nam-core
git -C packages/core/third_party/dragonfly-reverb submodule update --init --depth 1 -- dpf
```

`nam-core`'s nested submodules are Eigen (`gitlab.com/libeigen/eigen`) and
`AudioDSPTools`. `dragonfly-reverb`'s is `dpf` (DISTRHO Plugin Framework) —
only two of its header-only utilities are actually used
(`DistrhoPlugin.hpp` for a couple of macros, `extra/ScopedDenormalDisable.hpp`),
never its actual plugin runtime.

`signalsmith-dsp`, `analog-tape-model`, and `lsp-plugins` were vendored
early on for effect kinds that were never built (tape delay character,
LSP-backed compression/EQ) and removed once it was clear nothing depended
on them — `analog-tape-model` in particular was investigated in depth
(a JUCE-bound `HysteresisProcessor`, plus a `switch`-not-`if constexpr`
solver branch that unconditionally pulled in RTNeural) and never got past
that scoping stage. If tape modeling or LSP-backed effects come back as a
real feature, re-vendor from scratch rather than reviving these — `LSP
Suite`'s upstream in particular had already been the wrong repo (post-1.2.0
decomposition moved the actual DSP classes to `lsp-plugins/lsp-dsp-units`).

**RTNeural was evaluated and deliberately dropped, not vendored.** It's a
generic neural-inference engine (no built-in amp/pedal-specific behavior at
all) used elsewhere in the Chowdhury-DSP ecosystem for standalone
neural-pedal captures (e.g. a Klon Centaur emulation). This project doesn't
need a second neural engine for that: pedal/outboard gear will be modeled
as NAM captures too (NAM's format isn't amp-specific — it captures any
nonlinear audio device), reusing the same `NamAmp` wrapper and graph engine
already built here rather than adding a second, narrower inference engine
alongside it.

## Non-goals (not yet — tracked for follow-up work)

- Preset/JSON (de)serialization.
- Full lock-free concurrency: `Process()` itself is allocation-free and its
  params are lock-free atomics, but topology mutation
  (add/remove/connect/disconnect) and NAM model loading are not claimed safe
  to call concurrently with `Process()` — no real host drives this from an
  audio thread yet (native tests + two browser AudioWorklets, see below).
- WASM/browser UI wiring beyond Reverb — NAM model loading, metering, and
  reverb algorithm switching aren't wired into the web app yet
  (`apps/web/public/wasm-core/dragonflyReverbWorklet.js`, built on the
  shared `namStudioEffectBase.js`, only calls
  `create`/`add_block`/`connect`/`reset`/`process`/`set_param`).
- iOS/Android: still unverified, those toolchains aren't installed in this
  environment.

## Build verification status

**Native (macOS, this environment): verified, not just authored.** CMake
4.4.2 configures, builds, and runs the full CTest suite, including the real
NAM model load-and-process test, all four Dragonfly Reverb algorithms' real
impulse-response tests, and the combined-binary symbol-isolation regression
test, against Debug builds:

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
