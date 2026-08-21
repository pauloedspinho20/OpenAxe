/**
 * Bundled default gear (issue #101): NAM captures/IRs shipped with the app
 * itself, so it's usable without a Tone3000 connection. Files live under
 * apps/web/src/assets/defaultGear/{amp,amp-cab,pedal,cab}/ (see that
 * directory's README) and are discovered automatically via Vite's
 * import.meta.glob - drop a file in and it shows up here with no code
 * change. Consumed by the Tone3000Browser dialog's "Defaults" tab and by
 * the factory starter scene (see scenes/factoryScenes.ts).
 */
import { fetchWithCache } from '../engine/assetCache'
import type { Gear, Tone3000Slot } from './types'

export interface DefaultGearEntry {
  /** Stable id, also used as the assetCache key once fetched. */
  id: string
  gear: Gear
  slot: Tone3000Slot
  /** Derived from the filename - see displayName(). */
  name: string
  /** Static URL Vite serves the file at (fetch() to get bytes). */
  url: string
}

// Recursive (**) so files can be organized into subfolders per pedal/amp
// (e.g. defaultGear/pedal/Ibanez TS9 Tube Screamer/Drive 7 Tone 7 Level 9.nam
// for several capture variants of one physical unit) without losing any.
const NAM_GLOB = import.meta.glob('../assets/defaultGear/{amp,amp-cab,pedal}/**/*.nam', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const WAV_GLOB = import.meta.glob('../assets/defaultGear/cab/**/*.wav', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const GEAR_DIRS = ['amp', 'amp-cab', 'pedal', 'cab'] as const

/** `.../defaultGear/amp-cab/fender-twin-clean.nam` -> 'amp-cab'. Exported for testing. */
export function gearFromPath(path: string): Gear {
  for (const dir of GEAR_DIRS) {
    if (path.includes(`/defaultGear/${dir}/`)) return dir
  }
  throw new Error(`defaultGear: cannot infer gear kind from path "${path}"`)
}

/**
 * Everything after `.../defaultGear/<gear>/`, minus the extension - e.g.
 * `Ibanez TS9 Tube Screamer/Drive 7 Tone 7 Level 9` - so two files with the
 * same basename in different subfolders still get distinct, stable ids.
 * Exported for testing.
 */
export function slugFromPath(path: string, gear: Gear): string {
  const marker = `/defaultGear/${gear}/`
  const afterGearDir = path.slice(path.indexOf(marker) + marker.length)
  return afterGearDir.replace(/\.(nam|wav)$/i, '')
}

/** `fender-twin-clean.nam` -> 'Fender Twin Clean'. Uses only the basename - a
 * subfolder used to group variants (see slugFromPath) would otherwise make
 * an already-descriptive filename redundantly long. Exported for testing. */
export function displayNameFromPath(path: string): string {
  const file = path.split('/').pop() ?? path
  const base = file.replace(/\.(nam|wav)$/i, '')
  return base.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Turns one glob-discovered {path: url} map into sorted entries. Exported for testing. */
export function buildDefaultGearEntries(
  glob: Record<string, string>,
  slot: Tone3000Slot,
): DefaultGearEntry[] {
  return Object.entries(glob)
    .map(([path, url]) => {
      const gear = gearFromPath(path)
      const slug = slugFromPath(path, gear)
      return { id: `default:${gear}:${slug}`, gear, slot, name: displayNameFromPath(path), url }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Every bundled default, model kinds first then IRs, each group name-sorted. */
export const DEFAULT_GEAR: DefaultGearEntry[] = [
  ...buildDefaultGearEntries(NAM_GLOB, 'model'),
  ...buildDefaultGearEntries(WAV_GLOB, 'ir'),
]

/** Bundled defaults for one gear kind, name-sorted. Empty until real files are added. */
export function defaultGearFor(gear: Gear): DefaultGearEntry[] {
  return DEFAULT_GEAR.filter((entry) => entry.gear === gear)
}

/** The alphabetically-first default for a gear kind, if any - used to seed the factory starter scene. */
export function firstDefaultGearFor(gear: Gear): DefaultGearEntry | undefined {
  return defaultGearFor(gear)[0]
}

/** Fetches (and caches under entry.id) a bundled default's bytes. */
export function cacheDefaultGear(entry: DefaultGearEntry): Promise<Blob> {
  return fetchWithCache(entry.id, entry.url)
}
