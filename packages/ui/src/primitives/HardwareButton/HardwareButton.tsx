import styles from './HardwareButton.module.css'

export interface HardwareButtonProps {
  label: string
  active?: boolean
  onClick: () => void
  variant?: 'default' | 'accent' | 'danger'
  disabled?: boolean
  title?: string
  fullWidth?: boolean
}

/** A tactile rack button. `active` lights it up in the given variant color, like an engaged pedal. */
export function HardwareButton({
  label,
  active = false,
  onClick,
  variant = 'default',
  disabled = false,
  title,
  fullWidth = false,
}: HardwareButtonProps) {
  return (
    <button
      type="button"
      className={`${styles.button} ${active ? styles.active : ''} ${styles[variant]} ${fullWidth ? styles.fullWidth : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={title}
    >
      {label}
    </button>
  )
}
