import type { InputHTMLAttributes } from 'react'
import { Select, type SelectProps } from '../Select/Select'
import styles from './FormField.module.css'

export type SelectFieldProps = SelectProps

export function SelectField(props: SelectFieldProps) {
  return <Select {...props} />
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
