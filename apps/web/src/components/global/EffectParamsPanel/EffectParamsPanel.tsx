import { useEffect, useState } from 'react'
import { Knob, Select } from '@openaxe/ui'
import type { Block, EffectParams } from '@/engine/blocks/Block'
import { getParamSchema, type ParamFieldSchema } from '@/effects/paramSchema'
import { useGraphStore } from '@/state/graphStore'
import styles from './EffectParamsPanel.module.css'

export interface EffectParamsPanelProps {
  blockId: string
  block: Block
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
 * Renders knob/select controls for one effect, driven entirely by its
 * paramSchema entry - one generic panel instead of bespoke UI per effect
 * kind. Local `values` state is the source of truth for what's displayed
 * (updated optimistically on every change) rather than re-reading
 * `effect.getParams()` after each edit: the underlying AudioParams ramp via
 * `setTargetAtTime`, so reading `.value` back immediately would show a
 * stale, not-yet-settled number and make the knobs visually stutter.
 *
 * Changes go through graphStore, not straight to the live block: bindGraphRig
 * re-applies every block's stored params on every reconcile pass (same
 * "always re-apply, cheap and idempotent" philosophy as the old
 * bindDualChainRig), so if a knob wrote directly to the engine instead, the
 * very next unrelated store change (adding some other block, say) would
 * silently revert it back to the store's stale copy.
 */
export function EffectParamsPanel({ blockId, block }: EffectParamsPanelProps) {
  const [values, setValues] = useState<EffectParams>(() => ({
    ...block.getParams(),
    ...useGraphStore.getState().blocks.find((b) => b.id === blockId)?.params,
  }))
  // Keep local values in sync when the store changes externally (undo, preset load, MIDI).
  // Use a stable key (JSON) so unrelated store updates don't retrigger the sync.
  const storeParamsKey = useGraphStore((s) => {
    const p = s.blocks.find((b) => b.id === blockId)?.params
    return p ? JSON.stringify(p) : ''
  })
  const storeParams = storeParamsKey ? (JSON.parse(storeParamsKey) as EffectParams) : undefined
  useEffect(() => {
    if (storeParams) setValues((prev) => ({ ...prev, ...storeParams }))
  }, [storeParamsKey])
  // Also sync when switching blocks (block instance identity changes).
  useEffect(() => {
    const latest = useGraphStore.getState().blocks.find((b) => b.id === blockId)?.params
    setValues({ ...block.getParams(), ...(latest ?? {}) })
  }, [block, blockId])
  const schema = getParamSchema(block.kind).filter((f) => !f.visible || f.visible(values))

  const setParam = (key: string, value: number | string) => {
    useGraphStore.getState().setBlockParams(blockId, { [key]: value })
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  const renderField = (field: ParamFieldSchema) => {
    if (field.control === 'select') {
      const current =
        typeof values[field.key] === 'string' ? (values[field.key] as string) : field.defaultValue
      return (
        <Select
          key={field.key}
          label={field.label}
          value={current}
          onChange={(e) => setParam(field.key, e.target.value)}
          className={styles.selectField}
        >
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      )
    }

    const current =
      typeof values[field.key] === 'number' ? (values[field.key] as number) : field.defaultValue
    return (
      <Knob
        key={field.key}
        label={field.label}
        value={current}
        min={field.min}
        max={field.max}
        step={field.step}
        defaultValue={field.defaultValue}
        formatValue={field.formatValue}
        size={50}
        onChange={(value) => setParam(field.key, value)}
      />
    )
  }

  return (
    <div className={styles.panel}>
      {groupFields(schema).map(([groupName, fields]) => {
        // Model/character-style selectors (primary) get their own row above
        // the knob cluster (and any non-primary selects like Drive's Diode),
        // so the "which model is this?" choice reads first.
        const selectors = fields.filter((f) => f.control === 'select' && f.primary)
        const mainFields = fields.filter((f) => !(f.control === 'select' && f.primary))
        return (
          <div key={groupName || '_'} className={styles.group}>
            {/*     {groupName && <span className={`label ${styles.groupLabel}`}>{groupName}</span>} */}
            {selectors.length > 0 && (
              <div className={styles.selectRow}>{selectors.map(renderField)}</div>
            )}
            <div className={styles.fields}>{mainFields.map(renderField)}</div>
          </div>
        )
      })}
    </div>
  )
}
