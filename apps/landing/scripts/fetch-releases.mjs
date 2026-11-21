#!/usr/bin/env node
// Fetch release manifests at build time (Cloudflare R2 + GitHub Releases),
// merge by tag sorted newest-first, and write src/generated/releases.json
// (plus releases.fallback.json locally when not running in CI).

import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outPath = path.resolve(__dirname, '../src/generated/releases.json')
const fallbackPath = path.resolve(__dirname, '../src/generated/releases.fallback.json')

const REPO = process.env.GITHUB_REPOSITORY || 'pauloedspinho20/OpenAxe'
const API = `https://api.github.com/repos/${REPO}/releases?per_page=100`
const DEFAULT_R2_PUBLIC_URL = 'https://pub-800f414cbfe9422e9faaa00ed34d2821.r2.dev'

// Default: fetch both R2 and GitHub and merge by tag_name so older GitHub-only
// releases (v0.2.0-v0.2.7) and newer R2-published tags (v0.2.9, v0.4.1+)
// all appear in the archive. Explicit --source=r2 or --source=github restricts
// to that single source.
const SOURCE =
  process.argv.includes('--source=r2') || process.env.RELEASES_SOURCE === 'r2'
    ? 'r2'
    : process.argv.includes('--source=github') || process.env.RELEASES_SOURCE === 'github'
      ? 'github'
      : 'both'

function parseSemver(tag) {
  const m = String(tag || '').match(/(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function compareReleasesDesc(a, b) {
  const va = parseSemver(a.tag_name)
  const vb = parseSemver(b.tag_name)
  if (va && vb) {
    for (let i = 0; i < 3; i += 1) {
      if (va[i] !== vb[i]) return vb[i] - va[i]
    }
  } else if (va || vb) {
    return va ? -1 : 1
  }
  return new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime()
}

function mergeReleases(r2List, ghList) {
  const byTag = new Map()

  for (const gh of ghList) {
    byTag.set(gh.tag_name, gh)
  }

  for (const r2 of r2List) {
    const gh = byTag.get(r2.tag_name)
    if (!gh) {
      byTag.set(r2.tag_name, r2)
      continue
    }
    // Prefer fast R2 CDN assets while keeping GitHub release page + notes when available.
    byTag.set(r2.tag_name, {
      ...gh,
      ...r2,
      assets: r2.assets?.length ? r2.assets : gh.assets,
      html_url: gh.html_url || r2.html_url,
      body: r2.body || gh.body || '',
    })
  }

  return Array.from(byTag.values()).sort(compareReleasesDesc)
}

async function fetchFromR2() {
  const base = (process.env.R2_PUBLIC_URL || DEFAULT_R2_PUBLIC_URL).replace(/\/$/, '')
  const res = await fetch(`${base}/manifest.json`)
  if (!res.ok) throw new Error(`R2 manifest ${res.status} ${await res.text()}`)
  const manifest = await res.json()
  if (!Array.isArray(manifest.releases)) throw new Error('R2 manifest has no releases[]')
  return manifest.releases
}

async function fetchFromGitHub() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`

  const res = await fetch(API, { headers })
  if (!res.ok) throw new Error(`GitHub API ${res.status} ${await res.text()}`)
  const data = await res.json()

  return data
    .filter((r) => !r.draft)
    .map((r) => ({
      tag_name: r.tag_name,
      name: r.name || r.tag_name,
      published_at: r.published_at,
      prerelease: r.prerelease,
      html_url: r.html_url,
      body: (r.body || '').slice(0, 4000),
      assets: (r.assets || []).map((a) => ({
        name: a.name,
        size: a.size,
        download_count: a.download_count,
        browser_download_url: a.browser_download_url,
        content_type: a.content_type,
      })),
    }))
}

async function main() {
  await mkdir(path.dirname(outPath), { recursive: true })

  const fallback = existsSync(fallbackPath)
    ? JSON.parse(readFileSync(fallbackPath, 'utf8'))
    : { generated_at: new Date().toISOString(), repo: REPO, releases: [] }

  let r2Releases = []
  let ghReleases = []
  let anySuccess = false

  if (SOURCE === 'r2' || SOURCE === 'both') {
    try {
      r2Releases = await fetchFromR2()
      anySuccess = true
    } catch (err) {
      console.warn(`[fetch-releases] R2 fetch failed (${String(err)})`)
    }
  }

  if (SOURCE === 'github' || SOURCE === 'both') {
    try {
      ghReleases = await fetchFromGitHub()
      anySuccess = true
    } catch (err) {
      console.warn(`[fetch-releases] GitHub fetch failed (${String(err)})`)
    }
  }

  const merged = mergeReleases(r2Releases, ghReleases)

  if (anySuccess && merged.length > 0) {
    const payload = { generated_at: new Date().toISOString(), repo: REPO, releases: merged }
    await writeFile(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8')
    if (!process.env.CI) {
      await writeFile(fallbackPath, JSON.stringify(payload, null, 2) + '\n', 'utf8')
    }
    console.log(
      `[fetch-releases] wrote ${merged.length} releases (${SOURCE}: R2=${r2Releases.length}, GitHub=${ghReleases.length}) → ${outPath}`,
    )
    return
  }

  console.warn('[fetch-releases] all live sources failed or empty, using fallback')
  if (existsSync(fallbackPath)) {
    await writeFile(outPath, readFileSync(fallbackPath, 'utf8'))
    console.log(`[fetch-releases] copied fallback → ${outPath}`)
  } else {
    await writeFile(outPath, JSON.stringify(fallback, null, 2) + '\n', 'utf8')
    console.log(`[fetch-releases] wrote empty fallback → ${outPath}`)
  }
}

await main()
