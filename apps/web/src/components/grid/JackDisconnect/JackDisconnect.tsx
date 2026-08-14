import styles from './JackDisconnect.module.css'

export interface JackDisconnectProps {
  onDisconnect: () => void
  label: string
  className?: string
}

/**
 * The plain circular badge shown over a jack that already has a cable.
 * Centered in its parent (which should be sized like the jack it sits on).
 * Pointer-down is stopped so it never starts a card/grid drag - the badge
 * only ever disconnects.
 */
export function JackDisconnect({ onDisconnect, label, className }: JackDisconnectProps) {
  return (
    <button
      type="button"
      className={`${styles.badge} ${className ?? ''}`}
      onClick={(e) => {
        e.stopPropagation()
        onDisconnect()
      }}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={label}
      title={label}
    />
  )
}
