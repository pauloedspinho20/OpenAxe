# Audio engine

The web app's Web Audio layer around `packages/core`. Every block on the grid — amp, effect, cab,
mixer, splitter — is built here, and the DSP inside all of them is the **same C++ core the desktop
app and the (planned) plugin run**, compiled to WASM and driven from an `AudioWorklet`. This layer
owns the Web Audio plumbing between those worklets, not the audio maths.

See [ARCHITECTURE.md](../../../../ARCHITECTURE.md) for the whole picture, including what still
lives on this side of the line and in what order it moves into the core.

## `NamAmpNode`

A NAM amp as an `AudioWorkletNode`, backed by the core's own `NamAmp` inference via
`public/wasm-core/ampWorklet.js`.

This replaced the `neural-amp-modeler-wasm` npm package, which was a second, independently
compiled NAM engine: the desktop app already drove `packages/core`, so the same capture could
behave differently per platform. Now there is one inference implementation.

```ts
import { NamAmpNode } from '@/engine/NamAmpNode'

const amp = await NamAmpNode.create(context)
source.connect(amp.node) // `node` is the AudioWorkletNode itself
amp.node.connect(destination)

const info = await amp.loadModel(namFileJsonText) // { sampleRate, loudnessDb, slimmable, ... }
if (info.slimmable) await amp.setSlimSize(0.5) // trade fidelity for CPU
amp.setToneGainDb('bass', 6) // the core's 4-band tone stack, ±12dB per band
await amp.dispose() // frees the capture in WASM instead of waiting for context close
```

Notes worth knowing:

- **Model loading is a port message, not an AudioParam**, so those methods are async. The JSON is
  encoded on the main thread and the buffer is transferred — `AudioWorkletGlobalScope` has no
  `TextEncoder`, and it keeps that pass off the audio thread.
- **Parsing happens on the audio thread**, inside the core's load call, which briefly blocks
  rendering for large captures. The upstream npm engine had the same characteristic; the desktop
  app pays the same cost on its control thread with audio suspended.
- The **tone stack runs in the core too** (`dsp/tone_stack.cpp`), driven through the worklet's
  AudioParams. `AmpBlock` used to implement it with four Web Audio `BiquadFilterNode`s, which is why
  the desktop app - on the same core - had no working Bass/Mid/Treble/Presence at all.
- Each node holds its own WASM instance and one-block graph (`IN -> amp -> OUT`), like every
  effect worklet — see `public/wasm-core/namStudioEffectBase.js`.
- The core's `input_level`/`output_level` params are the **capture's own dBu calibration**, not
  user-facing levels. The Input/Output knobs are block trims (`AmpBlock`'s gain stages on web,
  `nam_studio_set_block_input_trim` on desktop).

## `GraphRig` + `blocks/`

`GraphRig` places blocks on the grid, wires cables between their jacks, and owns the master bus
(level/mute, plus a limiter before the destination, since arbitrary user-built parallel merges can
sum much hotter than a fixed two-chain mix). `blocks/blockRegistry.ts` builds any block from its
serialized `kind`; `blocks/AmpBlock.ts` wraps `NamAmpNode` with the block's own staging (input and
output trims, true bypass) and forwards the Bass/Mid/Treble/Presence knobs to the
core's tone stack through the worklet, and `blocks/CabBlock.ts` does IR convolution
with a `ConvolverNode`.

`graphValidation.ts` holds the connection rules — left-to-right by column (which makes cycles
impossible by construction), at most one cable per input jack, a mixer's several input ports and a
splitter's several output ports each counting separately. The core has the same rules in
`graph_validation.cpp`; that duplication is what step 2 of the migration in ARCHITECTURE.md
removes.

## `bindGraphRig`

`bindGraphRig(useGraphStore, rig)` subscribes the reactive graph store (`src/state/graphStore.ts`,
plain data — no Web Audio, fully unit tested without an `AudioContext`) to a live rig and
reconciles one into the other on every change, returning an unsubscribe function. It reapplies
every block's full params on each pass, which is why anything expensive behind a param setter
needs its own "did this actually change?" guard — see `AmpBlock.setModelSlimSize`.

## `assetCache`

A tiny IndexedDB blob cache (`getCachedAsset` / `putCachedAsset` / `deleteCachedAsset` /
`fetchWithCache`) for downloaded `.nam` and IR files, so Tone3000 imports survive a page reload and
work offline. Not NAM-specific — it's just id -> `Blob`.

```ts
import { fetchWithCache } from '@/engine/assetCache'

const modelBlob = await fetchWithCache(tone3000ModelId, tone3000DownloadUrl)
const modelJson = await modelBlob.text()
```

Tests run this module under the Vitest `node` environment (see the `@vitest-environment node`
docblock in `assetCache.test.ts`) with `fake-indexeddb`, not jsdom — jsdom's `Blob` doesn't survive
`fake-indexeddb`'s structured clone with its prototype intact, while Node's native `Blob` does.

## Verified in a browser

The core-backed amp path was checked end to end in an `OfflineAudioContext`: a real capture
(NAMCore's `lstm.nam`) loaded through `ampWorklet.js`, its metadata read back over the ABI
(48kHz, loudness -37.8dB, input 18.3dBu, output 12.3dBu), and an impulse rendered to 4096 finite
non-zero samples. A malformed model is rejected with an error instead of aborting the audio thread
— which needs `-fexceptions` in the WASM build, since Emscripten disables exceptions by default and
the core signals bad models by catching NAMCore's throws.
