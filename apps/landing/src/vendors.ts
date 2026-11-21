import { escapeHtml } from './releases'
import { CATEGORY_META, VENDORS, type VendorCategory, type VendorEntry } from './vendorsData'

const CATEGORY_LABEL = new Map(CATEGORY_META.map((c) => [c.key, c.label]))

const REPO_NOTICES_URL =
  'https://github.com/pauloedspinho20/OpenAxe/blob/main/THIRD_PARTY_NOTICES.md'
const REPO_LICENSES_URL = 'https://github.com/pauloedspinho20/OpenAxe/tree/main/licenses'

function renderVendorMark(v: VendorEntry, compact = false): string {
  if (v.brandImg === '/brands/tone3000.svg') {
    const height = compact ? 10 : 14
    const width = Math.round((height * 210) / 32)
    return `<span class="brand-pill-tone3000" aria-hidden="true"><img src="${escapeHtml(v.brandImg)}" alt="" width="${width}" height="${height}" loading="lazy" decoding="async" /></span>`
  }
  if (v.brandImg) {
    const size = compact ? 16 : 22
    return `<img class="brand-img-nam" src="${escapeHtml(v.brandImg)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async" aria-hidden="true" />`
  }
  if (v.icon) {
    if (compact) {
      return `<span class="icon" data-icon="${escapeHtml(v.icon)}" aria-hidden="true"></span>`
    }
    return `<span class="vendor-row-icon" aria-hidden="true"><span class="icon" data-icon="${escapeHtml(v.icon)}"></span></span>`
  }
  return ''
}

function renderPreviewBanner(root: HTMLElement): void {
  const featured = VENDORS.filter((v) => v.featured)
  const remaining = VENDORS.length - featured.length

  const chips = featured
    .map(
      (v) => `
      <a
        class="vendor-preview-chip"
        href="${escapeHtml(v.officialUrl ?? v.repoUrl)}"
        target="_blank"
        rel="noopener"
        title="${escapeHtml(v.usedFor)}"
      >
        ${renderVendorMark(v, true)}
        ${v.brandImg === '/brands/tone3000.svg' ? '<span class="sr-only">Tone3000</span>' : `<span class="vendor-preview-name">${escapeHtml(v.name)}</span>`}
        <span class="vendor-preview-ver">${escapeHtml(v.version)}</span>
      </a>`,
    )
    .join('')

  root.innerHTML = `
    <div class="ox-card vendors-banner">
      <div class="vendors-banner-head">
        <div class="vendors-banner-title">
          <h3 class="ox-card-title">External Vendors &amp; Open-Source Stack</h3>
          <span class="ox-badge ox-badge-accent">${VENDORS.length}</span>
        </div>
        <a class="ox-btn ox-btn-ghost ox-btn-sm" href="/vendors.html">
          Browse all ${VENDORS.length} vendors, versions &amp; repos →
        </a>
      </div>
      <div class="vendors-preview-chips">
        ${chips}
        ${remaining > 0 ? `<a class="vendor-preview-more" href="/vendors.html">+${remaining} more in full ledger →</a>` : ''}
      </div>
    </div>`
}

function renderVendorRow(v: VendorEntry): string {
  const categoryLabel = CATEGORY_LABEL.get(v.category) ?? v.category
  const repoLabel = v.repoLabel ?? 'GitHub'
  const repoIcon = v.repoLabel === 'GitLab' ? 'gitlab' : 'github'

  return `
    <tr>
      <th scope="row">
        <div class="vendor-row-brand">
          ${renderVendorMark(v, false)}
          <span class="vendor-name">${escapeHtml(v.name)}</span>
        </div>
        <span class="vendor-meta">
          <span class="vendor-meta-cat">${escapeHtml(categoryLabel)}</span>
          <span class="vendor-meta-lic">${escapeHtml(v.license)}</span>
        </span>
      </th>
      <td>
        <code class="vendor-ver">${escapeHtml(v.version)}</code>
      </td>
      <td class="vendor-usage">${escapeHtml(v.usedFor)}</td>
      <td>
        <div class="vendor-links">
          ${
            v.officialUrl
              ? `<a class="vendor-link-pill icon-start" data-icon="globe" href="${escapeHtml(v.officialUrl)}" target="_blank" rel="noopener">Official ↗</a>`
              : ''
          }
          <a class="vendor-link-pill icon-start" data-icon="${repoIcon}" href="${escapeHtml(v.repoUrl)}" target="_blank" rel="noopener"
            >${escapeHtml(repoLabel)} ↗</a
          >
        </div>
      </td>
    </tr>`
}

