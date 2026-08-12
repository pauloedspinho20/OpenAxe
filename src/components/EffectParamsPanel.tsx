import { useState } from 'react'
import { Knob } from './primitives/Knob'
import type { Effect, EffectParams } from '../effects/Effect'
import { EFFECT_PARAM_SCHEMAS, type ParamFieldSchema } from '../effects/paramSchema'
import styles from './EffectParamsPanel.module.css'

export interface EffectParamsPanelProps {
  effect: Effect
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
 */
export function EffectParamsPanel({ effect }: EffectParamsPanelProps) {
  const [values, setValues] = useState<EffectParams>(() => effect.getParams())
  const schema = EFFECT_PARAM_SCHEMAS[effect.kind]

  const setParam = (key: string, value: number | string) => {
    effect.setParams({ [key]: value })
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div className={styles.panel}>
      {groupFields(schema).map(([groupName, fields]) => (
        <div key={groupName || '_'} className={styles.group}>
          {groupName && <span className={`label ${styles.groupLabel}`}>{groupName}</span>}
          <div className={styles.fields}>
            {fields.map((field) => {
              if (field.control === 'select') {
                const current =
                  typeof values[field.key] === 'string'
                    ? (values[field.key] as string)
                    : field.defaultValue
                return (
                  <label key={field.key} className={styles.selectField}>
                    <span className="label">{field.label}</span>
                    <select
                      className={styles.select}
                      value={current}
                      onChange={(e) => setParam(field.key, e.target.value)}
                    >
                      {field.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )
              }

              const current =
                typeof values[field.key] === 'number'
                  ? (values[field.key] as number)
                  : field.defaultValue
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
                  size={44}
                  onChange={(value) => setParam(field.key, value)}
                />
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
