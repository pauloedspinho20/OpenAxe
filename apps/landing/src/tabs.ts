/**
 * Accessible tabs controller using selection-follows-focus, roving tabindex,
 * and `hidden="until-found"` with `beforematch` support for Find-in-Page.
 */
export function selectTab(container: Element, tabId: string, moveFocus = false): void {
  const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
  const panels = Array.from(container.querySelectorAll<HTMLElement>('[role="tabpanel"]'))
  const target = tabs.find((t) => t.dataset.tab === tabId || t.id === tabId)
  if (!target) return

  for (const tab of tabs) {
    const active = tab === target
    tab.setAttribute('aria-selected', String(active))
    tab.tabIndex = active ? 0 : -1
  }

  for (const panel of panels) {
    const matches =
      panel.getAttribute('aria-labelledby') === target.id ||
      panel.dataset.panel === target.dataset.tab
    if (matches) {
      panel.removeAttribute('hidden')
    } else {
      panel.setAttribute('hidden', 'until-found')
    }
  }

  target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  if (moveFocus) target.focus()
}

/** Wires a single `[data-tabs]` container (callable on dynamically rendered tabs). */
export function wireTabContainer(container: Element): void {
  const tablist = container.querySelector<HTMLElement>('[role="tablist"]')
  if (!tablist) return

  const getTabs = () => Array.from(tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]'))

  tablist.addEventListener('click', (event) => {
    const tab = (event.target as Element | null)?.closest<HTMLButtonElement>('[role="tab"]')
    if (!tab) return
    selectTab(container, tab.dataset.tab ?? tab.id, false)
  })

  tablist.addEventListener('keydown', (event) => {
    const tabs = getTabs()
    const current = (event.target as Element | null)?.closest<HTMLButtonElement>('[role="tab"]')
    if (!current || !tabs.length) return

    const idx = tabs.indexOf(current)
    let nextIdx = -1
    if (event.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length
    else if (event.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') nextIdx = 0
    else if (event.key === 'End') nextIdx = tabs.length - 1
    else return

    event.preventDefault()
    const next = tabs[nextIdx]
    if (next) selectTab(container, next.dataset.tab ?? next.id, true)
  })

  // Reveal matching tab when browser Find-in-Page hits text inside a collapsed panel.
  for (const panel of container.querySelectorAll<HTMLElement>('[role="tabpanel"]')) {
    panel.addEventListener('beforematch', () => {
      const labelledBy = panel.getAttribute('aria-labelledby')
      if (labelledBy) selectTab(container, labelledBy, false)
    })
  }
}

/** Wires every `[data-tabs]` widget on the page. */
export function initTabs(): void {
  for (const container of document.querySelectorAll('[data-tabs]')) {
    wireTabContainer(container)
  }
}
