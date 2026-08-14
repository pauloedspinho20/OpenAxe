import { useMemo } from 'react'
import type { GraphRig } from '../engine/GraphRig'
import type { BrowserTarget } from '../tone3000/browserStore'
import type { BlockLoadTarget } from '../tone3000/importService'
import type { AmpBlock } from '../engine/blocks/AmpBlock'
import type { CabBlock } from '../engine/blocks/CabBlock'
import { useSettingsStore } from '../state/settingsStore'

/**
 * Resolves the live block the Tone3000 catalog should load into, given
 * which block/slot it's currently targeting. Null whenever that block
 * doesn't exist in the engine yet - which is genuinely true for a fraction
 * of a second right after adding a block, since block creation is async
 * (see bindGraphRig): the catalog auto-opens on the *graphStore* add, well
 * before the engine's own `rig.addBlock` has resolved.
 *
 * `engineVersion` must be a dependency here even though this function never
 * reads it directly - it's bumped by bindGraphRig the moment that async
 * creation finishes, and is the only signal this hook has that `rig.getBlock`
 * might return something different than it did on the last render. Drop it
 * from the deps and a model imported in that fraction-of-a-second window
 * downloads and caches into the library but never reaches the block - the
 * dialog closes as if it worked, and only trying again after the block
 * exists actually loads it.
 */
export function useTone3000Target(
  rig: GraphRig | null,
  browserTarget: BrowserTarget | null,
  engineVersion: number,
): BlockLoadTarget | null {
  return useMemo(() => {
    if (!browserTarget || !rig) return null
    const block = rig.getBlock(browserTarget.blockId)
    if (!block) return null
    if (browserTarget.slot === 'model') {
      return {
        loadModel: (json: string, info: { id: string; name: string }) =>
          (block as AmpBlock).loadModel(json, useSettingsStore.getState().namQuality, info),
        loadIR: () => {
          throw new Error('This block is not a Cab block')
        },
      }
    }
    return {
      loadModel: () => {
        throw new Error('This block is not an Amp block')
      },
      loadIR: (buffer: AudioBuffer, info: { id: string; name: string }) =>
        (block as CabBlock).loadIR(buffer, 1, info),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rig, browserTarget, engineVersion])
}
