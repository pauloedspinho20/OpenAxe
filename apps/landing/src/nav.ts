/**
 * Responsive site navigation following the single-tree navbar pattern:
 * measures whether the inline header fits, promotes `.site-menu` to inline via
 * `.site-header.is-wide`, and falls back to a top-layer `popover="auto"` menu
 * when narrow.
 */
export function initNav(): void {
  const header = document.querySelector<HTMLElement>('.site-header')
  const inner = header?.querySelector<HTMLElement>('.header-inner')
  const menu = document.getElementById('site-menu')
  const menuBtn = header?.querySelector<HTMLButtonElement>('.menu-button')
  if (!header || !inner || !menu || !menuBtn) return

  const supportsPopover = Object.hasOwn(HTMLElement.prototype, 'popover')
  let isWide = false
  let lastHeaderWidth = 0
  let rafId = 0

  const setCollapsedMenuOpen = (open: boolean) => {
    menu.classList.toggle('is-open', open)
    menuBtn.setAttribute('aria-expanded', String(open))
  }

  const measure = () => {
    const headerWidth = header.getBoundingClientRect().width
    // When collapsed, avoid switching to inline just to measure on every shrink.
    if (!isWide && lastHeaderWidth > 0 && headerWidth <= lastHeaderWidth) return
    lastHeaderWidth = headerWidth

    const wasPopoverOpen = supportsPopover && !isWide && menu.matches(':popover-open')

    header.classList.add('is-measuring')
    header.classList.add('is-wide')
    menu.removeAttribute('popover')

    const fitsInline = inner.scrollWidth <= inner.clientWidth + 1
    isWide = fitsInline

    if (fitsInline) {
      header.classList.add('is-wide')
      menu.removeAttribute('popover')
      setCollapsedMenuOpen(false)
    } else {
      header.classList.remove('is-wide')
      if (supportsPopover) {
        menu.setAttribute('popover', 'auto')
        if (wasPopoverOpen) {
          try {
            menu.showPopover()
          } catch {
            // Element may not be in top-layer ready state during fast resizes.
          }
        }
      }
    }

    if (rafId) cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(() => {
      header.classList.remove('is-measuring')
      rafId = 0
    })
  }

  const ro = new ResizeObserver(() => measure())
  ro.observe(header)
  ro.observe(menu)
  measure()

  if (supportsPopover) {
    menu.addEventListener('toggle', (event) => {
      const toggleEvent = event as ToggleEvent
      menuBtn.setAttribute('aria-expanded', String(toggleEvent.newState === 'open'))
    })
  } else {
    // Fallback for browsers without native Popover API.
    menuBtn.removeAttribute('popovertarget')
    menuBtn.addEventListener('click', () => {
      const next = !menu.classList.contains('is-open')
      setCollapsedMenuOpen(next)
    })
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && menu.classList.contains('is-open')) {
        setCollapsedMenuOpen(false)
        menuBtn.focus()
      }
    })
  }

  // Dismiss mobile menu cleanly after clicking an in-page anchor.
  menu.addEventListener('click', (event) => {
    const link = (event.target as Element | null)?.closest('a[href^="#"]')
    if (!link || isWide) return
    if (supportsPopover && menu.matches(':popover-open')) {
      menu.hidePopover()
    } else if (menu.classList.contains('is-open')) {
      setCollapsedMenuOpen(false)
    }
  })
}
