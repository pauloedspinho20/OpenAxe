import type { ReactNode } from 'react'
import styles from './Panel.module.css'

export interface PanelProps {
  label?: string | undefined
  url?: string | undefined
  labelUrl?: string | undefined
  corner?: ReactNode | undefined
  children: ReactNode
  className?: string | undefined
}

/** A rack-module container - the base unit every control group sits in. */
export function Panel({ label, labelUrl, url, corner, children, className }: PanelProps) {
  return (
    <section className={`${styles.panel} ${className ?? ''}`}>
      {(label ?? corner) && (
        <div className={styles.header}>
          <div className={styles.labelContainer}>
            {label && <span className={styles.label}>{label}</span>}
            {url && labelUrl && (
              <span className="label">
                By{' '}
                <a href={url} target="_blank">
                  {labelUrl}
                </a>
              </span>
            )}
          </div>
          {corner}
        </div>
      )}
      <div className={styles.body}>{children}</div>
    </section>
  )
}
