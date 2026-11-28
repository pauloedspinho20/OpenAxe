import { useRef } from 'react'
import styles from './Fader.module.css'

export interface FaderProps {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (value: number) => void
  formatValue?: (value: number) => string
  disabled?: boolean
  /** `horizontal` is a compact left-to-right slider (e.g. a header volume control). */
  orientation?: 'vertical' | 'horizontal'
  /** Hide the visible label (it stays as the accessible name). */
  hideLabel?: boolean
  /** Track length in px along the slider's axis (horizontal default 72; vertical default is the token height). */
  length?: number
  /**
   * A detent value (e.g. 0 dB on an EQ band): pointer drags within `snapThreshold`
   * of it land exactly on it, a tick marks it on the track, and double-click
   * resets to it. Keyboard steps are never snapped, so fine adjustment stays possible.
   */
  snapTo?: number
  /** Snap zone half-width in value units. Default: 4% of the range. */
  snapThreshold?: number
  /**
   * Where `formatValue` is shown: `label` (default) as text under the fader, or `tooltip`
   * as a bubble above it while hovering, focused or being dragged (saves the space).
   */
  valueDisplay?: 'label' | 'tooltip'
  /** Stretch the track to the parent's full height (parent must have a height) instead of a fixed length. */
  fill?: boolean
}

/** A vertical fader - a native range input under the hood, for free keyboard/touch support. */
export function Fader({
  label,
  value,
  min = 0,
  max = 1.5,
  step = 0.01,
  onChange,
  formatValue,
  disabled = false,
  orientation = 'vertical',
  hideLabel = false,
  length,
  snapTo,
  snapThreshold,
  valueDisplay = 'label',
  fill = false,
}: FaderProps) {
  const horizontal = orientation === 'horizontal'
  const keyboard = useRef(false)
  const zone = snapThreshold ?? (max - min) * 0.04
  const snapPct = snapTo === undefined ? null : ((snapTo - min) / (max - min)) * 100
  const axis = length ?? (horizontal ? 72 : undefined)
  return (
    <div
      className={`${styles.wrap} ${horizontal ? styles.wrapH : ''} ${fill ? styles.wrapFill : ''}`}
    >
      <div
        className={`${styles.track} ${horizontal ? styles.trackH : ''} ${fill ? styles.trackFill : ''}`}
        style={
          fill || axis === undefined ? undefined : horizontal ? { width: axis } : { height: axis }
        }
      >
        {formatValue && valueDisplay === 'tooltip' && (
          <span className={styles.tip} role="status">
            {formatValue(value)}
          </span>
        )}
        {snapPct !== null && (
          <span
            className={`${styles.snapMark} ${horizontal ? styles.snapMarkH : ''}`}
            style={horizontal ? { left: `${snapPct}%` } : { bottom: `${snapPct}%` }}
            aria-hidden
          />
        )}
        <input
          type="range"
          className={`${styles.input} ${horizontal ? styles.inputH : ''}`}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onKeyDown={() => {
            keyboard.current = true
          }}
          onPointerDown={() => {
            keyboard.current = false
          }}
          onDoubleClick={snapTo === undefined ? undefined : () => onChange(snapTo)}
          onChange={(event) => {
            const next = Number(event.target.value)
            const snap =
              snapTo !== undefined && !keyboard.current && Math.abs(next - snapTo) <= zone
            onChange(snap ? snapTo : next)
          }}
          aria-label={label}
        />
      </div>
      {!hideLabel && <span className="label">{label}</span>}
      {formatValue && valueDisplay === 'label' && (
        <span className={styles.value}>{formatValue(value)}</span>
      )}
    </div>
  )
}
