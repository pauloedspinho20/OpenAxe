# Plan: Graphic EQ mode, block-dialog RTA, and block feature survey

Status: proposal. Nothing here is implemented. File references below were read
on branch `feat/procedural-fire-visual`.

## 1. What exists today (the facts the plan builds on)

- **EQ block**: `packages/core/src/dsp/equalizer.cpp`. A 4-band `dspark::Equalizer`
  (low shelf, two peaks, high shelf; freq/gain/Q each) plus a series HPF/LPF
  (`low_cut`/`high_cut`). 14 params. Params are generated from
  `packages/core/param_schema.json` (`gen-param-schema.mjs`).
- **Variants precedent**: `reverb` already has per-algorithm param sets
  (`openaxe_set_reverb_algorithm`, `reverbAlgorithm` in the state document,
  `getReverbRawSchemas` in the web app). A graphic EQ "mode" should copy that
  mechanism rather than invent a new one.
- **Plugin automation stride is frozen at 20** (`pluginAutomation.paramsPerSlot`).
  Parametric (14) + graphic (10 gains + level + cuts) in one flat param list would
  be ~27 and fail the generator or remap every host parameter id. This is the main
  design constraint; see decision D1.
- **Block details dialog**: `apps/web/src/components/grid/EffectDetailsDialog/EffectDetailsDialog.tsx`
  (effects) and `NamModelDetails` (amps/cabs). Both are knob grids; there is no
  graphical content in them.
- **There is no real per-block spectrum or waveform.** `GraphRig.getBlockAnalyser`
  returns a `NativeAnalyser` fed a _synthetic sine scaled to the block's peak_
  (`peakSineSource`). The ABI only exposes peaks (`openaxe_get_meter`,
  `openaxe_get_input_meter`, `openaxe_get_gain_reduction`, `openaxe_get_gate_gain`).
  Real FFT data exists only for the global input tap (tuner) and the VISUALS view
  (`visuals/audio/fft.ts` `SpectrumAnalyzer`, radix-2, Hann). So the RTA needs a
  new core tap; it cannot be built from the existing analyser facade.

## 2. Design decisions to settle first

| #   | Decision              | Recommendation                                                                                                                                                                                                                                                                                                              |
| --- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | How to fit the mode   | Mirror the reverb variant pattern: `eqMode: 'parametric' \| 'graphic'` in state, `openaxe_set_eq_mode`, each mode has its own param list (graphic: 10 gains + `level` + `low_cut` + `high_cut` = 13, under 20). Values for the inactive mode are kept, so toggling is lossless. No stride change, no host id remap.         |
| D2  | Band layout           | 10-band octave ISO (31, 62, 125, 250, 500, 1k, 2k, 4k, 8k, 16k Hz), +/-12 dB, fixed constant-Q peaks (Q about 1.41). Offer 31-band third-octave later as a `bands` select; it needs the stride question reopened, so it is out of scope for v1.                                                                             |
| D3  | Where the FFT lives   | Core owns a lightweight **sample ring tap** per block (thin ABI). The FFT stays in TS and reuses `SpectrumAnalyzer`, since web, desktop and the plugin editor all render the same React UI. This keeps the layering rule intact (routing and metering sources in core, display math in the UI). Alternative noted in risks. |
| D4  | RTA scope             | Generic `BlockSpectrum` component shown in the details dialog of **every** block, IN and OUT overlaid. The EQ passes its response curve as an overlay. Analysis is enabled only while a dialog is open, so it costs nothing otherwise.                                                                                      |
| D5  | Curve source of truth | `openaxe_eq_response(graph, block, freqs, n, out_db)` in core, so the drawn curve is the exact biquad cascade (parametric and graphic modes), not a TS re-derivation that could drift.                                                                                                                                      |
| D6  | Preset/state compat   | `eqMode` absent means `parametric`. Old presets and the 14 existing params are untouched, so default presets stay bit-identical (the existing "skip stages at defaults" rule applies to graphic bands at 0 dB).                                                                                                             |

## 3. Work breakdown

Four PRs, each branched `feat/<issue>-slug` and squashed to `dev` per the repo
convention. PRs 1 and 3 are independent and can run in parallel.

### PR 1 - Core: graphic EQ mode (C++)

