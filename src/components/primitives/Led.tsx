import styles from './Led.module.css'

export interface LedProps {
  on?: boolean
  color?: 'accent' | 'green' | 'amber' | 'red'
  label?: string
}

/** A small status light, like the power/clip indicators on real hardware. */
export function Led({ on = false, color = 'green', label }: LedProps) {
  return (
    <span className={styles.wrap}>
      <span className={`${styles.dot} ${styles[color]} ${on ? styles.on : ''}`} />
      {label && <span className="label">{label}</span>}
    </span>
  )
}
