import { initTheme } from './theme'
import { initNav } from './nav'
import { initTabs } from './tabs'
import { initFinishCompare } from './finishCompare'
import { getLatestVersionString, initDownloads } from './releases'
import { initVendors } from './vendors'

const WEB_APP_URL = 'https://openaxe.pages.dev'

declare const __OPENAXE_VERSION__: string

initTheme()
initNav()
initTabs()
initFinishCompare()
initDownloads()
initVendors()

const signalRootEl = document.getElementById('signal-architecture-root')
if (signalRootEl) {
  void Promise.all([
    import('react'),
    import('react-dom/client'),
    import('./components/SignalArchitecture'),
  ])
    .then(([{ createElement }, { createRoot }, { SignalArchitecture }]) => {
      createRoot(signalRootEl).render(createElement(SignalArchitecture))
    })
    .catch((err) => {
      console.error('Failed to mount SignalArchitecture:', err)
    })
}

const versionEl = document.getElementById('landing-version')
if (versionEl) {
  const version = getLatestVersionString() ?? __OPENAXE_VERSION__
  versionEl.textContent = `v${version}`
  versionEl.setAttribute('aria-label', `version v${version}`)
}

const yearEl = document.getElementById('footer-year')
if (yearEl) {
  yearEl.textContent = String(new Date().getFullYear())
}

for (const el of document.querySelectorAll<HTMLAnchorElement>('a[data-web-app]')) {
  el.href = WEB_APP_URL
}
