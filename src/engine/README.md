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

- `loadModel(json, slimSize?)` — load a `.nam` file's contents (a JSON string). `slimSize` only
  applies to slimmable (e.g. A2) models; see `NamModelInfo.slimmable`/`slimmableBreakpoints` in the
  upstream types if you need to expose a size control in the UI.
- `loadIR(audioBuffer, mix?)` / `setIrMix(mix)` / `clearIR()` — cabinet convolution and its
  wet/dry blend, independent of model loading.
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

## Verified manually

Ran two concurrent `AmpCabChain` instances (same engine/context) each loading a real `.nam` model
and IR, driven by independent oscillators for 2 seconds. Both models loaded in ~70 ms combined, no
errors, no audio dropouts. Confirms the "one wasm module, N nodes" design holds up with 2 chains
running at once. (Chrome's `performance.memory` heap-delta reading in that same run wasn't
sensitive enough to be a meaningful memory benchmark on its own — the upstream project's own
figures, 50-75 MB peak per `AudioWorkletGlobalScope` for the whole engine regardless of node count,
are the more useful number here.)
