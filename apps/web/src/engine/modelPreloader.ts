import { getCachedAsset } from './assetCache'
import type { Preset } from '../presets/types'

/**
 * Main-thread LRU of decoded .nam model text for gapless preset switching
 * (issue #367).
 *
 * Parsing a multi-megabyte model JSON happens on the AudioWorklet thread and
 * blocks rendering for ~100-300 ms, so it must never land in the switch path.
 * This module keeps every preset's model text resident ahead of time: the
 * staged apply reads from here (falling back to the asset cache on a miss),
 * and scene navigation prefetches its siblings after each switch.
 *
 * Budget: 64 MB of model text (a few MB per model - a 4-slot scene with two
 * model blocks each lands around 16-40 MB). Eviction is least-recently-used;
 * a miss just means that switch parses on demand again, never an error.
 */

export const MODEL_PRELOAD_BUDGET_BYTES = 64 * 1024 * 1024

interface CacheEntry {
  text: string
  bytes: number
}

const textById = new Map<string, CacheEntry>()
let cachedBytes = 0
const inflight = new Map<string, Promise<string | null>>()

function touch(id: string, entry: CacheEntry): void {
  // Map insertion order is the recency order: re-insert to mark most-recent.
  textById.delete(id)
  textById.set(id, entry)
}

function store(id: string, text: string): void {
  const bytes = text.length // UTF-16 code units - an overestimate of the UTF-8 bytes; fine for a budget
  const prev = textById.get(id)
  if (prev) cachedBytes -= prev.bytes
  const entry: CacheEntry = { text, bytes }
  touch(id, entry)
  cachedBytes += bytes
  while (cachedBytes > MODEL_PRELOAD_BUDGET_BYTES && textById.size > 1) {
    const oldest = textById.keys().next()
    if (oldest.done) break
    const victim = textById.get(oldest.value)
    textById.delete(oldest.value)
    if (victim) cachedBytes -= victim.bytes
  }
}

async function readModelText(id: string): Promise<string | null> {
  const blob = await getCachedAsset(id).catch(() => null)
  if (!blob) return null
  try {
    return await blob.text()
  } catch {
    return null
  }
}

/** Resident model text, or null on a miss. Marks the entry most-recent. */
export function getPreloadedModelText(id: string): string | null {
  const entry = textById.get(id)
  if (!entry) return null
  touch(id, entry)
  return entry.text
}

/** Remember on-demand-read text so the next switch finds it resident. */
export function cacheModelText(id: string, text: string): void {
  if (id.length === 0 || text.length === 0) return
  store(id, text)
}

/**
 * Ensure these model ids are resident, reading missing ones from the asset
 * cache. Concurrent callers share the in-flight read. Never throws: ids that
 * miss the cache (or fail to decode) resolve as missing.
 */
export async function preloadModelTexts(
  ids: Iterable<string>,
): Promise<{ loaded: string[]; missing: string[] }> {
  const loaded: string[] = []
  const missing: string[] = []
  const unique = [...new Set(ids)].filter((id) => id.length > 0)
  await Promise.all(
    unique.map(async (id) => {
      if (getPreloadedModelText(id) !== null) {
        loaded.push(id)
        return
      }
      let pending = inflight.get(id)
      if (!pending) {
        pending = readModelText(id)
        inflight.set(id, pending)
        void pending.finally(() => {
          if (inflight.get(id) === pending) inflight.delete(id)
        })
      }
      const text = await pending
      if (text === null) {
        missing.push(id)
      } else {
        store(id, text)
        loaded.push(id)
      }
    }),
  )
  return { loaded, missing }
}

/** Collect every model reference in these presets and preload them. */
export async function preloadPresets(presets: Array<Preset | null | undefined>): Promise<void> {
  const ids: string[] = []
  for (const preset of presets) {
    if (!preset) continue
    for (const block of preset.blocks) {
      if (block.modelId) ids.push(block.modelId)
    }
  }
  if (ids.length > 0) await preloadModelTexts(ids)
}

/** Current resident bytes (for diagnostics/tests). */
export function preloadedBytes(): number {
  return cachedBytes
}

/** Drop everything (tests / memory pressure). */
export function clearPreloadedModels(): void {
  textById.clear()
  cachedBytes = 0
}
