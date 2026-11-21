/**
 * Shared toolbar, separator, roving focusgroup, and viewport-aware popover
 * primitives for the Media Center & Tabs workspace (issue #459).
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'

import { ChevronDownIcon, CloseIcon } from './tabIcons'
import t from './TabWorkspace.module.css'

export interface ToolbarButtonProps {
  label: string
  /** Optional visible text override when different from accessible label. */
  text?: string | undefined
  /** Hide visible text below a breakpoint while keeping aria-label intact. */
  hideLabelBelow?: 'sm' | 'md' | 'never' | undefined
  icon?: ReactNode | undefined
  /**
   * Present ONLY on true stateful toggles; omit for one-shot actions so
   * screen readers never see `aria-pressed` on non-toggle commands.
   */
  pressed?: boolean | undefined
  variant?: 'default' | 'ghost' | 'accent' | 'danger'
  badge?: string | number | undefined
  disabled?: boolean | undefined
  title?: string | undefined
  className?: string | undefined
  onClick: () => void
}

export function ToolbarButton({
  label,
  text,
  hideLabelBelow = 'never',
  icon,
  pressed,
  variant = 'default',
  badge,
  disabled = false,
  title,
  className,
  onClick,
}: ToolbarButtonProps) {
  const isToggle = pressed !== undefined
  const showText = text !== undefined ? text : icon ? undefined : label
  const hideClass =
    hideLabelBelow === 'sm' ? t.hideTextSm : hideLabelBelow === 'md' ? t.hideTextMd : ''

  return (
    <button
      type="button"
      className={`${t.tbBtn} ${variant !== 'default' ? t[`tbBtn_${variant}`] : ''} ${!showText && icon ? t.tbBtnIconOnly : ''} ${className ?? ''}`}
      aria-label={label}
      aria-pressed={isToggle ? pressed : undefined}
      aria-disabled={disabled || undefined}
      data-disabled={disabled ? 'true' : undefined}
      title={title ?? label}
      onClick={() => {
        if (!disabled) onClick()
      }}
    >
      {icon && (
        <span className={t.tbIcon} aria-hidden="true">
          {icon}
        </span>
      )}
      {showText !== undefined && <span className={`${t.tbText} ${hideClass}`}>{showText}</span>}
      {badge !== undefined && badge !== '' && <span className={t.tbBadge}>{badge}</span>}
    </button>
  )
}

export function ToolbarGroup({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: ReactNode
}) {
  return (
    <div role="group" aria-label={label} className={`${t.tbGroup} ${className ?? ''}`}>
      {children}
    </div>
  )
}

export function ToolbarSeparator({
  orientation = 'vertical',
}: {
  orientation?: 'vertical' | 'horizontal'
}) {
  return (
    <span
      role="separator"
      aria-orientation={orientation}
      className={orientation === 'vertical' ? t.tbSepV : t.tbSepH}
    />
  )
}

/**
 * Enables native `focusgroup` roving focus on `role="toolbar"` containers and
 * installs a fallback roving-tabindex + arrow-key navigation handler only when
 * `focusGroup` is missing on `HTMLElement.prototype`.
 */
export function useRovingToolbar(
  ref: RefObject<HTMLElement | null>,
  orientation: 'horizontal' | 'vertical' = 'horizontal',
): { focusgroup: string } {
  useEffect(() => {
    const bar = ref.current
    if (!bar) return
    if (typeof HTMLElement !== 'undefined' && 'focusGroup' in HTMLElement.prototype) return

    const getItems = () =>
      Array.from(
        bar.querySelectorAll<HTMLElement>(
          'button:not([hidden]):not([data-skip-roving]), [role="tab"]:not([hidden])',
        ),
      ).filter(
        (el) =>
          !el.closest('[data-popover-surface]') &&
          (el.offsetParent !== null || el.getClientRects().length > 0),
      )

    const items = getItems()
    if (items.length) {
      const hasZero = items.some((el) => el.getAttribute('tabindex') === '0')
      items.forEach((el, idx) => {
        if (!hasZero) el.tabIndex = idx === 0 ? 0 : -1
      })
    }

    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null
      if (!target || target.closest('[data-popover-surface]')) return
      const current = getItems()
      if (!current.includes(target)) return
      current.forEach((el) => {
        el.tabIndex = el === target ? 0 : -1
      })
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (!target || target.closest('[data-popover-surface]')) return
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return
      const current = getItems()
      if (!current.length) return
      const idx = target ? current.indexOf(target) : -1
      if (idx < 0) return

      const rtl =
        typeof getComputedStyle === 'function' && getComputedStyle(bar).direction === 'rtl'
      const step =
        orientation === 'vertical'
          ? e.key === 'ArrowDown'
            ? 1
            : e.key === 'ArrowUp'
              ? -1
              : 0
          : e.key === 'ArrowRight'
            ? rtl
              ? -1
              : 1
            : e.key === 'ArrowLeft'
              ? rtl
                ? 1
                : -1
              : 0

      let nextIdx: number | null = null
      if (step !== 0) nextIdx = (idx + step + current.length) % current.length
      else if (e.key === 'Home') nextIdx = 0
      else if (e.key === 'End') nextIdx = current.length - 1

      if (nextIdx === null) return
      e.preventDefault()
      const nextEl = current[nextIdx]
      if (!nextEl) return
      current.forEach((el) => {
        el.tabIndex = el === nextEl ? 0 : -1
      })
      nextEl.focus()
    }

    bar.addEventListener('focusin', onFocusIn)
    bar.addEventListener('keydown', onKeyDown)
    return () => {
      bar.removeEventListener('focusin', onFocusIn)
      bar.removeEventListener('keydown', onKeyDown)
    }
  }, [ref, orientation])

  return {
    focusgroup: orientation === 'vertical' ? 'toolbar wrap block' : 'toolbar wrap',
  }
}

