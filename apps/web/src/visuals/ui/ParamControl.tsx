import { useState } from 'react'
import { HardwareButton, Select } from '@openaxe/ui'

import { formatMidiMatch } from '../../midi/message'
import type { MidiBinding } from '../visualsStore'
import type { ParamValue, SceneParam } from '../types'
import { formatNumber } from './format'
import styles from './Visuals.module.css'

interface ParamControlProps {
  param: SceneParam
  value: ParamValue | undefined
  onChange: (value: ParamValue) => void
  onAction: (key: string) => void
  binding: MidiBinding | undefined
  learning: boolean
  onLearn: () => void
  onUnbind: () => void
  modulated: boolean
}

/**
 * One row of a scene's params. Rebuild params (shader recompiles) commit on
 * release instead of on every slider tick.
 */
export function ParamControl({
  param,
  value,
  onChange,
  onAction,
  binding,
  learning,
  onLearn,
  onUnbind,
  modulated,
}: ParamControlProps) {
  // A rebuild param's uncommitted slider position, valid only while the
  // stored value is still the one it was dragged from.
  const [pending, setPending] = useState<{ from: ParamValue | undefined; n: number } | null>(null)
  const draft = pending && pending.from === value ? pending.n : null
  const setDraft = (n: number) => setPending({ from: value, n })

  const midiButton =
    param.type === 'color' ? null : (
      // The wrapper adds right-click-to-remove, which HardwareButton has no prop for.
      <span
        className={styles.midiCell}
        onContextMenu={(e) => {
          if (!binding) return
          e.preventDefault()
          onUnbind()
        }}
      >
        <HardwareButton
          size="small"
          label={learning ? '…' : binding ? `CC${binding.match.number}` : 'MIDI'}
          ariaLabel={`MIDI learn ${param.label}`}
          active={Boolean(binding) || learning}
          variant={learning ? 'accent' : 'default'}
          className={styles.midiButton}
          onClick={learning ? onUnbind : onLearn}
          title={
            learning
              ? 'Move a knob or fader on your MIDI controller… (click to cancel)'
              : binding
                ? `Bound to ${formatMidiMatch(binding.match)} - click to re-learn, right-click to remove`
                : 'MIDI learn: click, then move a controller'
          }
        />
      </span>
    )

  const label = (
    <span className={styles.paramLabel} title={param.description}>
      {param.label}
      {param.rebuild && (
        <span className={styles.rebuildMark} title="Rebuilds the scene">
          ⟳
        </span>
      )}
      {modulated && <span className={styles.modMark} title="Audio reactive" />}
    </span>
  )

  if (param.type === 'action') {
    return (
      <div className={styles.paramRow}>
        <span />
        <HardwareButton size="small" label={param.label} onClick={() => onAction(param.key)} />
        {midiButton}
      </div>
    )
  }

  if (param.type === 'number') {
    const v = draft ?? (typeof value === 'number' ? value : param.default)
    const commit = (n: number) => {
      if (param.rebuild) setDraft(n)
      else onChange(n)
    }
    const release = () => {
      if (param.rebuild && draft !== null && draft !== value) onChange(draft)
    }
    return (
      <div className={styles.paramRow}>
        {label}
        <span className={styles.sliderCell}>
          <input
            type="range"
            className={styles.slider}
            min={param.min}
            max={param.max}
            step={param.step}
            value={v}
            aria-label={param.label}
            onChange={(e) => commit(Number(e.target.value))}
            onPointerUp={release}
            onKeyUp={release}
            onBlur={release}
            onDoubleClick={() => onChange(param.default)}
          />
          <span className={styles.paramValue}>
            {formatNumber(v, param.step)}
            {param.unit ?? ''}
          </span>
        </span>
        {midiButton}
      </div>
    )
  }

  if (param.type === 'color') {
    return (
      <div className={styles.paramRow}>
        {label}
        <input
          type="color"
          className={styles.colorInput}
          value={typeof value === 'string' ? value : param.default}
          aria-label={param.label}
          onChange={(e) => onChange(e.target.value)}
        />
        <span />
      </div>
    )
  }

  if (param.type === 'boolean') {
    return (
      <div className={styles.paramRow}>
        {label}
        <input
          type="checkbox"
          checked={value === true}
          aria-label={param.label}
          onChange={(e) => onChange(e.target.checked)}
        />
        {midiButton}
      </div>
    )
  }

  return (
    <div className={styles.paramRow}>
      {label}
      <Select
        value={typeof value === 'string' ? value : param.default}
        onChange={(e) => onChange(e.target.value)}
        aria-label={param.label}
      >
        {param.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      {midiButton}
    </div>
  )
}
