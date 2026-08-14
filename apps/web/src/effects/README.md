# Effects suite

Ten effects across the categories the epic asked for, plus the shared plumbing (bypass, wet/dry,
ordering) that lets any of them slot into a chain. Placed before/after an `AmpCabChain` in the
audio graph - see [../engine/README.md](../engine/README.md) for how a chain fits together.

## The licensing decision: everything here is original/native, nothing is ported

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

## `EffectsChain`

An ordered list wired `input -> effect[0] -> effect[1] -> ... -> output`. `insert(effect, index?)`,
`remove(effect)`, and `move(from, to)` rewire the chain; each effect's own bypass/mix state is
independent of its position. This is the reordering _capability_ only - the drag-and-drop UI for
it belongs to the UI/UX epic, which will call `move()`. Fully unit tested against mock effects (no
`AudioContext` needed - same pattern as `bindDualChainRig.test.ts`).

## The effects

| Class               | Category                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NoiseGate`         | Noise gate                | The one effect needing a custom `AudioWorkletProcessor` (`noiseGateWorklet.js`) - gating needs a sample-accurate envelope follower, which native nodes can't do. One-pole gain smoothing toward a binary threshold decision (attack/release time constants), no lookahead/hold.                                                                                                                                                                                                                                                                                |
| `Compressor`        | Dynamics                  | Thin wrapper over native `DynamicsCompressorNode`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `ParametricEQ`      | EQ                        | Series `BiquadFilterNode`s, default 4 bands (low-shelf, 2 peaking mids, high-shelf). Band count/type is configurable via the constructor.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `Drive`             | Overdrive/distortion/fuzz | One `WaveShaperNode`-based class, `setType('overdrive' \| 'distortion' \| 'fuzz')` swaps the curve generator (tanh saturation / the classic Web Audio spec distortion formula / asymmetric hard clip).                                                                                                                                                                                                                                                                                                                                                         |
| `Chorus`, `Flanger` | Modulation                | Both built on the shared `createModulatedDelay` helper (`modulatedDelay.ts`) - an LFO modulating a `DelayNode`'s `delayTime`, with feedback. Differ only in default delay/depth/feedback ranges.                                                                                                                                                                                                                                                                                                                                                               |
| `Phaser`            | Modulation                | 4 cascaded `allpass` `BiquadFilterNode`s swept by one shared LFO, with feedback for resonance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `Tremolo`           | Modulation                | LFO modulating a `GainNode`'s gain around a center value.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `Delay`             | Delay                     | Feedback delay with a tone filter in the loop; `character: 'clean' \| 'tape'` adds a lower cutoff plus gentle `WaveShaperNode` saturation in the feedback path so repeats warm up over time.                                                                                                                                                                                                                                                                                                                                                                   |
| `PingPongDelay`     | Delay                     | Two cross-coupled delay lines, each hard-panned opposite the other, so repeats alternate left/right. Stereo output (2-channel), unlike every other effect here.                                                                                                                                                                                                                                                                                                                                                                                                |
| `Freeverb`          | Reverb                    | The classic Freeverb algorithm (Jezar at Dreampoint, public domain): 8 parallel damped feedback comb filters summed into 4 series Schroeder allpass filters. Delay lengths are Freeverb's original constants (specified in samples at its reference 44100 Hz, converted to seconds so it sounds the same at any `AudioContext` sample rate). Comb filters and Schroeder allpass filters are both implemented from their standard DSP formulas using `DelayNode`/`GainNode`/`BiquadFilterNode` - not a native Web Audio node type, since neither exists as one. |

```ts
import { EffectsChain } from '@/effects/EffectsChain'
import { NoiseGate } from '@/effects/NoiseGate'
import { Drive } from '@/effects/Drive'
import { Freeverb } from '@/effects/Freeverb'

const chain = new EffectsChain(context)
const gate = await NoiseGate.create(context) // the only effect with an async constructor
const drive = new Drive(context, 'overdrive')
const reverb = new Freeverb(context)

chain.insert(gate)
chain.insert(drive)
chain.insert(reverb)
drive.setDrive(0.6)
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
