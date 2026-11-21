export type HardwareFinish = 'dark' | 'light'

const STORAGE_KEY = 'openaxe-theme'

const THEME_META_COLOR: Record<HardwareFinish, string> = {
  dark: '#101010',
  light: '#e7e2d6',
}

function readStoredFinish(): HardwareFinish {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function writeStoredFinish(finish: HardwareFinish): void {
  try {
    localStorage.setItem(STORAGE_KEY, finish)
  } catch {
    // Storage may be blocked in restricted browsing contexts.
  }
}

function syncFinishControls(finish: HardwareFinish): void {
  const isLight = finish === 'light'
  const toggleLabel = isLight ? '☀ Aluminum' : '☾ Carbon'
  const nextTitle = isLight ? 'Switch finish to Carbon (dark)' : 'Switch finish to Aluminum (light)'

  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]')) {
    const labelTarget = btn.querySelector<HTMLElement>('[data-theme-label]') ?? btn
    labelTarget.textContent = toggleLabel
    btn.setAttribute('aria-pressed', String(isLight))
    btn.setAttribute('aria-label', nextTitle)
    btn.title = nextTitle
  }

  for (const plate of document.querySelectorAll<HTMLButtonElement>('[data-set-theme]')) {
    const target = plate.dataset.setTheme === 'light' ? 'light' : 'dark'
    const active = target === finish
    plate.setAttribute('aria-pressed', String(active))
    plate.classList.toggle('is-active', active)
  }
}

/** Applies the chosen hardware finish to the document, browser chrome meta tags, and controls. */
export function applyFinish(finish: HardwareFinish, persist = true): void {
  document.documentElement.setAttribute('data-theme', finish)

  const colorSchemeMeta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')
  if (colorSchemeMeta) colorSchemeMeta.content = finish

  const themeColorMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (themeColorMeta) themeColorMeta.content = THEME_META_COLOR[finish]

  if (persist) writeStoredFinish(finish)
  syncFinishControls(finish)
}

/** Initializes Carbon / Aluminum finish controls and cross-tab sync. */
export function initTheme(): void {
  applyFinish(readStoredFinish(), false)

  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]')) {
    btn.addEventListener('click', () => {
      const current =
        document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
      applyFinish(current === 'dark' ? 'light' : 'dark')
    })
  }

  for (const plate of document.querySelectorAll<HTMLButtonElement>('[data-set-theme]')) {
    plate.addEventListener('click', () => {
      const target: HardwareFinish = plate.dataset.setTheme === 'light' ? 'light' : 'dark'
      applyFinish(target)
    })
  }

  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return
    const next: HardwareFinish = event.newValue === 'light' ? 'light' : 'dark'
    applyFinish(next, false)
  })
}
