import { useEffect } from 'react'
import { Panel } from '../primitives/Panel'
import { useGraphStore } from '../../state/graphStore'
import { useSelection } from '../../state/selection'
import { useEngineVersion } from '../../state/engineVersion'
import type { GraphRig } from '../../engine/GraphRig'
import type { AmpBlock } from '../../engine/blocks/AmpBlock'
import type { CabBlock } from '../../engine/blocks/CabBlock'
import { AssetScreenButton } from './AssetScreenButton'
import { EffectParamsPanel } from '../EffectParamsPanel'
import { getParamSchema } from '../../effects/paramSchema'
import { BLOCK_KIND_LABELS } from './blockOptions'
import styles from './BlockInspector.module.css'

export interface BlockInspectorProps {
  rig: GraphRig | null
  context: AudioContext | null
}

/**
 * The full editing surface for whichever block is selected in the grid -
 * asset loading (Amp/Cab) and every tunable parameter. BlockCard itself
 * only shows basic info (kind, bypass, a one-line status); this is where
 * the detail actually lives, so cards stay small and legible at grid scale.
 */
export function BlockInspector({ rig, context }: BlockInspectorProps) {
  // Re-render once async block creation finishes - see BlockCard for why.
  useEngineVersion((s) => s.version)
  const selectedBlockId = useSelection((s) => s.selectedBlockId)
  const blocks = useGraphStore((s) => s.blocks)
  const instance = blocks.find((b) => b.id === selectedBlockId) ?? null

  // The selected block can disappear (removed, or a preset load replaced
  // the whole graph) without anything telling the selection store - drop a
  // now-dangling selection rather than silently showing stale content.
  useEffect(() => {
    if (selectedBlockId && !instance) useSelection.getState().clear()
  }, [selectedBlockId, instance])

  if (!instance) {
    return (
      <Panel label="Block Inspector">
        <p className={styles.empty}>
          Select a block in the grid to see its parameters and options.
        </p>
      </Panel>
    )
  }

  const block = rig?.getBlock(instance.id) ?? null
  const schema = getParamSchema(instance.kind)
  const label = BLOCK_KIND_LABELS[instance.kind]
  const isAssetKind = instance.kind === 'amp' || instance.kind === 'cab'

  return (
    <Panel label={`Block Inspector · ${label}`}>
      <div className={styles.content}>
        {!block && <p className={styles.empty}>Power on to edit this block.</p>}
        {block && instance.kind === 'amp' && (
          <AssetScreenButton
            blockId={instance.id}
            kind="amp"
            block={block as AmpBlock}
            context={context}
          />
        )}
        {block && instance.kind === 'cab' && (
          <AssetScreenButton
            blockId={instance.id}
            kind="cab"
            block={block as CabBlock}
            context={context}
          />
        )}
        {block && schema.length > 0 && <EffectParamsPanel blockId={instance.id} block={block} />}
        {block && schema.length === 0 && !isAssetKind && (
          <p className={styles.empty}>This block has no editable parameters.</p>
        )}
      </div>
    </Panel>
  )
}
