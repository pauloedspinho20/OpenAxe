# Effects suite

Ten effects across the categories the epic asked for, plus the shared plumbing (bypass, wet/dry,
ordering) that lets any of them slot into a chain. Placed before/after an `AmpCabChain` in the
audio graph - see [../engine/README.md](../engine/README.md) for how a chain fits together.

## The licensing decision: everything here is original/native, nothing is ported

> **Update (issue #22):** the DSP has since migrated to a shared C++ core
> (`packages/core`), compiled to WASM and running in an `AudioWorkletNode`.
> The reverb is Dragonfly Reverb, and NoiseGate/Compressor/EQ/Tremolo are
> DSPark - each with its own permissive (MIT/ISC/BSD) license audited in
> `packages/core/README.md`. The section below describes the _original_ v1
> effects-suite decision and why the native-node implementations existed; it
> is kept for that history, not as a description of what runs today.

The epic's initial candidate list (Airwindows, Dragonfly Reverb, ChowDSP, Guitarix/Rakarrack) was
research-stage, not a commitment. Every effect below is instead built from **native Web Audio
nodes** (`BiquadFilterNode`, `DelayNode`, `WaveShaperNode`, `DynamicsCompressorNode`, `GainNode`,
`OscillatorNode`) plus one small **self-authored** `AudioWorkletProcessor` for the noise gate,
implementing well-documented, decades-old public DSP techniques (LFO-modulated delay lines,
Schroeder allpass/comb reverb, waveshaping distortion) rather than porting any specific project's
source code.

Practical reasons this was the right call for v1, not a shortcut:

- **Zero license audit needed.** Nothing is derived from GPL or any other copyleft source, so the
  epic's "license audit checklist per effect" task has nothing to check - there's no borrowed code
  to clear. This also means every effect here is safe under commercial terms too, if that ever
  changes (see the scaffolding epic's license note).
- **No WASM porting risk.** Porting Dragonfly Reverb or ChowDSP means extracting DSP out of a
  DPF/JUCE plugin wrapper and building an Emscripten pipeline for it - real work, disproportionate
  to a first version, and still wouldn't need to happen just to have "a reverb."
- Native nodes are genuinely good here: `DynamicsCompressorNode` and `BiquadFilterNode` are
  full-featured, hardware-accelerated implementations already tuned by browser vendors.

This isn't a closed door - a specific ported effect (e.g. an actual Dragonfly Reverb WASM build,
for people who want that exact character) is a reasonable future addition **alongside** these, not
a replacement for them. If that happens, apply the license audit process then, scoped to that one
addition.

## `Effect` / `BaseEffect`

Every effect implements `Effect` (`inputNode`, `outputNode`, `setMix`/`getMix`,
`setBypass`/`isBypassed`, `dispose`). `BaseEffect` (in `Effect.ts`) implements the dry/wet
crossfade and bypass logic once, generically: a subclass just builds its own "wet" processing
subgraph and passes its first/last node to `super(context, name, wetInput, wetOutput)`. Bypass is
"mix forced to 0, previous mix remembered" rather than rewiring the graph - simpler, and it means
parallel-processing techniques (e.g. blending a compressor or drive in at 40% wet) work for free.

Mix/Level are deliberately **not** exposed as effect params (no `baseParams`/`applyBaseParams`
round-trip into presets) - the shared dry/wet crossfade and output trim stay internal plumbing for
bypass. Where an effect's DSP has its own native control it is surfaced instead: Compressor's Mix
(`setWetMix`/`getWetMix` → DSPark `setMix`), Reverb's Dry (`setDryLevel`/`getDryLevel` → Dragonfly
`dry_level`).

## `EffectsChain`

An ordered list wired `input -> effect[0] -> effect[1] -> ... -> output`. `insert(effect, index?)`,
`remove(effect)`, and `move(from, to)` rewire the chain; each effect's own bypass/mix state is
independent of its position. This is the reordering _capability_ only - the drag-and-drop UI for
it belongs to the UI/UX epic, which will call `move()`. Fully unit tested against mock effects (no
`AudioContext` needed - same pattern as `bindDualChainRig.test.ts`).

## The effects

