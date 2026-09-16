import { useCallback, useEffect, useRef, useState } from 'react'
import pkg from '../../package.json'

// The release source of truth is the landing's build-time manifest
// (apps/landing/scripts/fetch-releases.mjs → releases-data.json, published
// alongside the landing at openaxe-site.pages.dev). The repo is private, so
// the unauthenticated GitHub API can't be used from the browser; the landing
// is public and serves this file with `access-control-allow-origin: *`.
const RELEASES_MANIFEST_URL = 'https://openaxe-site.pages.dev/releases-data.json'
const CACHE_KEY = 'openaxe-update-cache'
const DISMISS_PREFIX = 'openaxe-dismissed-update-'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6h
const POLL_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24h

export interface ReleaseInfo {
  tag: string
  htmlUrl: string
  publishedAt: string | null
}

interface CacheEntry {
  tag: string
  htmlUrl: string
  publishedAt: string | null
  fetchedAt: number
}

// ---------------------------------------------------------------------------
// semver helpers — strip leading v, compare numerics; pre-release ignored
// ---------------------------------------------------------------------------

function parseSemver(v: string): number[] | null {
  const s = v.trim().replace(/^v/i, '')
  if (!s) return null
  const parts = s.split('.').map((p) => Number(p.split('-')[0]))
  if (parts.some((n) => Number.isNaN(n))) return null
  return parts
}

export function isNewer(latestTag: string, currentVersion: string): boolean {
  const latest = parseSemver(latestTag)
  const current = parseSemver(currentVersion)
  if (!latest || !current) return false
  const len = Math.max(latest.length, current.length)
  for (let i = 0; i < len; i++) {
    const l = latest[i] ?? 0
    const c = current[i] ?? 0
    if (l > c) return true
    if (l < c) return false
  }
  return false
}

function isDismissed(tag: string): boolean {
  try {
    return localStorage.getItem(`${DISMISS_PREFIX}${tag}`) === '1'
  } catch {
    return false
  }
}

function readCache(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheEntry
    if (!parsed.tag || typeof parsed.fetchedAt !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(entry: CacheEntry): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry))
  } catch {
    // quota or private mode — ignore
  }
}

async function fetchLatest(): Promise<ReleaseInfo | null> {
  const res = await fetch(RELEASES_MANIFEST_URL, { cache: 'no-store' })
  if (!res.ok) return null
  const data = (await res.json()) as {
    releases?: Array<{
      tag_name?: string
      html_url?: string
      published_at?: string | null
      prerelease?: boolean
    }>
  }
  // Newest first, drafts excluded upstream; skip prereleases like the GitHub
  // releases/latest endpoint this replaced.
  const latest = data.releases?.find((r) => r.tag_name && r.html_url && !r.prerelease)
  if (!latest?.tag_name || !latest.html_url) return null
  return {
    tag: latest.tag_name,
    htmlUrl: latest.html_url,
    publishedAt: latest.published_at ?? null,
  }
}

export function dismissUpdate(tag: string): void {
  try {
    localStorage.setItem(`${DISMISS_PREFIX}${tag}`, '1')
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// hook
// ---------------------------------------------------------------------------

export interface UseUpdateCheckResult {
  /** Latest released tag if newer than current and not dismissed, else null */
  latest: ReleaseInfo | null
  checking: boolean
  dismiss: () => void
  refresh: () => Promise<void>
}

export function useUpdateCheck(currentVersion: string = pkg.version): UseUpdateCheckResult {
  const [latest, setLatest] = useState<ReleaseInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const checkingRef = useRef(false)

  const applyResult = useCallback(
    (info: ReleaseInfo | null) => {
      if (!info) {
        setLatest(null)
        return
      }
      if (!isNewer(info.tag, currentVersion)) {
        setLatest(null)
        return
      }
      if (isDismissed(info.tag)) {
        setLatest(null)
        return
      }
      setLatest(info)
    },
    [currentVersion],
  )

  const refresh = useCallback(async () => {
    if (checkingRef.current) return
    checkingRef.current = true
    setChecking(true)
    try {
      const info = await fetchLatest()
      if (info) {
        writeCache({ ...info, fetchedAt: Date.now() })
        applyResult(info)
      } else {
        // no network — keep whatever cache we have
        const cached = readCache()
        if (cached && isNewer(cached.tag, currentVersion) && !isDismissed(cached.tag)) {
          applyResult({ tag: cached.tag, htmlUrl: cached.htmlUrl, publishedAt: cached.publishedAt })
        }
      }
    } catch {
      // silent — update check never blocks the gate
      const cached = readCache()
      if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS * 4) {
        if (isNewer(cached.tag, currentVersion) && !isDismissed(cached.tag)) {
          applyResult({ tag: cached.tag, htmlUrl: cached.htmlUrl, publishedAt: cached.publishedAt })
        }
      }
    } finally {
      checkingRef.current = false
      setChecking(false)
    }
  }, [applyResult, currentVersion])

  // initial load — use fresh cache if available, otherwise fetch
  useEffect(() => {
    const cached = readCache()
    const fresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS
    if (fresh && cached && isNewer(cached.tag, currentVersion) && !isDismissed(cached.tag)) {
      setLatest({ tag: cached.tag, htmlUrl: cached.htmlUrl, publishedAt: cached.publishedAt })
      // still refresh in background if cache is older than half TTL
      if (Date.now() - cached.fetchedAt > CACHE_TTL_MS / 2) void refresh()
    } else {
      void refresh()
    }
  }, [currentVersion, refresh])

  // poll + visibility
  useEffect(() => {
    const id = window.setInterval(() => {
      void refresh()
    }, POLL_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  const dismiss = useCallback(() => {
    if (!latest) return
    dismissUpdate(latest.tag)
    setLatest(null)
  }, [latest])

  return { latest, checking, dismiss, refresh }
}
