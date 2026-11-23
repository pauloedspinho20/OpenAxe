/**
 * Shared toolbar separator, roving focusgroup, and viewport-aware popover
 * primitives for the Media Center & Tabs workspace (issue #459).
 */
import { HardwareButton } from '@openaxe/ui'
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
          'button:not([hidden]):not([disabled]):not([data-skip-roving]), [role="tab"]:not([hidden])',
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
  triggerText?: string | undefined
  /** Hide trigger text below a breakpoint while keeping aria-label intact. */
  hideLabelBelow?: 'sm' | 'md' | 'never' | undefined
  icon?: ReactNode
  badge?: string | number | undefined
  active?: boolean | undefined
  title?: string | undefined
  /** Preferred block placement on desktop; CSS anchor positioning flips automatically. */
  placement?: 'bottom-end' | 'bottom-start' | 'top-end' | 'top-start' | undefined
  /** Render as a docked bottom sheet on <=640px mobile viewports. */
  sheetOnMobile?: boolean | undefined
  /** Width constraint for the popover surface. */
  width?: 'menu' | 'wide' | 'tone' | undefined
  open?: boolean | undefined
  onOpenChange?: ((open: boolean) => void) | undefined
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
 * Viewport-aware popover panel tethered to its trigger HardwareButton.
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
  active,
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
      <HardwareButton
        ref={triggerRef}
        size="small"
        label={visibleText}
        ariaLabel={label}
        ariaExpanded={open}
        ariaControls={id}
        active={active}
        icon={icon}
        trailingIcon={<ChevronDownIcon size={12} className={t.popCaret} />}
        badge={badge}
        hideLabelBelow={hideLabelBelow}
        title={title ?? label}
        style={supportsAnchorPositioning() ? ({ anchorName } as CSSProperties) : undefined}
        popoverTarget={native ? id : undefined}
        onClick={native ? undefined : toggle}
      />
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
            <HardwareButton
              size="small"
              iconOnly
              label={`Close ${label}`}
              icon={<CloseIcon size={14} />}
              onClick={closePanel}
            />
          </div>
        )}
        {typeof children === 'function' ? children(closePanel) : children}
      </div>
    </div>
  )
}
