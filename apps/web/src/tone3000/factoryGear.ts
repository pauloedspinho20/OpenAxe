/**
 * Downloadable factory pack (issue #101, replacement for the bundled defaultGear
 * approach from PR #118). Curated NAM captures/IRs are listed in a runtime
 * manifest (`apps/web/public/factory/manifest.json` or `VITE_FACTORY_MANIFEST_URL`)
 * and fetched on demand via the same IndexedDB `assetCache` used for Tone3000
 * imports — no Tone3000 login, no Bearer token, just plain `fetch(url)`.
 *
 * Adding a new capture is editing the manifest JSON; the Factory tab (see
 * Tone3000Browser) and the starter presets (see scenes/factoryScenes.ts) pick
 * it up without a code change. Host-agnostic: `url` can be a relative
 * `/factory/...` path (served from `public/factory/`) or an absolute
 * `https://cdn.example/...` (needs CORS).
 */
import { fetchWithCache, getCachedAsset } from '../engine/assetCache'
import type { Gear, Tone3000Slot, ToneFormat } from './types'

export interface FactoryManifestEntry {
  /** Stable slug within its gear pack, e.g. `fender-deluxe-reverb-head-2`. */
  id: string
  /** Display name, e.g. `Fender Deluxe Reverb Head 2`. Also the single model's name when `title` is present. */
  name: string
  /** Static URL to fetch bytes from — relative or absolute. */
  url: string
  /** Optional size hint for UI (bytes). */
  size?: number
  /** Optional SHA-256 for future integrity checks. */
  sha256?: string
  /** Original Tone3000 page, for reference only — not fetched at runtime. */
  sourceUrl?: string
  /** Rich card metadata baked at curation time so the factory cards can be pixel-identical to Tone3000 browse cards without any runtime auth. */
  title?: string
  creator?: string
  imageUrl?: string | null
  description?: string | null
  downloadsCount?: number
  format?: ToneFormat
  license?: string
}

export interface FactoryManifest {
  version: number
  updatedAt?: string
  packs: Partial<Record<Gear, FactoryManifestEntry[]>>
}

export interface FactoryGearEntry {
  /** Stable id, also the assetCache key once fetched. */
  id: string
  gear: Gear
  slot: Tone3000Slot
  name: string
  url: string
  size?: number
  /** Baked Tone3000 card metadata — present when the curator added it, so factory cards can be identical to browse cards without auth. */
  sourceUrl?: string
  title: string
  creator?: string
  imageUrl?: string | null
  description?: string | null
  downloadsCount?: number
  format: ToneFormat
  license?: string
}

const FACTORY_GEARS: Gear[] = ['amp', 'amp-cab', 'pedal', 'cab'] as const

function slotForGear(gear: Gear): Tone3000Slot {
  return gear === 'cab' ? 'ir' : 'model'
}

export function getFactoryManifestUrl(): string {
  // Allow an external CDN without a code change (see issue #101 Notes).
  const envUrl = (import.meta.env as Record<string, string | undefined>).VITE_FACTORY_MANIFEST_URL
  return envUrl ?? '/factory/manifest.json'
}

let cachedManifest: FactoryManifest | null = null
let manifestPromise: Promise<FactoryManifest> | null = null

/** Fetch and cache the manifest. Subsequent calls return the in-memory copy. */
export async function loadFactoryManifest(): Promise<FactoryManifest> {
  if (cachedManifest) return cachedManifest
  if (manifestPromise) return manifestPromise

  manifestPromise = fetch(getFactoryManifestUrl())
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to fetch factory manifest: ${res.status}`)
      return res.json() as Promise<FactoryManifest>
    })
    .then((manifest) => {
      cachedManifest = manifest
      return manifest
    })
    .finally(() => {
      manifestPromise = null
    })

  return manifestPromise
}

/** Reset in-memory manifest cache — for tests only. */
export function _resetFactoryManifestCache(): void {
  cachedManifest = null
  manifestPromise = null
}

/** Directly set the cached manifest — for tests only. */
export function _setFactoryManifestForTests(manifest: FactoryManifest): void {
  cachedManifest = manifest
}

function buildEntriesForGear(
  gear: Gear,
  entries: FactoryManifestEntry[] | undefined,
): FactoryGearEntry[] {
  if (!entries || entries.length === 0) return []
  const slot = slotForGear(gear)
  return entries
    .map((e) => ({
      id: `factory:${gear}:${e.id}`,
      gear,
      slot,
      name: e.name,
      url: e.url,
      title: e.title ?? e.name,
      format: e.format ?? (gear === 'cab' ? 'ir' : 'nam'),
      ...(e.size !== undefined ? { size: e.size } : {}),
      ...(e.sourceUrl ? { sourceUrl: e.sourceUrl } : {}),
      ...(e.creator ? { creator: e.creator } : {}),
      ...(e.imageUrl !== undefined ? { imageUrl: e.imageUrl } : {}),
      ...(e.description !== undefined ? { description: e.description } : {}),
      ...(e.downloadsCount !== undefined ? { downloadsCount: e.downloadsCount } : {}),
      ...(e.license ? { license: e.license } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** All factory entries for one gear kind, name-sorted. Requires manifest loaded; empty if not yet loaded. */
export function factoryGearFor(gear: Gear): FactoryGearEntry[] {
  if (!cachedManifest) return []
  return buildEntriesForGear(gear, cachedManifest.packs[gear])
}

/** Alphabetically-first entry for a gear kind, if any — used to seed starter presets. */
export function firstFactoryGearFor(gear: Gear): FactoryGearEntry | undefined {
  return factoryGearFor(gear)[0]
}

/** Every factory entry across all gear kinds, name-sorted within each gear. */
export function allFactoryGear(): FactoryGearEntry[] {
  if (!cachedManifest) return []
  const all: FactoryGearEntry[] = []
  for (const gear of FACTORY_GEARS) {
    all.push(...buildEntriesForGear(gear, cachedManifest.packs[gear]))
  }
  return all
}

/** Fetches (and caches under entry.id) a factory asset's bytes. */
export function cacheFactoryGear(entry: FactoryGearEntry): Promise<Blob> {
  return fetchWithCache(entry.id, entry.url)
}

/** Whether a factory asset is already cached in IndexedDB. */
export async function isFactoryCached(id: string): Promise<boolean> {
  return (await getCachedAsset(id)) !== null
}

/** Exported for testing — build entries from raw manifest entries. */
export function buildFactoryGearEntries(
  gear: Gear,
  entries: FactoryManifestEntry[],
  _slot?: Tone3000Slot,
): FactoryGearEntry[] {
  const slot = _slot ?? slotForGear(gear)
  return entries
    .map((e) => ({
      id: `factory:${gear}:${e.id}`,
      gear,
      slot,
      name: e.name,
      url: e.url,
      title: e.title ?? e.name,
      format: e.format ?? (gear === 'cab' ? 'ir' : 'nam'),
      ...(e.size !== undefined ? { size: e.size } : {}),
      ...(e.sourceUrl ? { sourceUrl: e.sourceUrl } : {}),
      ...(e.creator ? { creator: e.creator } : {}),
      ...(e.imageUrl !== undefined ? { imageUrl: e.imageUrl } : {}),
      ...(e.description !== undefined ? { description: e.description } : {}),
      ...(e.downloadsCount !== undefined ? { downloadsCount: e.downloadsCount } : {}),
      ...(e.license ? { license: e.license } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
