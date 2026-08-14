import type { ReactNode } from 'react'
import styles from './StatusText.module.css'

export function Hint({ children }: { children: ReactNode }) {
  return <p className={styles.hint}>{children}</p>
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <p className={styles.error}>{children}</p>
}
