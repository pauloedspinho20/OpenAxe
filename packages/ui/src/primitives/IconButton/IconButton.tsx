import type { ReactNode } from 'react'
import styles from './IconButton.module.css'

export interface IconButtonProps {
  /** Accessible name — also the tooltip fallback. */
  label: string
  disabled?: boolean
  title?: string
  onClick: () => void
  children: ReactNode
  variant?: 'default' | 'accent'
  size?: 'sm' | 'md'
}

export function IconButton({
  label,
  disabled = false,
  title,
  onClick,
  children,
  variant = 'default',
  size = 'md',
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={disabled}
      disabled={disabled}
      title={title ?? label}
      onClick={onClick}
      className={`${styles.button} ${styles[variant]} ${styles[size]}`}
    >
      {children}
    </button>
  )
}
