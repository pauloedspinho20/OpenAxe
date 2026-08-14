import { NAM_MODEL_KINDS } from '../../engine/blocks/blockRegistry'
import type { BlockKind } from '../../engine/blocks/Block'
import type { Gear } from '../../tone3000/types'
import { useTone3000Browser } from '../../tone3000/browserStore'

/**
 * A freshly placed block never has a model/IR loaded yet, so its Tone3000
 * screen would otherwise sit there showing "NO MODEL LOADED" until the user
 * remembers to click it - open the catalog immediately instead, pre-filtered
 * to the new block's own gear type. No-op for kinds with no asset to load
 * (mixer, the 10 synthetic effects).
 */
export function openCatalogForNewBlock(blockId: string, kind: BlockKind): void {
  if (kind === 'cab') {
    useTone3000Browser.getState().openBrowser({ blockId, slot: 'ir', gear: 'cab' })
    return
  }
  if (NAM_MODEL_KINDS.has(kind)) {
    useTone3000Browser.getState().openBrowser({ blockId, slot: 'model', gear: kind as Gear })
  }
}
