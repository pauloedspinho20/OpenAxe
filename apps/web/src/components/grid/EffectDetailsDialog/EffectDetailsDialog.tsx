import { useEffect, useState } from 'react'
import { Dialog, HardwareButton, Knob, Select } from '@openaxe/ui'
import type { GraphRig } from '../../../engine/GraphRig'
import type { BlockKind } from '../../../engine/blocks/Block'
import type { EffectParams } from '../../../effects/Effect'
import { getParamSchema, getReverbRawSchemas } from '../../../effects/paramSchema'
import { useGraphStore } from '../../../state/graphStore'
import { BLOCK_KIND_LABELS } from '../blockOptions'
import styles from './EffectDetailsDialog.module.css'

interface Props {
  open: boolean
  onClose: () => void
  kind: BlockKind
  blockId: string | null
  rig: GraphRig | null
}

function groupFields(schema: ReturnType<typeof getParamSchema>) {
  const groups = new Map<string, typeof schema>()
  for (const f of schema) {
    const k = f.group ?? ''
    const list = groups.get(k)
    if (list) list.push(f)
    else groups.set(k, [f])
  }
  return Array.from(groups.entries())
}

export function EffectDetailsDialog({ open, onClose, kind, blockId, rig }: Props) {
  const schema = getParamSchema(kind)
  const label = BLOCK_KIND_LABELS[kind] ?? kind
  const isReverb = kind === 'reverb'
  const instance = useGraphStore((s) =>
    blockId ? s.blocks.find((b) => b.id === blockId) : undefined,
  )
  const reverbAlgorithm = (instance?.params.reverbAlgorithm as string) ?? 'hall'
  const rawSchemas = isReverb ? getReverbRawSchemas(reverbAlgorithm) : []

  // Attach descriptions to raw schemas (they are generated with no description)
  const rawDescriptions: Record<string, string> = {
    dry_level: 'Dry signal level preserved before wet blend.',
    early_level: 'Level of early reflections. Controls initial room snap.',
    late_level: 'Level of late/diffuse field. Controls wash.',
    size: 'Virtual size in metres. Larger = longer paths.',
    width: 'Stereo width of the field.',
    delay: 'Pre-delay / delay before late onset (Hall uses delay).',
    diffuse: 'Diffusion amount. Higher = smoother, less fluttery.',
    low_cut: 'High-pass on input. Removes low rumble from reverb.',
    low_xo: 'Crossover for low-frequency decay multiplier.',
    low_mult: 'Multiplier for low decay. Shapes bass tail.',
    high_cut: 'Low-pass on input. Darkens reverb input.',
    high_xo: 'Crossover for high damping.',
    high_mult: 'Multiplier for high decay. Controls brightness of tail.',
    spin: 'Spin modulation rate in late field.',
    wander: 'Wander time modulation. Adds lush movement.',
    decay: 'Decay time in seconds. Direct control of tail length.',
    early_send: 'Send from early into late. Controls build-up.',
    modulation: 'Modulation depth in late field.',
    predelay: 'Pre-delay before reverb onset.',
    in_high_cut: 'Input high cut for Room.',
    early_damp: 'Damping of early reflections.',
    late_damp: 'Damping of late field.',
    low_boost: 'Low-frequency boost amount.',
    boost_freq: 'Frequency of low boost.',
    in_low_cut: 'Input low cut.',
    algorithm: 'Plate algorithm variant.',
    program: 'Early-reflections program/preset.',
  }

  const block = blockId && rig ? rig.getBlock(blockId) : null

  const [values, setValues] = useState<EffectParams>(() => ({
    ...(block?.getParams() ?? {}),
    ...(instance?.params ?? {}),
  }))
  const storeKey = useGraphStore((s) => {
    if (!blockId) return ''
    const p = s.blocks.find((b) => b.id === blockId)?.params
    return p ? JSON.stringify(p) : ''
  })
  useEffect(() => {
    if (!storeKey) return
    const parsed = JSON.parse(storeKey) as EffectParams
    setValues((prev) => ({ ...prev, ...parsed }))
  }, [storeKey])
  useEffect(() => {
    if (!open) return
    const latest = blockId
      ? useGraphStore.getState().blocks.find((b) => b.id === blockId)?.params
      : undefined
    setValues({ ...(block?.getParams() ?? {}), ...(latest ?? {}) })
  }, [open, block, blockId])

  const setParam = (key: string, value: number | string) => {
    if (!blockId) return
    useGraphStore.getState().setBlockParams(blockId, { [key]: value })
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  const renderField = (field: ReturnType<typeof getParamSchema>[number], size = 52) => {
    if (field.control === 'select') {
      const current =
        typeof values[field.key] === 'string' ? (values[field.key] as string) : field.defaultValue
      return (
        <div key={field.key} className={styles.selectWrapper} title={field.description}>
          <Select
            value={current}
            onChange={(e) => setParam(field.key, e.target.value)}
            className={styles.selectField}
          >
            {field.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <span className={`label ${styles.selectLabel}`}>{field.label}</span>
          {field.description && <span className={styles.desc}>{field.description}</span>}
        </div>
      )
    }
    const current =
      typeof values[field.key] === 'number' ? (values[field.key] as number) : field.defaultValue
    return (
      <div key={field.key} className={styles.fieldCard}>
        <Knob
          label={field.label}
          value={current}
          min={field.min}
          max={field.max}
          step={field.step}
          defaultValue={field.defaultValue}
          formatValue={field.formatValue}
          size={size}
          description={field.description}
          onChange={(v) => setParam(field.key, v)}
        />
        {field.description && <span className={styles.desc}>{field.description}</span>}
      </div>
    )
  }

  return (
    <Dialog open={open} onClose={onClose} title={`${label} Details`} width={720}>
      <div className={styles.body}>
        <div className={styles.header}>
          <h3>{label}</h3>
          <p>
            All controls for this block, including expert / raw parameters. Hover a knob for a
            tooltip; descriptions are also shown below each control.
          </p>
        </div>

        {schema.length === 0 && rawSchemas.length === 0 ? (
          <p className={styles.empty}>This block has no editable parameters.</p>
        ) : (
          <>
            {schema.length > 0 && (
              <div className={styles.section}>
                <span className={styles.sectionTitle}>Controls</span>
                {groupFields(schema).map(([g, fields]) => (
                  <div key={g || '_'} className={styles.fields}>
                    {fields.map((f) => renderField(f))}
                  </div>
                ))}
              </div>
            )}

            {isReverb && rawSchemas.length > 0 && (
              <div className={styles.section}>
                <span className={styles.sectionTitle}>
                  Expert — raw Dragonfly symbols ({reverbAlgorithm})
                </span>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--ink-3)' }}>
                  Direct core symbols. These bypass the Size/Damping abstraction and map 1:1 to the
                  DSP. Useful for fine-tuning per-algorithm behaviour.
                </p>
                <div className={styles.fields}>
                  {rawSchemas.map((f) => {
                    if (f.control === 'select') return null
                    const desc =
                      (f as { description?: string }).description ??
                      rawDescriptions[f.key] ??
                      `Raw param ${f.key}.`
                    const enriched = { ...f, description: desc } as typeof f & {
                      description: string
                    }
                    return renderField(enriched, 44)
                  })}
                </div>
              </div>
            )}
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <HardwareButton label="Close" onClick={onClose} />
        </div>
      </div>
    </Dialog>
  )
}
