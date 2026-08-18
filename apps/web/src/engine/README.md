# Audio engine

Wraps [`neural-amp-modeler-wasm`](https://www.npmjs.com/package/neural-amp-modeler-wasm) (MIT) —
consumed via its `neural-amp-modeler-wasm/engine` subpath, not the bundled React UI components —
into a per-chain API the rest of the app builds on. This engine layer knows nothing about the
dual-chain rig, presets, or Tone3000; it just runs one amp+cab chain at a time.

## Key facts about the upstream engine

- The npm package ships a prebuilt `.wasm` binary and worklet bundle — no Emscripten toolchain is
  needed to consume it, only to rebuild NAM core itself from source (not required here).
- One `NamEngine` per `AudioContext` — `NamEngine.attach(context)` registers the AudioWorklet
  module and fetches the wasm binary once; it's idempotent, so call it as many times as
  convenient. Every `NamNode` created from that engine shares the **same** wasm module inside the
  `AudioWorkletGlobalScope`. Running two chains (our dual-chain requirement) does **not** double
  the wasm memory footprint — see the verification note below.
- Each `NamNode` is **mono in, mono out**. That's why the dual-chain rig is two independent mono
  chains (panned/mixed to stereo), not one stereo engine instance.
- Model hot-swapping is handled inside the upstream worklet: `loadModel()` reparses on the audio
  thread and fades the output back in over ~21 ms (1024 frames), so swapping models mid-play is
  already click-free. We don't reimplement that.
- The wasm engine only models the amp. Cabinet/IR simulation is a plain Web Audio
  `ConvolverNode` wired in parallel with a dry path (see `AmpCabChain.loadIR`) — this matches the
  pattern used by the upstream library's own React component.

## `AmpCabChain`

One mono amp+cab chain: `input -> NAM amp -> [dry / IR-wet mix] -> output`.

```ts
import { NamEngine } from 'neural-amp-modeler-wasm/engine'
import { AmpCabChain } from '@/engine/AmpCabChain'

const context = new AudioContext()
const engine = await NamEngine.attach(context)

// One AmpCabChain per signal chain - e.g. two, for the dual-chain stereo rig.
const chainA = await AmpCabChain.create(context, engine)
const chainB = await AmpCabChain.create(context, engine)

await chainA.loadModel(namFileJsonText)
chainA.loadIR(decodedIrAudioBuffer) // mix defaults to fully wet

someSource.connect(chainA.inputNode)
chainA.outputNode.connect(destination)

// Later:
await chainA.dispose()
```

- `loadModel(json, slimSize?, info?)` — load a `.nam` file's contents (a JSON string). `slimSize`
  only applies to slimmable (e.g. A2) models; see `NamModelInfo.slimmable`/`slimmableBreakpoints` in
  the upstream types if you need to expose a size control in the UI. `info` (`{id, name}`) records
  _which_ model this is — purely bookkeeping (see `getLoadedModel()`), for the Preset Management
  epic to know what to save; omit it for one-off/test loads.
- `loadIR(audioBuffer, mix?, info?)` / `setIrMix(mix)` / `getIrMix()` / `clearIR()` — cabinet
  convolution and its wet/dry blend, independent of model loading. Same `info` bookkeeping via
  `getLoadedIr()`.
- `dispose()` — tears down the wasm instance and disconnects every node. Not reusable afterwards;
  create a new chain.

## `assetCache`

A tiny IndexedDB blob cache (`getCachedAsset` / `putCachedAsset` / `deleteCachedAsset` /
`fetchWithCache`) for downloaded `.nam` and IR files, so Tone3000 imports (see the Tone3000
Integration epic) survive a page reload and work offline. Not NAM-specific — it's just
id -> `Blob`.

```ts
import { fetchWithCache } from '@/engine/assetCache'

const modelBlob = await fetchWithCache(tone3000ModelId, tone3000DownloadUrl)
const modelJson = await modelBlob.text()
```

Tests run this module under the Vitest `node` environment (see the `@vitest-environment node`
docblock in `assetCache.test.ts`) with `fake-indexeddb`, not jsdom — jsdom's `Blob` doesn't survive
`fake-indexeddb`'s structured clone with its prototype intact, while Node's native `Blob` does.

## `DualChainRig`

Two full signal chains, each `preFx -> AmpCabChain -> postFx -> [level/pan/mute strip]`, summed to
a master bus — the architecture diagram's `[FX] -> [NAM amp] -> [IR cab] -> [FX]` per side, now
that the Effects Suite epic exists to fill those `[FX]` slots (they were placeholders before it).

```ts
import { NamEngine } from 'neural-amp-modeler-wasm/engine'
import { DualChainRig } from '@/engine/DualChainRig'
import { Compressor } from '@/effects/Compressor'
import { Freeverb } from '@/effects/Freeverb'

const context = new AudioContext()
const engine = await NamEngine.attach(context)
const rig = await DualChainRig.create(context, engine) // chain A pans hard left, B hard right

await rig.amp('A').loadModel(ampAJson, undefined, { id: 'tone3000:123', name: 'Deluxe Reverb' })
await rig.amp('B').loadModel(ampBJson)
rig.amp('A').loadIR(cabAIr)
rig.amp('B').loadIR(cabBIr)

rig.preFx('A').insert(await Compressor.create(context)) // before the amp
rig.postFx('A').insert(new Freeverb(context)) // after the amp+cab

rig.connectInput(instrumentSource, 'mono-to-both') // or 'stereo-split' for a stereo source
rig.outputNode.connect(context.destination)
```

- **Input routing** (`connectInput`): `mono-to-both` duplicates a single source to both chains —
  the common case, one instrument through two different amp voicings for stereo width.
  `stereo-split` splits a stereo source's L/R channels, one per chain, for a genuinely stereo
  source (e.g. two mic'd amps, a stereo pickup). This is a routing decision, not a device/hardware
  one — actual input device selection is the Audio I/O Management epic's job; this just says what
  to do with whatever source node that epic hands over.
- **`preFx(chain)` / `postFx(chain)`** — each returns an `EffectsChain` (see the Effects Suite
  epic/`src/effects/README.md`) that's already wired into the signal path; `insert`/`remove`/`move`
  on it exactly as documented there.
- **Per-chain controls**: `setLevel`, `setPan`, `setEffectivelyMuted` (already-resolved mute, see
  below), `setMasterLevel`. These are the raw imperative Web Audio calls — for reactive state, use
  the store (next section).
- Chains default hard-panned left/right because that's the point of running two amp models at
  once. Nothing stops a caller from narrowing the pan via `setPan`.
- `dispose()` also disposes every effect currently in each side's `preFx`/`postFx` chains —
  `EffectsChain.dispose()` itself only tears down its own wiring, not the effects it holds (they
  might be reused elsewhere), so the rig does that bookkeeping explicitly.

## `dualChainStore` + `bindDualChainRig`

`useDualChainStore` (Zustand, `src/state/dualChainStore.ts`) is the reactive source of truth for
the rig's channel-strip state: `chainA`/`chainB` (`level`, `pan`, `mute`, `solo`), `masterLevel`,
and a `linked` toggle. It's pure state/logic with no Web Audio dependency, so it's fully unit
tested without a real `AudioContext`.

**Solo behavior**: soloing a chain doesn't set the other chain's `mute` flag — it's resolved via
`isEffectivelyMuted(chain)`, which returns true if that chain is explicitly muted, or if the
_other_ chain is soloed and this one isn't. Soloing both chains cancels out (neither is silenced).

**Link behavior** (mirroring "for fast A/B tone matching" per the epic): what "mirror" means
differs by control, because the two chains are intentionally asymmetric (opposite pan) by default:

- `level` and `mute` mirror **identically** — you generally want both chains at the same loudness.
- `pan` mirrors **symmetrically** (setting A's pan to `p` sets B's to `-p`) — keeps the stereo
  image centered while widening/narrowing both sides together, instead of collapsing it to mono.
- `solo` is **never** mirrored — soloing is inherently "just this one."

`bindDualChainRig(store, rig)` subscribes the store to a `DualChainRig` (or any object matching its
narrow `DualChainRigControls` interface — tests pass a plain mock, no `AudioContext` needed) and
keeps the rig's live audio params in sync with store changes. Returns an unsubscribe function.

```ts
import { useDualChainStore } from '@/state/dualChainStore'
import { bindDualChainRig } from '@/engine/bindDualChainRig'

const unbind = bindDualChainRig(useDualChainStore, rig)
// ...
unbind() // when disposing the rig
```

## Verified manually

Two rounds of manual browser verification (temporary harnesses, removed after use — search the
git history for `DevHarness.tsx` if you need to reproduce one):

1. Two concurrent `AmpCabChain` instances (same engine/context), each loading a real `.nam` model
   and IR, driven by independent oscillators for 2 seconds. Both models loaded in ~70 ms combined,
   no errors, no audio dropouts. Confirms the "one wasm module, N nodes" design holds with 2 chains
   running at once. (Chrome's `performance.memory` heap-delta reading in that run wasn't sensitive
   enough to be a meaningful memory benchmark on its own — the upstream project's own figures,
   50-75 MB peak per `AudioWorkletGlobalScope` for the whole engine regardless of node count, are
   the more useful number here.)
2. A full `DualChainRig` + store binding: both chains loaded, mono source routed to both
   (`mono-to-both`), soloing chain A while it's playing (correctly silenced B), then linking and
   panning A from hard-left to center mid-playback (B mirrored to center too, confirming the
   symmetric-pan link behavior) — no errors throughout.
