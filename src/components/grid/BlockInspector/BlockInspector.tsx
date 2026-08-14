import { useEffect } from 'react'
import { Panel } from '../../primitives/Panel/Panel'
import { HardwareButton } from '../../primitives/HardwareButton/HardwareButton'
import { useGraphStore } from '../../../state/graphStore'
import { useSelection } from '../../../state/selection'
import { useEngineVersion } from '../../../state/engineVersion'
import type { GraphRig } from '../../../engine/GraphRig'
import { EFFECT_KINDS, NAM_MODEL_KINDS } from '../../../engine/blocks/blockRegistry'
import type { AmpBlock } from '../../../engine/blocks/AmpBlock'
import type { CabBlock } from '../../../engine/blocks/CabBlock'
import { AssetScreenButton, type AssetGearType } from '../AssetScreenButton/AssetScreenButton'
import { EffectParamsPanel } from '@/components/global/EffectParamsPanel/EffectParamsPanel'
import { LiveMeter } from '@/components/global/LiveMeter/LiveMeter'
import { getParamSchema } from '../../../effects/paramSchema'
import { BLOCK_KIND_LABELS } from '../blockOptions'
import styles from './BlockInspector.module.css'

export interface BlockInspectorProps {
  rig: GraphRig | null
  context: AudioContext | null
}

/** Anything with an optional bypass toggle - the 11 effect kinds and the 5 NAM model kinds have one. */
interface MaybeBypassable {
  setBypass?(bypassed: boolean): void
}

/**
 * The full editing surface for whichever block is selected in the grid -
 * asset loading (Amp/Cab), bypass, a level meter, and every tunable
 * parameter. BlockCard itself only shows basic info (kind, a small bypass
 * dot, a one-line status); this is where the detail actually lives, so
 * cards stay small and legible at grid scale.
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
  const isAssetKind = NAM_MODEL_KINDS.has(instance.kind) || instance.kind === 'cab'
  const isEffect = EFFECT_KINDS.has(instance.kind)
  const hasBypass = isEffect || NAM_MODEL_KINDS.has(instance.kind)
  const bypassed = instance.bypass ?? false
  const analyser = rig?.getBlockAnalyser(instance.id) ?? null
  return (
    <Panel
      label={`Block Inspector · ${label}`}
      corner={
        block && (
          <HardwareButton
            label="Bypass"
            disabled={!hasBypass}
            active={bypassed}
            onClick={() => {
              useGraphStore.getState().setBlockBypass(instance.id, !bypassed)
              ;(block as MaybeBypassable | null)?.setBypass?.(!bypassed)
            }}
            title={bypassed ? 'Bypassed - click to enable' : 'Click to bypass'}
          />
        )
      }
    >
      <div className={styles.content}>
        {!block && <p className={styles.empty}>Power on to edit this block.</p>}

        {block && isAssetKind && (
          <AssetScreenButton
            blockId={instance.id}
            gearType={instance.kind as AssetGearType}
            block={block as AmpBlock | CabBlock}
            context={context}
          />
        )}
        {block && schema.length > 0 && (
          <div className={styles.meterAndParams}>
            <EffectParamsPanel key={instance.id} blockId={instance.id} block={block} />
            {block && analyser && <LiveMeter analyser={analyser} />}
          </div>
        )}
        {block && schema.length === 0 && !isAssetKind && (
          <p className={styles.empty}>This block has no editable parameters.</p>
        )}
      </div>
    </Panel>
  )
}