1. `packages/core/param_schema.json`: add the graphic variant (13 params, symbols
   `g31 ... g16k`, `level`, `low_cut`, `high_cut`). Run
   `node scripts/gen-param-schema.mjs` and commit generated outputs
   (`equalizer_params.inc`, `paramSchema` ranges, `automation_param_map.h`).
2. `equalizer.cpp` / `equalizer.h`: add a mode member. Graphic path is
   `dspark::Equalizer<float, 10>` (peak bands, fixed frequency and Q, only gain
   varies) followed by the existing cuts and an output `level` trim. Parametric
   path unchanged. Skip graphic bands at exactly 0 dB. Coefficient smoothing on
   gain changes to avoid zipper noise when dragging faders.
3. ABI: `openaxe_set_eq_mode` in `api.h`; `engine.cpp` dispatch, mirroring
   `openaxe_set_reverb_algorithm`. `param_count`/`param_info` resolve per mode.
4. State: serialize/load `eqMode` in `serialization/rig_state.cpp`; absent maps
   to parametric. Plugin automation slot rebinding must tolerate the param-count
   change (same path reverb algorithm switches already use).
5. `openaxe_eq_response` (D5), pure function of current params, no allocation on
   the audio thread (UI-thread call).
6. Tests (CTest): flat graphic EQ is bit-identical to bypass; each band's gain at
   its centre frequency within 0.1 dB; response curve matches an offline sweep of
   `Process`; mode switch preserves both modes' values; state round-trip;
   old-preset load. Realtime-safety test must still pass.
7. Drift guards: `gen-param-schema --check`, `check-grid-dims`, and the
   `paramSchema.coreDrift` test.

### PR 2 - Web/desktop plumbing for the mode (TS + C++ bridge)

1. Add `openaxe_set_eq_mode` and `openaxe_eq_response` to `EXPORTED_FUNCTIONS` in
   `packages/core/CMakeLists.txt`; run `node scripts/check-wasm-exports.mjs`, then
   `bash scripts/build-core-wasm.sh` and commit the new `apps/web/public/wasm-core`
   artifacts (needs Emscripten).
2. `RigWorkletNode` message + `GraphRig`/`NativeGraphRig` methods; `apps/desktop/src/bridge.cpp`
   binding; `eqMode` in `graphStore` block params and in `bindGraphRig` re-apply.
3. `paramSchema.ts`: `getParamSchema('eq')` becomes mode-aware (like reverb);
   `eqMode` is a `select` control so it appears in both the inspector strip and
   the details dialog automatically.
4. MIDI learn: graphic gains are normal schema knobs, so `ParamMidiMenu` works
   unchanged.

### PR 3 - UI: Graphic EQ controls and the response curve

1. `packages/ui`: new `Fader` (vertical slider) primitive with stories and tests,
   following the design-system rule (no native range inputs, no local re-skins).
   Keyboard (arrows/PgUp/PgDn), double-click reset to 0 dB, `aria-valuetext` in dB.
2. `EqGraphicPanel`: 10 faders with frequency labels, shown in the details dialog
   when `eqMode === 'graphic'`. The compact inspector strip shows the mode select,
   level, and a mini read-only curve (10 faders do not fit in the strip).
3. `EqResponseCurve` (canvas/SVG): draws `openaxe_eq_response`. In parametric mode
   it also gets draggable band handles (freq x, gain y, scroll for Q) - this is
   the single biggest EQ usability win and reuses the same component.
4. Presets for the mode: Flat, Smile, Mid scoop, Bass boost, Presence lift
   (stored as plain param values in the factory presets, not new code).
5. Vitest for the panel; Storybook stories; one Playwright check that switching
   mode keeps values.

### PR 4 - RTA: core tap, transport, and dialog visualization

Core and ABI:

1. `openaxe_set_block_analysis(graph, block, enabled)` and
   `openaxe_get_block_samples(graph, block, tap /*in|out*/, out, count)`.
   Per-block mono ring (4096 to 8192 samples), allocated when analysis is turned
   on (off-audio-thread, like `Reset`), written in the audio thread only when the
   atomic flag is set, written at the same points `engine.cpp` already computes
   the input and output peaks. Reader copies a snapshot; a torn read only
   produces one slightly wrong display frame, which is acceptable and documented.
