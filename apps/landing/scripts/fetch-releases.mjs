#!/usr/bin/env node
// Fetch GitHub Releases at build time and cache to src/generated/releases.json
// Falls back to the checked-in fallback when offline or rate-limited.

import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outPath = path.resolve(__dirname, '../src/generated/releases.json')
const fallbackPath = path.resolve(__dirname, '../src/generated/releases.fallback.json')

const REPO = process.env.GITHUB_REPOSITORY || 'pauloedspinho20/OpenAxe'
const API = `https://api.github.com/repos/${REPO}/releases?per_page=100`

// --source=r2 (or RELEASES_SOURCE=r2): read the Woodpecker-published root
// manifest from R2 instead of the GitHub API (issue #427 Phase 3). Same
// output schema; the landing can't tell the difference.
const SOURCE =
  process.argv.includes('--source=r2') || process.env.RELEASES_SOURCE === 'r2' ? 'r2' : 'github'

async function fetchFromR2() {
  const base = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '')
  if (!base) throw new Error('RELEASES_SOURCE=r2 requires R2_PUBLIC_URL')
  const res = await fetch(`${base}/manifest.json`)
  if (!res.ok) throw new Error(`R2 manifest ${res.status} ${await res.text()}`)
  const manifest = await res.json()
  if (!Array.isArray(manifest.releases)) throw new Error('R2 manifest has no releases[]')
  return { generated_at: manifest.generated_at, repo: REPO, releases: manifest.releases }
}

async function main() {
  await mkdir(path.dirname(outPath), { recursive: true })

  // If no network, just ensure fallback → out copy exists
  const fallback = existsSync(fallbackPath)
    ? JSON.parse(readFileSync(fallbackPath, 'utf8'))
    : { generated_at: new Date().toISOString(), releases: [] }

  try {
    if (SOURCE === 'r2') {
      const payload = await fetchFromR2()
      await writeFile(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8')
      console.log(`[fetch-releases] wrote ${payload.releases.length} releases from R2 → ${outPath}`)
      return
    }
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`

    const res = await fetch(API, { headers })
    if (!res.ok) throw new Error(`GitHub API ${res.status} ${await res.text()}`)
    const data = await res.json()

    const releases = data
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

    const payload = { generated_at: new Date().toISOString(), repo: REPO, releases }
    await writeFile(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8')
    // Keep fallback in sync locally (do not overwrite on CI if fallback is newer manually)
    if (!process.env.CI) {
      await writeFile(fallbackPath, JSON.stringify(payload, null, 2) + '\n', 'utf8')
    }
    console.log(`[fetch-releases] wrote ${releases.length} releases → ${outPath}`)
  } catch (err) {
    console.warn(`[fetch-releases] fetch failed (${String(err)}), using fallback`)
    if (existsSync(fallbackPath)) {
      await writeFile(outPath, readFileSync(fallbackPath, 'utf8'))
      console.log(`[fetch-releases] copied fallback → ${outPath}`)
    } else {
      await writeFile(outPath, JSON.stringify(fallback, null, 2) + '\n', 'utf8')
      console.log(`[fetch-releases] wrote empty fallback → ${outPath}`)
    }
  }
}

await main()
