import type { ReactNode } from 'react'
import styles from './HardwareButton.module.css'

export interface HardwareButtonProps {
  label: string
  active?: boolean
  onClick: () => void
  variant?: 'default' | 'accent' | 'danger'
  disabled?: boolean
  title?: string
  fullWidth?: boolean
  icon?: ReactNode
  iconOnly?: boolean
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
  icon,
  iconOnly = false,
}: HardwareButtonProps) {
  const accessibleLabel = iconOnly ? label : undefined
  return (
    <button
      type="button"
      className={`${styles.button} ${active ? styles.active : ''} ${styles[variant]} ${fullWidth ? styles.fullWidth : ''} ${icon ? styles.withIcon : ''} ${iconOnly ? styles.iconOnly : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={accessibleLabel}
      title={title ?? (iconOnly ? label : undefined)}
    >
      {icon ? <span className={styles.icon}>{icon}</span> : null}
      {iconOnly ? <span className={styles.visuallyHidden}>{label}</span> : label}
    </button>
  )
}