export interface WorkspacePopoverProps {
  label: string
  /** Optional visible text on trigger; defaults to `label`. */
  triggerText?: string
  /** Hide trigger text below a breakpoint while keeping aria-label intact. */
  hideLabelBelow?: 'sm' | 'md' | 'never'
  icon?: ReactNode
  badge?: string | number | undefined
  active?: boolean
  title?: string
  /** Preferred block placement on desktop; CSS anchor positioning flips automatically. */
  placement?: 'bottom-end' | 'bottom-start' | 'top-end' | 'top-start'
  /** Render as a docked bottom sheet on <=640px mobile viewports. */
  sheetOnMobile?: boolean
  /** Width constraint for the popover surface. */
  width?: 'menu' | 'wide' | 'tone'
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: ReactNode | ((close: () => void) => ReactNode)
}

const supportsNativePopover = () =>
  typeof HTMLElement !== 'undefined' &&
  'popover' in HTMLElement.prototype &&
  typeof HTMLElement.prototype.showPopover === 'function'

const supportsAnchorPositioning = () =>
  typeof CSS !== 'undefined' &&
  typeof CSS.supports === 'function' &&
  CSS.supports('position-area', 'block-end')

/**
 * Viewport-aware popover panel tethered to its trigger button.
 * Uses native `popover="auto"` + CSS Anchor Positioning when available,
 * and falls back cleanly to clamped fixed coordinates + Escape/outside-click
 * dismissal in browsers without Anchor Positioning or Popover API (incl. jsdom).
 */
