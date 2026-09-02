import { Dialog, HardwareButton, Knob, Select } from '@openaxe/ui'
import type { GraphRig } from '../../../engine/GraphRig'
import type { BlockKind } from '../../../engine/blocks/Block'
import {
  getParamSchema,
  getReverbRawSchemas,
  type ParamFieldSchema,
} from '../../../effects/paramSchema'
import { useBlockParamValues } from '../../../effects/useBlockParamValues'
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

function groupFields(schema: ParamFieldSchema[]): Array<[string, ParamFieldSchema[]]> {
  const groups = new Map<string, ParamFieldSchema[]>()
  for (const field of schema) {
    const key = field.group ?? ''
    const list = groups.get(key)
    if (list) list.push(field)
    else groups.set(key, [field])
  }
  return Array.from(groups.entries())
}

/**
 * Raw core symbols the ReverbControl abstraction already owns, so the Expert
 * section must not offer a second knob for them.
 *
 * Two distinct hazards, both of which shipped in the first version of this
 * dialog:
 *
 *  - `width`, `predelay`, `spin` and `wander` are spelled identically as a
 *    raw symbol and as a REVERB_CONTROL key. The rig worklet checks
 *    `REVERB_CONTROL[message.key]` before the raw-param path, so writing the
 *    "raw" knob went through the abstraction anyway - scaled and clamped to
 *    the *abstraction's* range, not the symbol's. Two knobs, one param,
 *    different ranges, and the section header claiming a 1:1 mapping.
 *
 *  - `decay`, `high_cut`, `in_high_cut`, `delay`, `early_send` and
 *    `dry_level` are different store keys that resolve onto the same core
 *    param as roomSize / damping / predelay / earlySend / dryLevel. No
 *    worklet collision, but the two knobs silently fight: whichever moved
 *    last wins and the other's displayed position is a lie.
 *
 * Mirrors ReverbControlSymbols in packages/core/src/engine.cpp - keep the two
 * in step. Anything genuinely per-algorithm (size, diffuse, low_mult,
 * high_xo, program, ...) is still exposed, which is the point of the section.
 */
const REVERB_CONTROL_OWNED_SYMBOLS: ReadonlySet<string> = new Set([
  'decay',
  'high_cut',
  'in_high_cut',
  'width',
  'predelay',
  'delay',
  'spin',
  'wander',
  'early_send',
  'dry_level',
])

/** Help text for the raw per-algorithm symbols, which are generated without any. */
const RAW_DESCRIPTIONS: Readonly<Record<string, string>> = {
  early_level: 'Level of early reflections. Controls initial room snap.',
  late_level: 'Level of late/diffuse field. Controls wash.',
  size: 'Virtual size in metres. Larger = longer paths.',
  diffuse: 'Diffusion amount. Higher = smoother, less fluttery.',
  low_cut: 'High-pass on input. Removes low rumble from reverb.',
  low_xo: 'Crossover below which low_mult applies.',
  low_mult: 'Decay multiplier below low_xo. Shapes the bass tail.',
  high_xo: 'Crossover above which high_mult applies.',
  high_mult: 'Decay multiplier above high_xo. Brightness of the tail.',
  modulation: 'Modulation depth in the late field.',
  early_damp: 'Damping of early reflections.',
  late_damp: 'Damping of the late field.',
  low_boost: 'Low-frequency boost amount.',
  boost_freq: 'Frequency of the low boost.',
  in_low_cut: 'Input low cut.',
  algorithm: 'Plate algorithm variant.',
  program: 'Early-reflections program/preset.',
  // Spring tank (ReverbAlgorithm::kSpring) - the only spring-specific symbol
  // the abstraction has no home for.
  drive: 'Input transducer drive. Higher = more spring "crunch" before the tank.',
}

export function EffectDetailsDialog({ open, onClose, kind, blockId, rig }: Props) {
  const label = BLOCK_KIND_LABELS[kind] ?? kind
  const isReverb = kind === 'reverb'
  const block = blockId && rig ? rig.getBlock(blockId) : null
  const { values, setParam } = useBlockParamValues(blockId, block)

  const reverbAlgorithm = useGraphStore((s) =>
    blockId
      ? ((s.blocks.find((b) => b.id === blockId)?.params.reverbAlgorithm as string) ?? 'hall')
      : 'hall',
  )

  // Same `visible` filtering the inspector strip applies. Without it, Early
  // Reflections rendered live-looking roomSize/predelay/spin/wander/earlySend
  // knobs, and a Digital delay rendered wow_depth/wow_rate - controls the
  // algorithm has no symbol for, so the writes reach the store, get re-applied
  // forever by bindGraphRig, and map to nothing.
  const schema = getParamSchema(kind).filter((f) => !f.visible || f.visible(values))

  // Raw per-algorithm symbols, minus everything the abstraction already owns.
  const rawSchemas = isReverb
    ? getReverbRawSchemas(reverbAlgorithm).filter(
        (f) => f.control !== 'select' && !REVERB_CONTROL_OWNED_SYMBOLS.has(f.key),
      )
    : []

  const renderField = (field: ParamFieldSchema, size = 52) => {
    const description = field.description ?? RAW_DESCRIPTIONS[field.key]
    if (field.control === 'select') {
      const current =
        typeof values[field.key] === 'string' ? (values[field.key] as string) : field.defaultValue
      return (
        <div key={field.key} className={styles.selectWrapper} title={description}>
          <Select
            value={current}
            aria-label={field.label}
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
          {description && <span className={styles.desc}>{description}</span>}
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
          description={description}
          onChange={(v) => setParam(field.key, v)}
        />
        {description && <span className={styles.desc}>{description}</span>}
      </div>
    )
  }

  return (
    <Dialog open={open} onClose={onClose} title={`${label} Details`} width="720px">
      <div className={styles.body}>
        <div className={styles.header}>
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
                <span className={styles.sectionTitle}>Expert — {reverbAlgorithm} core symbols</span>
                <p className={styles.sectionNote}>
                  Per-algorithm core params with no equivalent in the shared controls above. The
                  ones the Size / Damping / Width / Pre-delay knobs already drive are deliberately
                  not repeated here.
                </p>
                <div className={styles.fields}>{rawSchemas.map((f) => renderField(f, 44))}</div>
              </div>
            )}
          </>
        )}

        <div className={styles.footer}>
          <HardwareButton label="Close" onClick={onClose} />
        </div>
      </div>
    </Dialog>
  )
}
