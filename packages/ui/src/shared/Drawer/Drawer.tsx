import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { CloseIcon } from '../../icons/GeneraIcons'
import { HardwareButton } from '../../primitives/HardwareButton/HardwareButton'
import styles from './Drawer.module.css'

export interface DrawerProps {
  open: boolean
  onClose: () => void
  title: string
  icon?: ReactNode
  side?: 'left' | 'right' | undefined
  /** Render inside a modal backdrop on narrow viewports instead of inline in layout flow. */
  overlay?: boolean | undefined
  /** Gate window Escape handling when a parent host view is inactive. */
  active?: boolean | undefined
  showHeader?: boolean | undefined
  width?: string | undefined
  className?: string | undefined
  children: ReactNode
}

/**
 * Docked sidebar or mobile slide-over drawer (left Library / right Inspector),
 * unifying backdrop dismissal, Escape handling, safe-area padding, and close button.
 */
export function Drawer({
  open,
  onClose,
  title,
  icon,
  side = 'right',
  overlay = true,
  active = true,
  showHeader = true,
  width,
  className,
  children,
}: DrawerProps) {
  useEffect(() => {
    if (!open || !overlay || !active) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, overlay, active, onClose])

  if (!open) return null

  const style = width ? ({ '--drawer-w': width } as CSSProperties) : undefined
  const panelCls = [
    overlay ? styles.overlayPanel : styles.inlinePanel,
    overlay ? (side === 'left' ? styles.overlayLeft : styles.overlayRight) : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  const panel = (
    <aside className={panelCls} style={style} aria-label={title}>
      {showHeader && (
        <div className={styles.header}>
          <strong className={styles.title}>
            {icon}
            <span>{title}</span>
          </strong>
          <HardwareButton
            size="small"
            iconOnly
            icon={<CloseIcon size={14} />}
            label={`Close ${title}`}
            onClick={onClose}
          />
        </div>
      )}
      {children}
    </aside>
  )

  if (!overlay) return panel

  return (
    <div
      className={`${styles.backdrop} ${side === 'left' ? styles.alignLeft : styles.alignRight}`}
      onClick={onClose}
      role="presentation"
    >
      <div className={styles.host} onClick={(e) => e.stopPropagation()}>
        {panel}
      </div>
    </div>
  )
}