export function WorkspacePopover({
  label,
  triggerText,
  hideLabelBelow = 'never',
  icon,
  badge,
  active = false,
  title,
  placement = 'bottom-end',
  sheetOnMobile = false,
  width = 'menu',
  open: controlledOpen,
  onOpenChange,
  children,
}: WorkspacePopoverProps) {
  const id = useId()
  const anchorName = `--pop-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen

  const setOpenState = useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [isControlled, onOpenChange],
  )

  const native = supportsNativePopover()

  const closePanel = useCallback(() => {
    const el = panelRef.current
    if (native && el && el.matches(':popover-open')) {
      try {
        el.hidePopover()
      } catch {
        setOpenState(false)
      }
    } else {
      setOpenState(false)
    }
  }, [native, setOpenState])

  const toggle = useCallback(() => {
    const el = panelRef.current
    if (native && el) {
      try {
        if (el.matches(':popover-open')) el.hidePopover()
        else el.showPopover()
        return
      } catch {
        // Fall through to controlled React state if native popover fails.
      }
    }
    setOpenState(!open)
  }, [native, open, setOpenState])

  // Sync controlled `open` transitions with native top-layer popover when used.
  useEffect(() => {
    if (!native || !isControlled) return
    const el = panelRef.current
    if (!el) return
    const isNativeOpen = el.matches(':popover-open')
    if (controlledOpen && !isNativeOpen) {
      try {
        el.showPopover()
      } catch {
        // ignore if disconnected
      }
    } else if (!controlledOpen && isNativeOpen) {
      try {
        el.hidePopover()
      } catch {
        // ignore
      }
    }
  }, [native, isControlled, controlledOpen])

  // Script fallback positioning when CSS Anchor Positioning isn't supported.
  const placeFallback = useCallback(() => {
    const trigger = triggerRef.current
    const panel = panelRef.current
    if (!trigger || !panel) return
    if (supportsAnchorPositioning()) {
      panel.style.top = ''
      panel.style.left = ''
      panel.style.position = ''
      panel.style.inset = ''
      panel.style.margin = ''
      return
    }
    if (sheetOnMobile && typeof window !== 'undefined' && window.innerWidth <= 640) {
      panel.style.top = ''
      panel.style.left = ''
      panel.style.position = ''
      panel.style.inset = ''
      panel.style.margin = ''
      return
    }
    const tr = trigger.getBoundingClientRect()
    const pr = panel.getBoundingClientRect()
    const pad = 8
    const preferTop = placement.startsWith('top')
    const fitsAbove = tr.top - pr.height - 6 >= pad
    const fitsBelow = tr.bottom + pr.height + 6 <= window.innerHeight - pad
    const putTop = preferTop ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove
    const top = putTop
      ? Math.max(pad, tr.top - pr.height - 6)
      : Math.min(window.innerHeight - pr.height - pad, tr.bottom + 6)
    const preferEnd = placement.endsWith('end')
    const rawLeft = preferEnd ? tr.right - pr.width : tr.left
    const left = Math.max(pad, Math.min(rawLeft, window.innerWidth - pr.width - pad))
    panel.style.position = 'fixed'
    panel.style.inset = 'auto'
    panel.style.margin = '0'
    panel.style.top = `${Math.round(top)}px`
    panel.style.left = `${Math.round(left)}px`
  }, [placement, sheetOnMobile])

  // Sync native `toggle` events back to React state.
  useEffect(() => {
    const el = panelRef.current
    if (!el || !native) return
    const onToggle = (e: Event) => {
      const ev = e as ToggleEvent
      const nextOpen = ev.newState === 'open'
      setOpenState(nextOpen)
      if (nextOpen) placeFallback()
    }
    el.addEventListener('toggle', onToggle)
    return () => el.removeEventListener('toggle', onToggle)
  }, [native, setOpenState, placeFallback])

  // Fallback dismiss (Escape + outside pointerdown) when Popover API isn't driving it.
  useEffect(() => {
    if (!open || native) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpenState(false)
        triggerRef.current?.focus()
      }
    }
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (!target) return
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpenState(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open, native, setOpenState])

  useLayoutEffect(() => {
    if (!open) return
    placeFallback()
    const raf =
      typeof requestAnimationFrame === 'function' ? requestAnimationFrame(placeFallback) : 0
    return () => {
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
    }
  }, [open, placeFallback])

  const hideClass =
    hideLabelBelow === 'sm' ? t.hideTextSm : hideLabelBelow === 'md' ? t.hideTextMd : ''
  const visibleText = triggerText ?? label
  const placeClass =
    placement === 'top-end'
      ? t.popTopEnd
      : placement === 'top-start'
        ? t.popTopStart
        : placement === 'bottom-start'
          ? t.popBottomStart
          : t.popBottomEnd
  const widthClass = width === 'wide' ? t.popWide : width === 'tone' ? t.popTone : t.popMenu

  return (
    <div className={t.popoverWrap}>
      <button
        ref={triggerRef}
        type="button"
        className={`${t.tbBtn} ${active ? t.tbBtnActive : ''}`}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        title={title ?? label}
        style={supportsAnchorPositioning() ? ({ anchorName } as CSSProperties) : undefined}
        {...(native ? { popoverTarget: id } : { onClick: toggle })}
      >
        {icon && (
          <span className={t.tbIcon} aria-hidden="true">
            {icon}
          </span>
        )}
        <span className={`${t.tbText} ${hideClass}`}>{visibleText}</span>
        {badge !== undefined && badge !== '' && <span className={t.tbBadge}>{badge}</span>}
        <ChevronDownIcon size={12} className={t.popCaret} />
      </button>
      <div
        ref={panelRef}
        id={id}
        data-popover-surface=""
        popover={native ? 'auto' : undefined}
        hidden={!native && !open}
        data-open={open ? 'true' : undefined}
        style={
          supportsAnchorPositioning()
            ? ({ positionAnchor: anchorName } as CSSProperties)
            : undefined
        }
        className={`${t.popoverSurface} ${placeClass} ${widthClass} ${sheetOnMobile ? t.popSheetMobile : ''} ${!native ? t.popFallback : ''}`}
      >
        {sheetOnMobile && (
          <div className={t.popSheetHead}>
            <strong>{label}</strong>
            <button
              type="button"
              className={t.tbBtn}
              aria-label={`Close ${label}`}
              onClick={closePanel}
            >
              <CloseIcon size={14} />
            </button>
          </div>
        )}
        {typeof children === 'function' ? children(closePanel) : children}
      </div>
    </div>
  )
}
