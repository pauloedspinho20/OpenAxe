import './style.css'
import releasesData from './generated/releases.json'

type Asset = {
  name: string
  size: number
  browser_download_url: string
}
type Release = {
  tag_name: string
  name: string
  published_at: string
  html_url: string
  assets: Asset[]
}

// Config — keep in one place so the SEO JSON-LD and the live CTA agree.
const WEB_APP_URL = 'https://openaxe.pages.dev'
const REPO_URL = 'https://github.com/pauloedspinho20/OpenAxe'
const PAGES_CANONICAL = 'https://pauloedspinho20.github.io/OpenAxe/'

function formatBytes(n: number): string {
  if (!n) return ''
  const mb = n / (1024 * 1024)
  if (mb >= 1) return `${mb.toFixed(1)} MB`
  const kb = n / 1024
  return `${kb.toFixed(0)} KB`
}

function detectPlatform(): 'mac' | 'win' | 'linux' | null {
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('mac')) return 'mac'
  if (ua.includes('win')) return 'win'
  if (ua.includes('linux')) return 'linux'
  return null
}

function assetLabel(name: string): string {
  if (name.endsWith('.dmg')) return 'macOS (dmg)'
  if (name.endsWith('.zip') && name.includes('desktop')) return 'Windows (zip)'
  if (name.endsWith('.zip') && name.includes('plugin')) return 'Plugin'
  if (name.endsWith('.deb')) return 'Linux (deb)'
  if (name.endsWith('.tar.gz')) return 'Plugin (tar.gz)'
  return name
}

function assetIcon(name: string): string {
  if (name.endsWith('.dmg')) return '◈'
  if (name.endsWith('.zip')) return '▣'
  if (name.endsWith('.deb')) return '⬢'
  if (name.endsWith('.tar.gz')) return '⬣'
  return '⬡'
}

function pickPrimary(assets: Asset[], platform: ReturnType<typeof detectPlatform>): Asset | null {
  if (!assets.length) return null
  if (platform === 'mac') return assets.find((a) => a.name.endsWith('.dmg')) ?? assets[0]
  if (platform === 'win') return assets.find((a) => a.name.endsWith('.zip')) ?? assets[0]
  if (platform === 'linux') return assets.find((a) => a.name.endsWith('.deb')) ?? assets[0]
  return assets.find((a) => a.name.endsWith('.dmg')) ?? assets[0]
}

function renderDownloads(): void {
  const data = releasesData as { releases: Release[] }
  const releases = data.releases || []
  const latest = releases[0]
  const container = document.getElementById('download-root')
  if (!container) return

  if (!latest) {
    container.innerHTML = `<p class="muted">No releases published yet. Check <a href="${REPO_URL}/releases">GitHub Releases</a>.</p>`
    return
  }

  const platform = detectPlatform()
  const primary = pickPrimary(latest.assets, platform)

  // Latest card
  const latestHtml = `
    <div class="release-card" id="latest-release">
      <div class="release-head">
        <div>
          <strong>${latest.tag_name}</strong>
          <span style="margin-left:8px;font-size:11px;font-weight:700;letter-spacing:.08em;color:var(--accent);background:var(--accent-dim);border:1px solid var(--accent);border-radius:999px;padding:1px 7px;">LATEST</span>
        </div>
        <time datetime="${latest.published_at}">${new Date(latest.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</time>
      </div>
      <div class="release-body">
        ${
          primary
            ? `<a class="btn btn-primary" href="${primary.browser_download_url}" download style="width:100%;margin-bottom:var(--sp-3)">${assetIcon(primary.name)} Download ${latest.tag_name} — ${assetLabel(primary.name)}</a>`
            : ''
        }
        <div class="asset-list" role="list" aria-label="Download assets for ${latest.tag_name}">
          ${latest.assets
            .map(
              (a) => `
            <a class="asset" role="listitem" href="${a.browser_download_url}" download>
              <span class="meta">
                <span class="name">${assetIcon(a.name)} ${a.name}</span>
                <span class="submeta">${formatBytes(a.size)}</span>
              </span>
              <span aria-hidden="true" style="color:var(--ink-3)">↗</span>
            </a>`,
            )
            .join('')}
        </div>
        <p class="download-note">
          Also available on <a href="${latest.html_url}">GitHub Releases</a>.
          On macOS the dmg is unsigned — right-click → Open on first launch. Linux .deb installs via <code>dpkg -i</code>.
        </p>
      </div>
    </div>
  `

  // Archive
  const archive = releases.slice(1)
  const archiveHtml =
    archive.length === 0
      ? '<p class="muted" style="margin-top:var(--sp-4)">Archive will grow with each <code>v*</code> tag — see <a href="' +
        REPO_URL +
        '/releases">all releases</a>.</p>'
      : `
    <div class="archive">
      <h3>Previous releases</h3>
      <div class="archive-list">
        ${archive
          .map(
            (r) => `
          <div class="archive-row">
            <span><a href="${r.html_url}">${r.tag_name}</a> <span class="muted" style="font-size:11px">${new Date(r.published_at).toLocaleDateString()}</span></span>
            <span style="display:flex;gap:8px;flex-wrap:wrap">
              ${r.assets.map((a) => `<a href="${a.browser_download_url}" download title="${a.name}">${assetLabel(a.name)}</a>`).join(' · ')}
            </span>
          </div>`,
          )
          .join('')}
      </div>
    </div>`

  container.innerHTML = latestHtml + archiveHtml

  // Stamp header CTA to latest dmg/zip
  const cta = document.getElementById('download-cta') as HTMLAnchorElement | null
  if (cta && primary) cta.href = primary.browser_download_url

  // Update web app links (in case canonical changes)
  for (const el of document.querySelectorAll<HTMLAnchorElement>('a[data-web-app]')) {
    el.href = WEB_APP_URL
  }
  const pagesLink = document.getElementById('pages-canonical') as HTMLAnchorElement | null
  if (pagesLink) pagesLink.href = PAGES_CANONICAL
}

// Theme: respect prefers-color-scheme, persist choice
function initTheme(): void {
  const key = 'openaxe-theme'
  const saved = localStorage.getItem(key) as 'dark' | 'light' | null
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const theme = saved ?? (prefersDark ? 'dark' : 'dark') // default Carbon
  document.documentElement.setAttribute('data-theme', theme)
  const btn = document.getElementById('theme-toggle')
  if (btn) {
    btn.textContent = theme === 'dark' ? '☾ Carbon' : '☀ Aluminum'
    btn.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') as 'dark' | 'light'
      const next = cur === 'dark' ? 'light' : 'dark'
      document.documentElement.setAttribute('data-theme', next)
      localStorage.setItem(key, next)
      btn.textContent = next === 'dark' ? '☾ Carbon' : '☀ Aluminum'
    })
  }
}

initTheme()
renderDownloads()

// Stamp version + footer year without needing JS for SEO content
const verEl = document.getElementById('landing-version')
if (verEl) {
  // Keep in sync with VERSION file — duplicated at build; runtime fallback is releasesData latest
  const v =
    (releasesData as { releases: Release[] }).releases[0]?.tag_name?.replace(/^v/, '') ?? '0.2.3'
  verEl.textContent = `v${v}`
}
const yearEl = document.getElementById('footer-year')
if (yearEl) yearEl.textContent = String(new Date().getFullYear())
