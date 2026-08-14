import type { SelectHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import styles from './FormField.module.css'

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  children: ReactNode
}

export function SelectField({ label, children, id, ...props }: SelectFieldProps) {
  const fieldId = id ?? label.toLowerCase().replace(/\s+/g, '-')
  return (
    <label className={styles.field} htmlFor={fieldId}>
      <span className={styles.label}>{label}</span>
      <select className={styles.select} id={fieldId} {...props}>
        {children}
      </select>
    </label>
  )
}

export interface InputFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
}

export function InputField({ label, id, ...props }: InputFieldProps) {
  const fieldId = id ?? label.toLowerCase().replace(/\s+/g, '-')
  return (
    <label className={styles.field} htmlFor={fieldId}>
      <span className={styles.label}>{label}</span>
      <input className={styles.input} id={fieldId} {...props} />
    </label>
  )
}
