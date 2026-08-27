import { useEffect, type CSSProperties, type ReactNode } from 'react'
import styles from './Dialog.module.css'
import { HardwareButton } from '../../primitives'
import { CloseIcon } from '../../icons/GeneraIcons'

let dialogLockCount = 0
let savedBodyOverflow = ''
let savedHtmlOverflow = ''
let savedBodyPaddingRight = ''

export interface DialogProps {
  className?: string
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  headerContent?: ReactNode
  width?: string
  zIndex?: number
  maxHeight?: string
  ariaLabel?: string
}

export function Dialog({
  className,
  open,
  onClose,
  title,
  children,
  headerContent,
  width,
  zIndex,
  maxHeight,
  ariaLabel,
}: DialogProps) {
  useEffect(() => {
    if (!open) return
    if (typeof document === 'undefined') return

    if (dialogLockCount === 0) {
      savedBodyOverflow = document.body.style.overflow
      savedHtmlOverflow = document.documentElement.style.overflow
      savedBodyPaddingRight = document.body.style.paddingRight
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
      document.body.style.overflow = 'hidden'
      document.documentElement.style.overflow = 'hidden'
      if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${scrollbarWidth}px`
      }
    }
    dialogLockCount += 1

    return () => {
      dialogLockCount = Math.max(0, dialogLockCount - 1)
      if (dialogLockCount === 0) {
        document.body.style.overflow = savedBodyOverflow
        document.documentElement.style.overflow = savedHtmlOverflow
        document.body.style.paddingRight = savedBodyPaddingRight
      }
    }
  }, [open])

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
      <div className={[styles.dialog, className].join(' ')} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>{title}</span>
          {headerContent && <div className={styles.headerExtra}>{headerContent}</div>}
          <HardwareButton
            size="small"
            icon={<CloseIcon size={12} />}
            onClick={onClose}
            aria-label="Close"
            label="Close"
            iconOnly
          ></HardwareButton>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  )
}
