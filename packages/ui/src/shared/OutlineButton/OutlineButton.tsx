import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './OutlineButton.module.css'

export interface OutlineButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'danger'
  children: ReactNode
}

export function OutlineButton({
  variant = 'default',
  children,
  className = '',
  ...props
}: OutlineButtonProps) {
  const cls = variant === 'danger' ? styles.danger : styles.btn
  return (
    <button type="button" className={`${cls} ${className}`} {...props}>
      {children}
    </button>
  )
}