2. EXPORTED_FUNCTIONS, `check-wasm-exports`, wasm rebuild, `bridge.cpp` binding.
3. CTest: tap off means zero overhead path and unchanged output; tap on returns
   the exact samples the block saw; ring wrap; analysis on/off during processing
   under TSan (the repo already runs a TSan configuration for the plugin).

Web:

1. `RigWorkletNode`: `blockSamples` request-reply, polled at about 30 Hz while a
   dialog is open (same pattern as `meters()`; about 16 KB per poll, well within
   postMessage budget). Desktop calls the ABI directly.
2. `useBlockSpectrum(blockId)`: enables the tap on mount, disables on unmount or
   when the dialog closes, runs `SpectrumAnalyzer` (4096 pt Hann) on IN and OUT,
   log-frequency bin mapping, exponential smoothing, peak hold.
3. `BlockSpectrum` component: log-frequency x axis 20 Hz to 20 kHz, dB y axis
   (-90 to 0), IN as a faint filled trace, OUT as a bright line, optional overlay
   slot for the EQ curve, controls for averaging (fast/slow), peak hold, freeze,
   and a 4.5 dB/oct slope (pink-noise-style tilt) for readability on guitar
   signals. Respects `prefers-reduced-motion` (drops to 10 fps, no smoothing glide).
4. Mount it in `EffectDetailsDialog` (above Controls) and `NamModelDetails`. In
   the EQ dialog the response curve is overlaid on the live spectrum so you see
   the EQ shaping the real signal.
5. Skip for kinds where it is meaningless (send/return relays); mixer shows the
   bus output only.
6. Tests: hook enables/disables the tap with the dialog; component renders from a
   fixture spectrum; no tap left enabled after unmount (assert via ABI).
   Playwright: open the EQ dialog with a DI sample playing and assert the canvas
   changes between frames.

## 4. Risks and open questions

- **Wasm rebuild** is manual and needs Emscripten; PR 2 and PR 4 both change the
  ABI. Batch both ABI changes into one rebuild if the PRs land close together to
  avoid conflicting binary artifacts.
- **Mode switching glitches**: switching mid-signal should crossfade (a few ms)
  rather than hard-swap filter state. Cheap to do, easy to forget.
- **Tap cost on wasm**: one mono ring write per block per callback; negligible,
  but measure with `openaxe_get_cpu_load` with several dialogs' worth of taps on.
- **Alternative to D3**: do the FFT in core and return magnitudes. Better for a
  future non-webview plugin editor, but adds an FFT (and window/overlap state) to
  the engine for display only. Revisit if the VST3 editor stops being a webview.
- **Per-block RTA for blocks inside a staged rig switch** (`openaxe_staged_graph_*`):
  the tap must follow the active graph; confirm with `rig_switch.cpp` before PR 4.
- **Plugin automation**: graphic params occupy slot indices 0 to 12 and reuse the
  same host ids as the parametric ones with different meaning (as reverb already
  does). Acceptable, but call it out in `packages/vst3/README.md`.

## 5. Suggested order

1. Settle D1 to D3 (a half-day review, no code).
2. PR 1 and PR 3's `Fader` primitive in parallel.
3. PR 2, then PR 3's panel and curve.
4. PR 4 (independent of the graphic mode; can start any time after D3 and ship
   first if you want the RTA sooner).

Rough size: PR 1 medium, PR 2 small, PR 3 medium, PR 4 large (new core tap plus
a full visualization component).

## 6. Survey of active blocks: features that could be added

Source: palette-enabled kinds in `packages/core/effects.config.json` and their
param lists in `packages/core/param_schema.json`. I read the EQ DSP source but
not the other DSP sources, so items marked "(verify)" depend on implementation
details I have not checked. Ordered within each block by value for effort.

**Cross-cutting (biggest wins)**

- **Dry/Wet `mix` is missing on most time-based effects.** Chorus, flanger,
  phaser, tremolo and delay list no `mix` param (the compressor has one). Players
  expect it; parallel processing is half of why people use these.
