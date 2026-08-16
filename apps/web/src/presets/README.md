# Preset management

Local-first (IndexedDB, no backend/accounts - see the scaffolding epic's decision), capturing the
full dual-chain state: both chains' model/IR identity, level/pan/mute/solo, pre/post FX chains
(each effect's kind, bypass, and parameters), plus master level and the link toggle.

This module builds the data layer end to end. The preset **browser UI** (grid/list, thumbnails,
search/filter, favoriting) is the UI/UX epic's job, same as the drag-and-drop reordering UI in the
Effects Suite epic - the mechanism is ready for it to call into.

## What made this possible: effect parameter round-tripping

Presets need to capture and restore _every_ tunable value on _every_ effect without a giant
per-effect-type switch statement. Two additions make that generic:

- **`Effect.kind`** (`src/effects/Effect.ts`) - a stable machine-readable id per effect class
  (`'drive'`, `'reverb'`, etc.), distinct from `name` (a display label that can vary - e.g. `Delay`
  renders as "Tape Delay" depending on its character). Presets store `kind`, never `name`.
- **`Effect.getParams()`/`setParams()`** - every effect now reads its current values directly off
  the AudioParams/fields it already holds (e.g. `Compressor.getParams()` just reads
  `node.threshold.value`, `node.ratio.value`, etc.) and can restore them from a plain
  `Record<string, number | string | boolean>`. `src/effects/effectRegistry.ts`'s `createEffect(context,
kind, params)` reconstructs the right class from a saved `kind` and hands it its saved params.

## Architecture change this required: FX finally wired into the rig

The dual-chain epic's diagram always showed `[FX] -> [NAM amp] -> [IR cab] -> [FX]` per side, but
left the FX slots as placeholders since effects didn't exist yet. Now that they do,
`DualChainRig.preFx(chain)` / `postFx(chain)` expose a real `EffectsChain` on each side of the amp
block - see `src/engine/DualChainRig.ts` and its README section. This is also why `AmpCabChain`
(`src/engine/AmpCabChain.ts`) now tracks _which_ model/IR is currently loaded
(`getLoadedModel()`/`getLoadedIr()`, set via an optional `{id, name}` passed to
`loadModel`/`loadIR`), since presets need to record that identity, not just that _some_ model is
loaded.

## Schema (`types.ts`)

```
Preset
├── id, name, tags, favorite, createdAt, updatedAt
├── masterLevel, linked
├── chainA / chainB: ChainPresetData
│   ├── modelId/modelName, irId/irName, irMix   - references into assetCache, not raw bytes
│   ├── level, pan, mute, solo
│   └── preFx / postFx: EffectPresetData[]
│       └── kind, bypass, params
```

`PresetRig`/`PresetAmpChain`/`PresetEffectsChain` (also in `types.ts`) are narrow interfaces
covering only what capture/apply actually touch on `DualChainRig`/`AmpCabChain`/`EffectsChain` -
same reasoning as `bindDualChainRig`'s `DualChainRigControls`: tests mock these directly instead of
standing up a real `AudioContext`+wasm engine. The real classes already satisfy them structurally,
so nothing about the engine layer's public API needed to change to support this.

## Capture / apply (`capture.ts`, `apply.ts`)

```ts
import { capturePreset } from '@/presets/capture'
import { applyPreset } from '@/presets/apply'
import { savePreset, getPreset } from '@/presets/presetStore'

const preset = capturePreset('my-id', 'My Tone', rig, useDualChainStore)
await savePreset(preset)

// later, possibly after a reload:
const saved = await getPreset('my-id')
if (saved) {
  const { missingAssets } = await applyPreset(audioContext, saved, rig, useDualChainStore)
  // missingAssets: model/IR references not in the local cache (e.g. a preset shared by someone
  // else, referencing a Tone3000 asset never downloaded here) - everything else still applies.
}
```

`applyPreset` resolves `modelId`/`irId` against `assetCache` (from the Audio Engine Core epic)
only; it doesn't fetch from Tone3000 when an asset is missing locally. Wiring that fallback in is
the Tone3000 Integration epic's job.

## Storage (`presetStore.ts`) and sharing (`presetIO.ts`)

`presetStore.ts` is plain CRUD (`savePreset`/`getPreset`/`deletePreset`/`listPresets`) against a
`presets` object store, added to the same IndexedDB database `assetCache.ts` already used - both
now go through a shared `src/storage/db.ts` (`openDb`/`withStore`), since two modules independently
opening the same database name with different version numbers is a real way to hit IndexedDB
version-conflict errors.

`presetIO.ts` covers sharing, since there's no cloud sync: `presetToJson`/`presetFromJson` (with
real validation - malformed/hand-edited preset files fail with a specific message about which field
is wrong, not a generic parse error) for the portable format, plus thin browser-only
`downloadPresetAsFile`/`readPresetFromFile` helpers the UI/UX epic wires to buttons.

## Factory presets (`factoryPresets.ts`)

Three bundled starter presets (Clean Boost, Bedroom Overdrive, Ambient Swell) - FX-chain-only, no
`modelId`/`irId`. Same reasoning as the effects suite's licensing note, applied to sample content
instead of code: we don't bundle any third-party `.nam`/IR files, so a factory pack that also
recommends a specific amp model isn't possible yet. `installFactoryPresets()` seeds whichever ones
aren't already saved (by id), and never overwrites one a user has customized.

## Undo/redo and autosave (`src/state/undoStack.ts`, `autosave.ts`)

Both are generic, unwired utilities - infrastructure for the UI/UX epic rather than features with
their own UI here:

- **`UndoStack<T>`** - push/undo/redo over any snapshot type (a captured `Preset`, most likely),
  bounded history (default 50), the standard "pushing after an undo discards redo history" rule.
- **`createAutosaveScheduler(save, delayMs)`** - debounces rapid changes (e.g. dragging a knob)
  into one save once things settle; `schedule()`/`cancel()`/`flush()`.

## Verified manually

Built a real rig, loaded a model+IR (cached via `assetCache`), added FX, tweaked levels/pan/master,
captured and saved a preset, round-tripped it through JSON (byte-for-byte equal after
parse), then deliberately mutated every piece of state the preset should restore (levels, pan,
master, FX chain, model/IR) and applied the saved preset back - every value matched, zero missing
assets, zero errors. Also installed the factory pack and confirmed it doesn't clobber an existing
preset with the same id.
