import type { ReactNode } from 'react'
import styles from './Panel.module.css'

export interface PanelProps {
  label?: string
  corner?: ReactNode
  children: ReactNode
  className?: string
}

/** A rack-module container - the base unit every control group sits in. */
export function Panel({ label, corner, children, className }: PanelProps) {
  return (
    <section className={`${styles.panel} ${className ?? ''}`}>
      {(label ?? corner) && (
        <header className={styles.header}>
          {label && <span className="label">{label}</span>}
          {corner}
        </header>
      )}
      <div className={styles.body}>{children}</div>
      {/*  <span className={`${styles.screw} ${styles.tl}`} />
      <span className={`${styles.screw} ${styles.tr}`} />
      <span className={`${styles.screw} ${styles.bl}`} />
      <span className={`${styles.screw} ${styles.br}`} /> */}
    </section>
  )
}
