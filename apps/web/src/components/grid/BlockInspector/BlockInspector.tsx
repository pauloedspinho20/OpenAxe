import { useEffect, useState } from 'react'
import { HardwareButton, Knob, MixerIcon, Panel } from '@openaxe/ui'
import { useGraphStore } from '../../../state/graphStore'
import { useSelection } from '../../../state/selection'
import { useEngineVersion } from '../../../state/engineVersion'
import { useTone3000Library } from '../../../tone3000/library'
import type { GraphRig } from '../../../engine/GraphRig'
import { NAM_MODEL_KINDS } from '../../../engine/blocks/blockRegistry'
import type { AmpBlock } from '../../../engine/blocks/AmpBlock'
import { EffectParamsPanel } from '@/components/global/EffectParamsPanel/EffectParamsPanel'
import { LiveMeter } from '@/components/global/LiveMeter/LiveMeter'
import { NamModelDetails, NamModel } from '../NamModelDetails/NamModelDetails'
import { AudioReactiveArt } from '../audioArt/AudioReactiveArt'
import { toArtVariant } from '../audioArt/sketches'
import { getParamSchema, getReverbRawSchemas } from '../../../effects/paramSchema'
import type { EffectParams } from '../../../effects/Effect'
import { BLOCK_KIND_LABELS } from '../blockOptions'
import styles from './BlockInspector.module.css'

