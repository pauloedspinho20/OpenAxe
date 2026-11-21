import './style.css'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { initTheme } from './theme'
import { initNav } from './nav'
import { initTabs } from './tabs'
import { initFinishCompare } from './finishCompare'
import { getLatestVersionString, initDownloads } from './releases'
import { SignalArchitecture } from './components/SignalArchitecture'

const WEB_APP_URL = 'https://openaxe.pages.dev'

declare const __OPENAXE_VERSION__: string

initTheme()
initNav()
initTabs()
initFinishCompare()
initDownloads()

const signalRootEl = document.getElementById('signal-architecture-root')
if (signalRootEl) {
  createRoot(signalRootEl).render(createElement(SignalArchitecture))
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
