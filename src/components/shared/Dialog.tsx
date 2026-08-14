import type { CSSProperties, ReactNode } from 'react'
import styles from './Dialog.module.css'

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  width?: string
  zIndex?: number
  maxHeight?: string
  ariaLabel?: string
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  width,
  zIndex,
  maxHeight,
  ariaLabel,
}: DialogProps) {
  if (!open) return null

  const style = {
    ...(width && { '--dialog-w': width }),
    ...(zIndex && { '--dialog-z': zIndex }),
    ...(maxHeight && { '--dialog-max-h': maxHeight }),
  } as CSSProperties

  return (
    <div
      className={styles.overlay}
      style={style}
      onClick={onClose}
      role="dialog"
      aria-label={ariaLabel ?? title}
    >
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>{title}</span>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  )
}
