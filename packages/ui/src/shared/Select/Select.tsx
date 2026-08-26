import type { SelectHTMLAttributes, ReactNode } from 'react'
import styles from './Select.module.css'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Optional visible label rendered above the select. When omitted the select renders standalone (use aria-label for accessibility). */
  label?: string
  children: ReactNode
}

export function Select({ label, children, id, className, ...props }: SelectProps) {
  const fieldId =
    id ??
    (label
      ? label
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9-]/g, '')
      : undefined)

  if (label) {
    const selectId = fieldId ?? `select-${label.toLowerCase().replace(/\s+/g, '-')}`
    return (
      <div className={`${styles.field} ${className ?? ''}`.trim()}>
        <label htmlFor={selectId} className={styles.label}>
          {label}
        </label>
        <select id={selectId} className={styles.select} {...props}>
          {children}
        </select>
      </div>
    )
  }

  return (
    <select id={id} className={`${styles.select} ${className ?? ''}`.trim()} {...props}>
      {children}
    </select>
  )
}