function renderVendorsLedger(root: HTMLElement): void {
  let activeCategory: 'all' | VendorCategory = 'all'

  const categoryCounts = new Map<VendorCategory, number>()
  for (const v of VENDORS) {
    categoryCounts.set(v.category, (categoryCounts.get(v.category) ?? 0) + 1)
  }

  function render(): void {
    const filtered =
      activeCategory === 'all' ? VENDORS : VENDORS.filter((v) => v.category === activeCategory)

    const filterButtons = [
      `<button type="button" class="filter-pill ${activeCategory === 'all' ? 'is-active' : ''}" data-vendor-cat="all" aria-pressed="${String(activeCategory === 'all')}">All (${VENDORS.length})</button>`,
      ...CATEGORY_META.map((cat) => {
        const count = categoryCounts.get(cat.key) ?? 0
        const pressed = activeCategory === cat.key
        return `<button type="button" class="filter-pill ${pressed ? 'is-active' : ''}" data-vendor-cat="${cat.key}" aria-pressed="${String(pressed)}">${escapeHtml(cat.label)} (${count})</button>`
      }),
    ].join('')

    root.innerHTML = `
      <div class="releases-toolbar" role="region" aria-label="Filter external vendors">
        <div class="filter-group" role="group" aria-label="Filter by architecture layer">
          ${filterButtons}
        </div>
        <p class="vendors-count" aria-live="polite">Showing ${filtered.length} of ${VENDORS.length} external vendors</p>
      </div>

      <div
        tabindex="0"
        role="region"
        aria-labelledby="vendors-table-caption"
        class="table-wrapper vendors-table-wrap"
      >
        <table class="vendors-table">
          <caption id="vendors-table-caption" class="sr-only">
            OpenAxe external vendors, versions, roles, and upstream links
          </caption>
          <thead>
            <tr>
              <th scope="col">Vendor</th>
              <th scope="col">Version</th>
              <th scope="col">Used for</th>
              <th scope="col">Links</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(renderVendorRow).join('')}
          </tbody>
        </table>
      </div>

      <div class="ox-card vendors-notice">
        <div class="vendors-notice-copy">
          <h2 class="ox-card-title">Redistribution &amp; License Compliance</h2>
          <p>
            OpenAxe ships under <strong>GPLv3</strong>, while permissive third-party components keep
            their original terms. Verbatim notices are bundled inside every desktop installer and DAW
            plugin package via <code>licenses/</code>. Notably, <code>p5@2.3.2</code> (LGPL-2.1) is
            conveyed under GPL-3.0 via LGPL-2.1 §3, and only the MIT-licensed portion of
            <code>DaisySP</code> is compiled.
          </p>
        </div>
        <div class="vendors-notice-links">
          <a
            class="ox-btn ox-btn-ghost ox-btn-sm"
            href="${REPO_NOTICES_URL}"
            target="_blank"
            rel="noopener"
            >THIRD_PARTY_NOTICES.md ↗</a
          >
          <a
            class="ox-btn ox-btn-ghost ox-btn-sm"
            href="${REPO_LICENSES_URL}"
            target="_blank"
            rel="noopener"
            >licenses/ directory ↗</a
          >
        </div>
      </div>`
  }

  root.addEventListener('click', (event) => {
    const btn = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-vendor-cat]')
    const cat = btn?.dataset.vendorCat as 'all' | VendorCategory | undefined
    if (!cat || cat === activeCategory) return
    activeCategory = cat
    render()
    const focusTarget = root.querySelector<HTMLButtonElement>(`[data-vendor-cat="${cat}"]`)
    focusTarget?.focus()
  })

  render()
}

export function initVendors(): void {
  const previewRoot = document.getElementById('vendors-preview-root')
  if (previewRoot) {
    renderPreviewBanner(previewRoot)
  }

  const ledgerRoot = document.getElementById('vendors-root')
  if (ledgerRoot) {
    renderVendorsLedger(ledgerRoot)
  }
}