function RawReverbPanel({
  blockId,
  block,
  schemas,
}: {
  blockId: string
  block: NonNullable<ReturnType<GraphRig['getBlock']>>
  schemas: ReturnType<typeof getReverbRawSchemas>
}) {
  const [values, setValues] = useState(() => ({
    ...block.getParams(),
    ...useGraphStore.getState().blocks.find((b) => b.id === blockId)?.params,
  }))
  const storeKey = useGraphStore((s) => {
    const p = s.blocks.find((b) => b.id === blockId)?.params
    return p ? JSON.stringify(p) : ''
  })
  useEffect(() => {
    if (!storeKey) return
    const parsed = JSON.parse(storeKey) as EffectParams
    setValues((prev) => ({ ...prev, ...parsed }))
  }, [storeKey])
  useEffect(() => {
    const latest = useGraphStore.getState().blocks.find((b) => b.id === blockId)?.params
    setValues({ ...block.getParams(), ...(latest ?? {}) })
  }, [block, blockId])
  const setParam = (key: string, value: number | string) => {
    useGraphStore.getState().setBlockParams(blockId, { [key]: value })
    setValues((prev) => ({ ...prev, [key]: value }))
  }
  return (
    <div>
      <span className="label" style={{ fontSize: 11, opacity: 0.7 }}>
        Raw params (direct core symbols — bypass the Size/Damping abstraction)
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        {schemas.map((field) => {
          if (field.control === 'select') return null
          const cur =
            typeof values[field.key] === 'number'
              ? (values[field.key] as number)
              : field.defaultValue
          return (
            <Knob
              key={field.key}
              label={field.label}
              value={cur}
              min={field.min}
              max={field.max}
              step={field.step}
              defaultValue={field.defaultValue}
              formatValue={field.formatValue}
              size={36}
              onChange={(v: number) => setParam(field.key, v)}
            />
          )
        })}
      </div>
    </div>
  )
}

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
  useTone3000Library((s) => s.version)
  const libraryEntries = useTone3000Library((s) => s.entries)
  const selectedBlockId = useSelection((s) => s.selectedBlockId)
  const blocks = useGraphStore((s) => s.blocks)
  const instance = blocks.find((b) => b.id === selectedBlockId) ?? null
  const [reverbExpert, setReverbExpert] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)

  // The selected block can disappear (removed, or a preset load replaced
  // the whole graph) without anything telling the selection store - drop a
  // now-dangling selection rather than silently showing stale content.
  useEffect(() => {
    if (selectedBlockId && !instance) useSelection.getState().clear()
  }, [selectedBlockId, instance])

  // Reset expert toggle when switching blocks.
  useEffect(() => {
    if (instance?.id) setReverbExpert(false)
  }, [instance?.id])

  useEffect(() => {
    if (instance?.id) setDetailsOpen(false)
  }, [instance?.id])

  if (!instance) {
    return (
      <Panel>
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
  const bypassed = instance.bypass ?? false
  const analyser = rig?.getBlockAnalyser(instance.id) ?? null
  const isReverb = instance.kind === 'reverb'
  const reverbAlgorithm = (instance.params.reverbAlgorithm as string) ?? 'hall'
  const expertSchemas = isReverb && reverbExpert ? getReverbRawSchemas(reverbAlgorithm) : []
  const isNamCore = NAM_MODEL_KINDS.has(instance.kind)
  const loaded = isNamCore ? ((block as AmpBlock | null)?.getLoadedModel?.() ?? null) : null
  const libraryEntry = loaded ? (libraryEntries.find((e) => e.id === loaded.id) ?? null) : null
  const artVariant = toArtVariant(instance.kind)
  const artAnalyser = analyser
  return (
    <Panel>
      <div className={styles.inspectorLayout}>
        <div className={styles.background}>
          {isNamCore ? (
            <NamModel
              kindLabel={label}
              loadedName={loaded?.name ?? null}
              entry={libraryEntry}
              instance={instance}
              block={block}
              context={context}
            />
          ) : (
            <div className={styles.artSquare}>
              <span className={`label ${styles.artLabel}`}>{label}</span>
              <AudioReactiveArt analyser={artAnalyser} variant={artVariant} />
            </div>
          )}
        </div>
        <div className={styles.content}>
          {!block && <p className={styles.empty}>Power on to edit this block.</p>}

          {block && schema.length > 0 && (
            <div className={styles.meterAndParams}>
              <EffectParamsPanel
                key={`${instance.id}-${reverbExpert ? 'expert' : 'simple'}`}
                blockId={instance.id}
                block={block}
              />
              <div className={styles.buttons}>
                <button
                  type="button"
                  className={`${styles.bypassBtn} ${bypassed ? '' : styles.bypassBtnOn}`}
                  onClick={() => {
                    useGraphStore.getState().setBlockBypass(instance.id, !bypassed)
                    ;(block as MaybeBypassable | null)?.setBypass?.(!bypassed)
                  }}
                  title={bypassed ? 'Bypassed - click to enable' : 'Click to bypass'}
                  aria-label={bypassed ? `Enable ${label}` : `Bypass ${label}`}
                ></button>
                {isNamCore && (
                  <HardwareButton
                    label="Load"
                    icon={<MixerIcon size={16} />}
                    onClick={() => setDetailsOpen(true)}
                    iconOnly
                  />
                )}
              </div>
              {block && analyser && <LiveMeter variant="medium" analyser={analyser} />}
            </div>
          )}
          {block && isReverb && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
              <HardwareButton
                label={reverbExpert ? 'Simple' : 'Expert'}
                active={reverbExpert}
                onClick={() => setReverbExpert((v) => !v)}
                title={reverbExpert ? 'Show simple controls' : 'Show raw Dragonfly params'}
              />
              {reverbExpert && expertSchemas.length > 0 && (
                <span className="label" style={{ fontSize: 11 }}>
                  {reverbAlgorithm} — {expertSchemas.length} raw params
                </span>
              )}
            </div>
          )}
          {block && reverbExpert && expertSchemas.length > 0 && (
            <div className={styles.meterAndParams} style={{ marginTop: 8 }}>
              <RawReverbPanel
                key={`${instance.id}-raw-${reverbAlgorithm}`}
                blockId={instance.id}
                block={block}
                schemas={expertSchemas}
              />
            </div>
          )}
          {block && schema.length === 0 && !isAssetKind && (
            <div className={styles.meterAndParams}>
              <p className={styles.empty}>This block has no editable parameters.</p>
              {analyser && <LiveMeter variant="mini" analyser={analyser} />}
            </div>
          )}
        </div>
      </div>
      {isNamCore && (
        <NamModelDetails
          open={detailsOpen}
          onClose={() => setDetailsOpen(false)}
          kindLabel={label}
          loadedName={loaded?.name ?? null}
          entry={libraryEntry}
        />
      )}
    </Panel>
  )
}
