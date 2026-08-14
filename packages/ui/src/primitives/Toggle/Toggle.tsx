import styles from './Toggle.module.css'

export interface ToggleProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

/** A rocker switch. */
export function Toggle({ label, checked, onChange, disabled = false }: ToggleProps) {
  return (
    <label className={`${styles.wrap} ${disabled ? styles.disabled : ''}`}>
      <span className="label">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className={`${styles.track} ${checked ? styles.on : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.thumb} />
      </button>
    </label>
  )
}