| Class               | Category   | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NoiseGate`         | Noise gate | DSPark gate compiled to WASM (packages/core/src/dsp/noise_gate.cpp): threshold/hysteresis/attack/hold/release/range, times in ms. Migrated from the old hand-rolled `noiseGateWorklet.js` envelope follower (issue #22).                                                                                                                                                                                                                                                                                                                                       |
| `Compressor`        | Dynamics   | DSPark compressor compiled to WASM (packages/core/src/dsp/compressor.cpp): threshold/ratio/attack/release + knee/makeup/character models (Clean/Opto/FET/Varimu), times in ms. Migrated from the native `DynamicsCompressorNode` wrapper (issue #22).                                                                                                                                                                                                                                                                                                          |
| `ParametricEQ`      | EQ         | 4-band DSPark EQ compiled to WASM (packages/core/src/dsp/equalizer.cpp): low-shelf, 2 peaking mids, high-shelf, frequency/gain/Q per band. Migrated from the series-`BiquadFilterNode` chain (issue #22). Band count/type is fixed by the wrapper, matching the old `DEFAULT_BANDS`.                                                                                                                                                                                                                                                                           |
| `Chorus`, `Flanger` | Modulation | Both built on the shared `createModulatedDelay` helper (`modulatedDelay.ts`) - an LFO modulating a `DelayNode`'s `delayTime`, with feedback. Differ only in default delay/depth/feedback ranges.                                                                                                                                                                                                                                                                                                                                                               |
| `Phaser`            | Modulation | 4 cascaded `allpass` `BiquadFilterNode`s swept by one shared LFO, with feedback for resonance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `Tremolo`           | Modulation | DSPark stereo tremolo compiled to WASM (packages/core/src/dsp/tremolo.cpp): rate/depth/shape (Sine/Triangle/Square), right-channel LFO 180°-offset. Migrated from the LFO-modulated `GainNode` (issue #22).                                                                                                                                                                                                                                                                                                                                                    |
| `Delay`             | Delay      | Feedback delay with a tone filter in the loop; `character: 'clean' \| 'tape'` adds a lower cutoff plus gentle `WaveShaperNode` saturation in the feedback path so repeats warm up over time.                                                                                                                                                                                                                                                                                                                                                                   |
| `PingPongDelay`     | Delay      | Two cross-coupled delay lines, each hard-panned opposite the other, so repeats alternate left/right. Stereo output (2-channel), unlike every other effect here.                                                                                                                                                                                                                                                                                                                                                                                                |
| `Freeverb`          | Reverb     | The classic Freeverb algorithm (Jezar at Dreampoint, public domain): 8 parallel damped feedback comb filters summed into 4 series Schroeder allpass filters. Delay lengths are Freeverb's original constants (specified in samples at its reference 44100 Hz, converted to seconds so it sounds the same at any `AudioContext` sample rate). Comb filters and Schroeder allpass filters are both implemented from their standard DSP formulas using `DelayNode`/`GainNode`/`BiquadFilterNode` - not a native Web Audio node type, since neither exists as one. |

```ts
import { EffectsChain } from '@/effects/EffectsChain'
import { NoiseGate } from '@/effects/NoiseGate'
import { DragonflyReverb } from '@/effects/DragonflyReverb'

const chain = new EffectsChain(context)
const gate = await NoiseGate.create(context) // every effect is async now (WASM-backed)
const reverb = await DragonflyReverb.create(context)

chain.insert(gate)
chain.insert(reverb)
reverb.setRoomSize(0.7)

someSource.connect(chain.inputNode)
chain.outputNode.connect(destination)

drive.setBypass(true) // A/B without removing it from the chain
chain.move(2, 0) // reverb to the front
```

## Verified manually

Built all 11 effect instances (`NoiseGate` counts as one of the ten categories, for 10 classes
total plus the gate), chained them via `EffectsChain`, tweaked a parameter on each, played an
oscillator through the full chain, bypassed two effects mid-playback, and reordered the chain live

- no errors. Ran this **twice**: once against the Vite dev server, and once against a production
  build served via `vite preview`, specifically because Vite inlines the noise gate's worklet file as
  a base64 `data:` URL in production (it's under the default asset-inlining size threshold) rather
  than emitting it as a separate file - a genuinely different code path from dev mode for
  `audioWorklet.addModule()`, worth confirming rather than assuming it behaves the same.
