import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { clampMenuPosition, type MenuAnchor } from './position'
import styles from './ContextMenu.module.css'

export interface ContextMenuItem {
  id: string
  label: string
  /** Red styling for destructive entries (remove, unmap, disconnect). */
  danger?: boolean
  disabled?: boolean
  /** Native tooltip explaining the entry (e.g. why it is disabled). */
  title?: string
  onSelect: () => void
}

export type ContextMenuAnchor = MenuAnchor

export interface ContextMenuProps {
  open: boolean
  /** Viewport coordinates to open at - usually a right-click's clientX/clientY. */
  anchor: ContextMenuAnchor | null
  /** Caller-supplied entries, so any component can reuse this with its own menu. */
  items: ContextMenuItem[]
  onClose: () => void
  /** Accessible name for the menu. Defaults to 'Context menu'. */
  label?: string
  zIndex?: number
}

/**
 * An abstract right-click menu: the caller owns the items, this owns the
 * floating behaviour (viewport-clamped positioning, Escape/outside-click
 * dismissal, arrow-key navigation, focus restore). Rendered in a portal so
 * it is never clipped by an ancestor's overflow.
 */
export function ContextMenu({ open, anchor, items, onClose, label, zIndex }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const restoreFocusRef = useRef<Element | null>(null)
  const [position, setPosition] = useState<ContextMenuAnchor | null>(anchor)

  // Re-clamp once the menu has a measured size (fonts/layout shift it).
  useLayoutEffect(() => {
    if (!open || !anchor) return
    const el = menuRef.current
    if (!el || typeof window === 'undefined') {
      setPosition(anchor)
      return
    }
    setPosition(
      clampMenuPosition(
        anchor,
        { width: el.offsetWidth, height: el.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    )
  }, [open, anchor])

  // Remember who had focus so closing the menu hands it back.
  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    restoreFocusRef.current = document.activeElement
    // Focus the first enabled entry so arrow-key navigation starts somewhere.
    const first = menuRef.current?.querySelector<HTMLElement>(
      '[role="menuitem"]:not([aria-disabled="true"])',
    )
    first?.focus()
    return () => {
      const target = restoreFocusRef.current
      if (target instanceof HTMLElement) target.focus({ preventScroll: true })
      restoreFocusRef.current = null
    }
  }, [open])

  // Escape closes; a pointer-down outside the menu closes (the press that
  // opened the menu already happened before this listener was attached).
  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open, onClose])

  if (!open || !anchor) return null
  if (typeof document === 'undefined') return null

  const enabledItems = items.filter((item) => !item.disabled)

  const focusItem = (id: string) => {
    menuRef.current?.querySelector<HTMLElement>(`[data-menu-item-id="${id}"]`)?.focus()
  }

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    const active = document.activeElement
    const currentId = active instanceof HTMLElement ? active.dataset.menuItemId : undefined
    const currentIndex = enabledItems.findIndex((item) => item.id === currentId)
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        focusItem(enabledItems[(currentIndex + 1) % enabledItems.length]?.id ?? '')
        break
      case 'ArrowUp':
        e.preventDefault()
        focusItem(
          enabledItems[(currentIndex - 1 + enabledItems.length) % enabledItems.length]?.id ?? '',
        )
        break
      case 'Home':
        e.preventDefault()
        focusItem(enabledItems[0]?.id ?? '')
        break
      case 'End':
        e.preventDefault()
        focusItem(enabledItems[enabledItems.length - 1]?.id ?? '')
        break
      case 'Tab':
        onClose()
        break
    }
  }

  const pos = position ?? anchor

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={label ?? 'Context menu'}
      className={styles.menu}
      style={{ left: pos.x, top: pos.y, ...(zIndex && { zIndex }) }}
      onKeyDown={handleMenuKeyDown}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          data-menu-item-id={item.id}
          disabled={item.disabled}
          aria-disabled={item.disabled}
          title={item.title}
          className={`${styles.item} ${item.danger ? styles.itemDanger : ''}`}
          onClick={() => {
            item.onSelect()
            onClose()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  )
}