- **Tempo sync / tap tempo** for delay, tremolo, chorus, flanger, phaser, rotary
  (note-division select plus one global BPM, ideally driven by the backing
  player's tempo and MIDI clock).
- **A/B compare and per-block mini presets** in the details dialog.
- **Real per-block RTA/scope** (this plan) benefits every block below.
- **Bypass tails** (reverb/delay ring out when bypassed) (verify current behavior).

**Per block**

| Block                    | Today                                                                     | Candidate features                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `noise-gate`             | threshold, hysteresis, attack, hold, release, range                       | Sidechain HPF/LPF on the detector; auto-learn threshold from 2 s of silence; threshold line drawn over the live input waveform; expander ratio mode instead of hard gate.                                         |
| `compressor`             | threshold, ratio, attack, release, knee, makeup, character, mix           | Transfer-curve display with a live operating-point dot (data already available via gain reduction); auto-makeup; detector sidechain HPF; peak/RMS detector select; gain-reduction history graph.                  |
| `eq`                     | 4 fixed-type bands, low/high cut                                          | Graphic mode and RTA (this plan); per-band type select (bell, shelf, notch, HP/LP) and enable; band solo; output level and auto-gain compensation; mid/side mode.                                                 |
| `chorus`                 | rate, depth, delay, feedback, stereo                                      | Mix; waveform shape; tone/HP on the wet path; multi-voice (2/3/4); tempo sync.                                                                                                                                    |
| `flanger`                | rate, depth, feedback, delay                                              | Mix; negative-feedback polarity (verify range); waveform shape; manual (static sweep) control; tempo sync; stereo offset.                                                                                         |
| `phaser`                 | rate and `script` only                                                    | The most under-featured block: stages (4/6/8/12), depth, feedback, center frequency, stereo phase offset, mix, waveform. (`script` looks like a variant select - verify.)                                         |
| `tremolo`                | rate, depth, shape, stereo, mode                                          | Tempo sync with note divisions; phase offset; tap tempo; a "harmonic" (split-band) mode if `mode` does not already cover it (verify).                                                                             |
| `delay`                  | time, feedback, tone, model, wow depth/rate, stereo mode, width           | Mix; tempo sync and tap tempo; ducking (wet drops while you play); feedback HP/LP; freeze/hold; subdivision rhythm taps; reverse model.                                                                           |
| `reverb`                 | hall, room, plate, early reflections, spring, shared controls plus expert | Freeze/infinite hold; ducking; wet-path EQ shown in the new RTA; mix presets per algorithm; shimmer (blocked on the pitch-shifter latency issue #320).                                                            |
| `rotary`                 | speed, drive, horn/drum level, mic distance, crossover, velocity          | Speed ramp (acceleration and brake time) with MIDI/footswitch toggle; stereo mic angle; horn/drum independent speeds.                                                                                             |
| `amp` / `amp-cab`        | input/output level, slim size, bass/mid/treble/presence                   | Loudness matching between captures using the existing `openaxe_compute_fingerprint` gain data; EQ pre/post position switch; model A/B comparison; oversampling option for high-gain captures.                     |
| `pedal`, `space`         | NAM-capture gear kinds                                                    | Same loudness matching and model A/B; a gain-structure hint when output clips (use the existing peak meter).                                                                                                      |
| `cab`                    | ir_mix, low/high cut                                                      | **IR frequency-response view** (a natural second consumer of the RTA/curve component); dual IR blend; IR trim/length limit for CPU; polarity invert; per-IR gain trim; alignment/delay offset for two-mic blends. |
| `mixer`                  | 4 inputs: level, pan                                                      | Mute/solo and phase invert per channel; per-channel and bus meters; master level; stereo width.                                                                                                                   |
| `send-1/2`, `return-1/2` | routing relays                                                            | Return level and mix for parallel loops; latency indicator/compensation across the loop (verify).                                                                                                                 |

Not in the palette today (compiled out or hidden): `filter`, `pitch-shifter`,
`ring-mod`, `granular-delay`, `outboard`. `filter` is the cheapest to bring back
since the new response-curve component gives it the display it lacks; the pitch
shifter stays blocked on issue #320.

**If you pick three:** `mix` on the modulation/delay effects (small, high value),
tempo sync (medium, high value, one shared BPM source), and the IR frequency view
on `cab` (small once PR 3/4 components exist).
