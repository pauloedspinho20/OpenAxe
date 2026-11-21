import releasesData from './generated/releases.json'
import { wireTabContainer } from './tabs'

export type PlatformKey = 'mac' | 'win' | 'linux'
export type ArtifactCategory = 'desktop' | 'plugin'

export interface ReleaseAsset {
  name: string
  size: number
  browser_download_url: string
}

export interface ReleaseRecord {
  tag_name: string
  name: string
  published_at: string
  html_url: string
  body?: string
  assets: ReleaseAsset[]
}

const RELEASE_DATA = releasesData as { repo?: string; releases: ReleaseRecord[] }
const REPO = RELEASE_DATA.repo || 'pauloedspinho20/OpenAxe'

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function parseSemver(tag: string): [number, number, number] | null {
  const m = tag.match(/(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function compareSemverDesc(a: ReleaseRecord, b: ReleaseRecord): number {
  const va = parseSemver(a.tag_name)
  const vb = parseSemver(b.tag_name)
  if (va && vb) {
    for (let i = 0; i < 3; i += 1) {
      if (va[i] !== vb[i]) return vb[i]! - va[i]!
    }
  } else if (va || vb) {
    return va ? -1 : 1
  }
  return new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime()
}

function mergeReleaseLists(bundled: ReleaseRecord[], incoming: ReleaseRecord[]): ReleaseRecord[] {
  const byTag = new Map<string, ReleaseRecord>()
  for (const r of bundled) byTag.set(r.tag_name, r)
  for (const r of incoming) {
    const existing = byTag.get(r.tag_name)
    if (!existing) {
      byTag.set(r.tag_name, r)
      continue
    }
    const existingUsesR2 = existing.assets.some((a) => a.browser_download_url.includes('.r2.dev/'))
    byTag.set(r.tag_name, {
      ...r,
      ...existing,
      assets: existingUsesR2 || existing.assets.length ? existing.assets : r.assets,
      html_url: r.html_url || existing.html_url,
      body: existing.body || r.body,
    })
  }
  return Array.from(byTag.values()).sort(compareSemverDesc)
}

function formatBytes(bytes: number): string {
  if (!bytes) return ''
  const mb = bytes / (1024 * 1024)
  if (mb >= 1) return `${mb.toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

function formatDate(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  return parsed.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function detectPlatform(): PlatformKey {
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('win')) return 'win'
  if (ua.includes('linux') && !ua.includes('android')) return 'linux'
  return 'mac'
}

function assetPlatform(name: string): PlatformKey | 'other' {
  const n = name.toLowerCase()
  if (n.endsWith('.dmg') || n.includes('macos') || n.includes('darwin')) return 'mac'
  if (
    n.includes('windows') ||
    n.endsWith('.msi') ||
    (n.includes('desktop') && n.endsWith('.zip'))
  ) {
    return 'win'
  }
  if (n.endsWith('.deb') || n.includes('ubuntu') || n.includes('linux')) return 'linux'
  return 'other'
}

function assetCategory(name: string): ArtifactCategory {
  return name.toLowerCase().includes('plugin') ? 'plugin' : 'desktop'
}

function assetLabel(name: string): string {
  const n = name.toLowerCase()
  const ext = n.endsWith('.tar.gz') ? '.tar.gz' : '.zip'
  if (n.endsWith('.dmg')) return 'macOS Desktop (.dmg)'
  if (n.includes('desktop') && n.endsWith('.zip')) return 'Windows Desktop (.zip)'
  if (n.includes('desktop') && n.endsWith('.deb')) return 'Linux Desktop (.deb)'
  if (n.includes('plugin') && n.includes('macos')) return `macOS VST3 · CLAP · AU (${ext})`
  if (n.includes('plugin') && n.includes('windows')) return `Windows VST3 · CLAP (${ext})`
  if (n.includes('plugin') && (n.includes('ubuntu') || n.includes('linux'))) {
    return `Linux VST3 · CLAP (${ext})`
  }
  if (n.endsWith('darwin.pkg')) return 'macOS Plugin Installer (.pkg)'
  if (n.endsWith('windows.msi')) return 'Windows Plugin Installer (.msi)'
  if (n.endsWith('.deb')) return 'Linux Plugin (.deb)'
  if (n.endsWith('.tar.gz')) return 'Linux Archive (.tar.gz)'
  return name
}

function assetFormatsHint(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('plugin') && n.includes('macos')) return 'VST3 · CLAP · Audio Unit (Universal)'
  if (n.includes('plugin') && n.includes('windows')) return 'VST3 · CLAP (x64)'
  if (n.includes('plugin') && (n.includes('ubuntu') || n.includes('linux')))
    return 'VST3 · CLAP (x64)'
  if (n.endsWith('.dmg')) return 'Native C++ + WebView + miniaudio'
  if (n.includes('desktop') && n.endsWith('.zip')) return 'Native C++ + WebView2 + miniaudio'
  if (n.includes('desktop') && n.endsWith('.deb')) return 'Native C++ + WebKitGTK + miniaudio'
  return 'Binary artifact'
}

function extractChecksumsUrl(release: ReleaseRecord): string {
  const r2Asset = release.assets.find((a) => a.browser_download_url.includes('.r2.dev/'))
  if (r2Asset) {
    const dir = r2Asset.browser_download_url.replace(/\/[^/]+$/, '')
    return `${dir}/sha256sums.txt`
  }
  if (release.html_url.includes('.r2.dev/')) {
    return `${release.html_url.replace(/\/$/, '')}/sha256sums.txt`
  }
  const match = release.body?.match(/https:\/\/[^\s)\]]+/)
  return match ? match[0] : release.html_url
}

function renderAssetRow(asset: ReleaseAsset): string {
  return `
    <a class="asset" href="${escapeHtml(asset.browser_download_url)}" download>
      <span class="meta">
        <span class="name">${escapeHtml(assetLabel(asset.name))}</span>
        <span class="submeta">${escapeHtml(asset.name)} · ${escapeHtml(formatBytes(asset.size))}</span>
      </span>
      <span class="asset-action" aria-hidden="true">⬇</span>
    </a>`
}

function renderPlatformPanel(latest: ReleaseRecord, platform: PlatformKey): string {
  const forOs = latest.assets.filter((a) => assetPlatform(a.name) === platform)
  const desktop = forOs.find((a) => assetCategory(a.name) === 'desktop')
  const plugin = forOs.find((a) => assetCategory(a.name) === 'plugin')

  const osTip: Record<PlatformKey, string> = {
    mac: 'Unsigned beta builds: right-click → Open on first Desktop launch. Copy plugin bundles into ~/Library/Audio/Plug-Ins/{VST3,CLAP,Components}.',
    win: 'Extract the Desktop .zip anywhere and run openaxe.exe. Copy .vst3 / .clap plugin bundles into C:\\Program Files\\Common Files\\VST3 (or CLAP).',
    linux:
      'Install the Desktop build with <code>sudo dpkg -i openaxe-desktop-*.deb</code>. Extract plugin bundles into ~/.vst3 or ~/.clap.',
  }

  const desktopCard = desktop
    ? `
      <article class="ox-card download-card">
        <div class="download-card-head">
          <span class="ox-badge ox-badge-live">Desktop App</span>
          <span class="download-size">${escapeHtml(formatBytes(desktop.size))}</span>
        </div>
        <h3 class="ox-card-title">Standalone Studio</h3>
        <p>${escapeHtml(assetFormatsHint(desktop.name))}</p>
        <a class="ox-btn ox-btn-primary download-card-cta" href="${escapeHtml(desktop.browser_download_url)}" download>
          ⬇ Download ${escapeHtml(latest.tag_name)}
        </a>
        <div class="download-filename">${escapeHtml(desktop.name)}</div>
      </article>`
    : `
      <article class="ox-card download-card">
        <div class="download-card-head">
          <span class="ox-badge ox-badge-planned">Desktop App</span>
        </div>
        <h3 class="ox-card-title">Standalone Studio</h3>
        <p>No desktop package found for this OS in ${escapeHtml(latest.tag_name)} — check <a href="/releases.html">all releases</a>.</p>
      </article>`

  const pluginCard = plugin
    ? `
      <article class="ox-card download-card">
        <div class="download-card-head">
          <span class="ox-badge ox-badge-beta">DAW Plugin</span>
          <span class="download-size">${escapeHtml(formatBytes(plugin.size))}</span>
        </div>
        <h3 class="ox-card-title">VST3 · CLAP${platform === 'mac' ? ' · AU' : ''}</h3>
        <p>${escapeHtml(assetFormatsHint(plugin.name))}</p>
        <a class="ox-btn ox-btn-ghost download-card-cta" href="${escapeHtml(plugin.browser_download_url)}" download>
          ⬇ Download Plugin Bundle
        </a>
        <div class="download-filename">${escapeHtml(plugin.name)}</div>
      </article>`
    : `
      <article class="ox-card download-card">
        <div class="download-card-head">
          <span class="ox-badge ox-badge-planned">DAW Plugin</span>
        </div>
        <h3 class="ox-card-title">VST3 · CLAP</h3>
        <p>
          Linux VST3/CLAP bundles ship in earlier releases and build from source via CMake — see
          <a href="/releases.html">all releases</a>.
        </p>
      </article>`

  return `
    <div class="download-cards-grid">
      ${desktopCard}
      ${pluginCard}
    </div>
    <p class="download-note">${osTip[platform]}</p>`
}

function renderHomeDownloadSection(releases: ReleaseRecord[]): void {
  const root = document.getElementById('download-root')
  if (!root) return

  const latest = releases[0]
  if (!latest) {
    root.innerHTML = '<p class="muted">No releases published yet.</p>'
    root.setAttribute('aria-busy', 'false')
    return
  }

  const detected = detectPlatform()
  const osLabels: Record<PlatformKey, string> = {
    mac: 'macOS',
    win: 'Windows',
    linux: 'Linux',
  }

  const heroCta = document.getElementById('download-cta') as HTMLAnchorElement | null
  const primaryDesktop = latest.assets.find(
    (a) => assetPlatform(a.name) === detected && assetCategory(a.name) === 'desktop',
  )
  if (heroCta) {
    heroCta.textContent = `⬇ Download for ${osLabels[detected]}`
    if (primaryDesktop) {
      heroCta.title = `${primaryDesktop.name} (${formatBytes(primaryDesktop.size)})`
    }
  }

  const checksumsUrl = extractChecksumsUrl(latest)

  root.innerHTML = `
    <div class="ox-card release-card" data-tabs>
      <div class="release-head">
        <div class="release-head-meta">
          <strong>${escapeHtml(latest.tag_name)}</strong>
          <span class="ox-badge ox-badge-accent">LATEST</span>
          <time datetime="${escapeHtml(latest.published_at)}">${escapeHtml(formatDate(latest.published_at))}</time>
        </div>
        <div class="os-tablist" role="tablist" aria-label="Operating system installers">
          <button type="button" class="os-tab" id="dl-tab-mac" role="tab" data-tab="mac" aria-selected="${detected === 'mac'}" tabindex="${detected === 'mac' ? 0 : -1}">macOS</button>
          <button type="button" class="os-tab" id="dl-tab-win" role="tab" data-tab="win" aria-selected="${detected === 'win'}" tabindex="${detected === 'win' ? 0 : -1}">Windows</button>
          <button type="button" class="os-tab" id="dl-tab-linux" role="tab" data-tab="linux" aria-selected="${detected === 'linux'}" tabindex="${detected === 'linux' ? 0 : -1}">Linux</button>
          <button type="button" class="os-tab" id="dl-tab-all" role="tab" data-tab="all" aria-selected="false" tabindex="-1">All files (${latest.assets.length})</button>
        </div>
      </div>

      <div class="release-body">
        <div role="tabpanel" data-panel="mac" aria-labelledby="dl-tab-mac" ${detected === 'mac' ? '' : 'hidden="until-found"'}>
          <div class="dl-panel-inner">${renderPlatformPanel(latest, 'mac')}</div>
        </div>
        <div role="tabpanel" data-panel="win" aria-labelledby="dl-tab-win" ${detected === 'win' ? '' : 'hidden="until-found"'}>
          <div class="dl-panel-inner">${renderPlatformPanel(latest, 'win')}</div>
        </div>
        <div role="tabpanel" data-panel="linux" aria-labelledby="dl-tab-linux" ${detected === 'linux' ? '' : 'hidden="until-found"'}>
          <div class="dl-panel-inner">${renderPlatformPanel(latest, 'linux')}</div>
        </div>
        <div role="tabpanel" data-panel="all" aria-labelledby="dl-tab-all" hidden="until-found">
          <div class="dl-panel-inner">
            <div class="asset-list" role="list" aria-label="All assets for ${escapeHtml(latest.tag_name)}">
              ${latest.assets.map(renderAssetRow).join('')}
            </div>
          </div>
        </div>

        <div class="release-foot">
          <a href="${escapeHtml(checksumsUrl)}" target="_blank" rel="noopener">SHA-256 checksums ↗</a>
          <a href="${escapeHtml(latest.html_url)}" target="_blank" rel="noopener">Release notes ↗</a>
        </div>
      </div>
    </div>`

  root.setAttribute('aria-busy', 'false')

  const tabWidget = root.querySelector('[data-tabs]')
  if (tabWidget) wireTabContainer(tabWidget)
}

function renderReleasesArchivePage(releases: ReleaseRecord[]): void {
  const root = document.getElementById('releases-root')
  if (!root) return

  if (!releases.length) {
    root.innerHTML = '<p class="muted">No releases published yet.</p>'
    root.setAttribute('aria-busy', 'false')
    return
  }

  let osFilter: 'all' | PlatformKey = 'all'
  let kindFilter: 'all' | ArtifactCategory = 'all'

  const filterAssets = (assets: ReleaseAsset[]) =>
    assets.filter((a) => {
      const matchOs = osFilter === 'all' || assetPlatform(a.name) === osFilter
      const matchKind = kindFilter === 'all' || assetCategory(a.name) === kindFilter
      return matchOs && matchKind
    })

  const draw = () => {
    const latest = releases[0]!
    const archive = releases.slice(1)
    const latestAssets = filterAssets(latest.assets)

    const latestDesktop = latestAssets.filter((a) => assetCategory(a.name) === 'desktop')
    const latestPlugins = latestAssets.filter((a) => assetCategory(a.name) === 'plugin')

    const latestCard = `
      <section class="ox-card release-card spotlight-release" aria-labelledby="latest-heading">
        <div class="release-head">
          <div class="release-head-meta">
            <h2 id="latest-heading" style="margin:0;font-size:18px">${escapeHtml(latest.tag_name)}</h2>
            <span class="ox-badge ox-badge-accent">LATEST</span>
            <time datetime="${escapeHtml(latest.published_at)}">${escapeHtml(formatDate(latest.published_at))}</time>
          </div>
          <div class="release-head-links">
            <a href="${escapeHtml(extractChecksumsUrl(latest))}" target="_blank" rel="noopener">sha256sums ↗</a>
            <a href="${escapeHtml(latest.html_url)}" target="_blank" rel="noopener">Release notes ↗</a>
          </div>
        </div>
        <div class="release-body">
          ${
            latestAssets.length === 0
              ? '<p class="muted">No artifacts match the active filters in this release.</p>'
              : `
            <div class="release-columns">
              ${
                latestDesktop.length
                  ? `<div>
                      <div class="release-col-label">Desktop Standalone</div>
                      <div class="asset-list">${latestDesktop.map(renderAssetRow).join('')}</div>
                    </div>`
                  : ''
              }
              ${
                latestPlugins.length
                  ? `<div>
                      <div class="release-col-label">DAW Plugin Bundles (VST3 · CLAP · AU)</div>
                      <div class="asset-list">${latestPlugins.map(renderAssetRow).join('')}</div>
                    </div>`
                  : ''
              }
            </div>`
          }
        </div>
      </section>`

    const archiveItems = archive
      .map((r) => {
        const matched = filterAssets(r.assets)
        if (!matched.length) return ''
        return `
          <article class="ox-card archive-card">
            <div class="archive-card-head">
              <div class="release-head-meta">
                <strong>${escapeHtml(r.tag_name)}</strong>
                <time datetime="${escapeHtml(r.published_at)}">${escapeHtml(formatDate(r.published_at))}</time>
              </div>
              <a href="${escapeHtml(r.html_url)}" target="_blank" rel="noopener">Release notes ↗</a>
            </div>
            <div class="archive-chips">
              ${matched
                .map(
                  (a) => `
                <a class="archive-chip" href="${escapeHtml(a.browser_download_url)}" download title="${escapeHtml(a.name)}">
                  <span>${escapeHtml(assetLabel(a.name))}</span>
                  <span class="muted">${escapeHtml(formatBytes(a.size))}</span>
                </a>`,
                )
                .join('')}
            </div>
          </article>`
      })
      .filter(Boolean)

    const listEl = document.getElementById('releases-list')
    if (listEl) {
      listEl.innerHTML =
        latestCard +
        (archiveItems.length
          ? `<div class="archive"><h3>Release history (${archiveItems.length})</h3><div class="archive-cards">${archiveItems.join('')}</div></div>`
          : '')
    }
  }

  root.innerHTML = `
    <div class="releases-toolbar" role="region" aria-label="Filter releases">
      <div class="filter-group" role="group" aria-label="Filter by format">
        <button type="button" class="filter-pill is-active" data-filter-kind="all" aria-pressed="true">All formats</button>
        <button type="button" class="filter-pill" data-filter-kind="desktop" aria-pressed="false">Desktop App</button>
        <button type="button" class="filter-pill" data-filter-kind="plugin" aria-pressed="false">DAW Plugin</button>
      </div>
      <div class="filter-group" role="group" aria-label="Filter by operating system">
        <button type="button" class="filter-pill is-active" data-filter-os="all" aria-pressed="true">All OS</button>
        <button type="button" class="filter-pill" data-filter-os="mac" aria-pressed="false">macOS</button>
        <button type="button" class="filter-pill" data-filter-os="win" aria-pressed="false">Windows</button>
        <button type="button" class="filter-pill" data-filter-os="linux" aria-pressed="false">Linux</button>
      </div>
    </div>
    <div id="releases-list"></div>`

  root.setAttribute('aria-busy', 'false')

  root.addEventListener('click', (event) => {
    const kindBtn = (event.target as Element | null)?.closest<HTMLButtonElement>(
      '[data-filter-kind]',
    )
    if (kindBtn?.dataset.filterKind) {
      kindFilter = kindBtn.dataset.filterKind as typeof kindFilter
      for (const b of root.querySelectorAll<HTMLButtonElement>('[data-filter-kind]')) {
        const active = b === kindBtn
        b.classList.toggle('is-active', active)
        b.setAttribute('aria-pressed', String(active))
      }
      draw()
      return
    }

    const osBtn = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-filter-os]')
    if (osBtn?.dataset.filterOs) {
      osFilter = osBtn.dataset.filterOs as typeof osFilter
      for (const b of root.querySelectorAll<HTMLButtonElement>('[data-filter-os]')) {
        const active = b === osBtn
        b.classList.toggle('is-active', active)
        b.setAttribute('aria-pressed', String(active))
      }
      draw()
    }
  })

  draw()
}

function updateHeaderVersion(releases: ReleaseRecord[]): void {
  const verEl = document.getElementById('landing-version')
  const tag = releases[0]?.tag_name?.replace(/^v/i, '')
  if (verEl && tag) {
    verEl.textContent = `v${tag}`
    verEl.setAttribute('aria-label', `version v${tag}`)
  }
}

async function refreshLatestReleases(bundled: ReleaseRecord[]): Promise<void> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
      headers: { Accept: 'application/vnd.github+json' },
      priority: 'low',
    } as RequestInit)
    if (!res.ok) return
    const raw = (await res.json()) as Array<ReleaseRecord & { draft?: boolean }>
    if (!Array.isArray(raw)) return

    const live = raw
      .filter((r) => !r.draft)
      .map((r) => ({
        tag_name: r.tag_name,
        name: r.name || r.tag_name,
        published_at: r.published_at,
        html_url: r.html_url,
        body: r.body || '',
        assets: (r.assets || []).map((a) => ({
          name: a.name,
          size: a.size,
          browser_download_url: a.browser_download_url,
        })),
      }))

    const merged = mergeReleaseLists(bundled, live)
    const changed = merged.length !== bundled.length || merged[0]?.tag_name !== bundled[0]?.tag_name
    if (!changed) return

    renderHomeDownloadSection(merged)
    renderReleasesArchivePage(merged)
    updateHeaderVersion(merged)
  } catch {
    // Offline or API rate-limited: stay with bundled releases silently.
  }
}

/** Returns the latest release tag without leading `v`, if present. */
export function getLatestVersionString(): string | null {
  const sorted = [...(RELEASE_DATA.releases || [])].sort(compareSemverDesc)
  const latest = sorted[0]?.tag_name
  return latest ? latest.replace(/^v/i, '') : null
}

/** Populates download cards on index.html and the archive ledger on releases.html. */
export function initDownloads(): void {
  const releases = [...(RELEASE_DATA.releases || [])].sort(compareSemverDesc)
  renderHomeDownloadSection(releases)
  renderReleasesArchivePage(releases)
  void refreshLatestReleases(releases)
}
