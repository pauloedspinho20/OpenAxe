import { useState } from 'react'
import { HardwareButton, Select } from '@openaxe/ui'

import { FEATURES, FEATURE_BY_ID, type FeatureId } from '../audio/features'
import { CURVES } from '../modulation'
import type { ModCurve, Modulation, NumberParam, SceneDefinition } from '../types'
import { isModulatable } from '../types'
import styles from './Visuals.module.css'

interface ModulationEditorProps {
  def: SceneDefinition
  mods: readonly Modulation[]
  customized: boolean
  onChange: (mods: Modulation[]) => void
  onReset: () => void
}

let nextId = 0
const newId = () => `m-${Date.now().toString(36)}-${(nextId++).toString(36)}`

/**
 * The scene's audio routes: feature -> param, amount, curve and extra
 * smoothing. Starts as the scene's curated set; any edit stores a full copy
 * for that scene, "Reset" goes back to the curated set.
 */
export function ModulationEditor({
  def,
  mods,
  customized,
  onChange,
  onReset,
}: ModulationEditorProps) {
  const targets = def.params.filter(isModulatable)
  const [expanded, setExpanded] = useState<string | null>(null)

  const update = (id: string, patch: Partial<Modulation>) =>
    onChange(mods.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  const remove = (id: string) => onChange(mods.filter((m) => m.id !== id))
  const add = () => {
    const target = targets[0]
    if (!target) return
    const id = newId()
    onChange([
      ...mods,
      {
        id,
        param: target.key,
        source: 'volume',
        amount: 0.2,
        curve: 'linear',
        attack: 0,
        release: 0,
        enabled: true,
      },
    ])
    setExpanded(id)
  }

  const paramLabel = (key: string) => targets.find((p) => p.key === key)?.label ?? key

  return (
    <div className={styles.mods}>
      {mods.length === 0 && (
        <p className={styles.hint}>No audio routes. Add one to make a param react.</p>
      )}
      {mods.map((m) => {
        const open = expanded === m.id
        const target = targets.find((p) => p.key === m.param) as NumberParam | undefined
        return (
          <div key={m.id} className={`${styles.modRow} ${m.enabled ? '' : styles.modDisabled}`}>
            <div className={styles.modHead}>
              <input
                type="checkbox"
                checked={m.enabled}
                aria-label={`Enable ${FEATURE_BY_ID[m.source].label} to ${paramLabel(m.param)}`}
                onChange={(e) => update(m.id, { enabled: e.target.checked })}
              />
              <HardwareButton
                size="small"
                label={`${FEATURE_BY_ID[m.source].label} → ${paramLabel(m.param)}`}
                className={styles.modSummary}
                active={open}
                ariaExpanded={open}
                title={`${FEATURE_BY_ID[m.source].label} → ${paramLabel(m.param)} (click to edit)`}
                onClick={() => setExpanded(open ? null : m.id)}
              />
              <input
                type="range"
                className={`${styles.slider} ${styles.amountSlider}`}
                min={-1}
                max={1}
                step={0.01}
                value={m.amount}
                aria-label="Amount"
                title={`Amount ${Math.round(m.amount * 100)}% of range (double-click: 0)`}
                onChange={(e) => update(m.id, { amount: Number(e.target.value) })}
                onDoubleClick={() => update(m.id, { amount: 0 })}
              />
              <span className={styles.paramValue}>{Math.round(m.amount * 100)}%</span>
            </div>
            {open && (
              <div className={styles.modBody}>
                <label className={styles.modField}>
                  <span>Source</span>
                  <Select
                    value={m.source}
                    onChange={(e) => update(m.id, { source: e.target.value as FeatureId })}
                    aria-label="Source"
                  >
                    {FEATURES.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className={styles.modField}>
                  <span>Param</span>
                  <Select
                    value={m.param}
                    onChange={(e) => update(m.id, { param: e.target.value })}
                    aria-label="Param"
                  >
                    {targets.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.group} · {p.label}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className={styles.modField}>
                  <span>Curve</span>
                  <Select
                    value={m.curve}
                    onChange={(e) => update(m.id, { curve: e.target.value as ModCurve })}
                    aria-label="Curve"
                  >
                    {CURVES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className={styles.modField}>
                  <span>Attack</span>
                  <input
                    type="range"
                    className={styles.slider}
                    min={0}
                    max={2}
                    step={0.01}
                    value={m.attack}
                    onChange={(e) => update(m.id, { attack: Number(e.target.value) })}
                  />
                  <span className={styles.paramValue}>{m.attack.toFixed(2)}s</span>
                </label>
                <label className={styles.modField}>
                  <span>Release</span>
                  <input
                    type="range"
                    className={styles.slider}
                    min={0}
                    max={4}
                    step={0.01}
                    value={m.release}
                    disabled={FEATURE_BY_ID[m.source].cyclic}
                    onChange={(e) => update(m.id, { release: Number(e.target.value) })}
                  />
                  <span className={styles.paramValue}>{m.release.toFixed(2)}s</span>
                </label>
                <p className={styles.hint}>
                  {FEATURE_BY_ID[m.source].description}
                  {target &&
                    ` At full ${FEATURE_BY_ID[m.source].label.toLowerCase()}, ${target.label} moves by ${(
                      m.amount *
                      (target.max - target.min)
                    ).toFixed(2)}${target.unit ?? ''}.`}
                </p>
                <HardwareButton
                  size="small"
                  variant="danger"
                  label="Remove route"
                  onClick={() => remove(m.id)}
                />
              </div>
            )}
          </div>
        )
      })}
      <div className={styles.rowActions}>
        <HardwareButton size="small" label="+ Add route" onClick={add} />
        {customized && (
          <HardwareButton size="small" label="Reset to scene defaults" onClick={onReset} />
        )}
      </div>
    </div>
  )
}
