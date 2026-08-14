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
}: FaderProps) {
  return (
    <div className={styles.wrap}>
      <div className={styles.track}>
        <input
          type="range"
          className={styles.input}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-label={label}
        />
      </div>
      <span className="label">{label}</span>
      {formatValue && <span className={styles.value}>{formatValue(value)}</span>}
    </div>
  )
}
