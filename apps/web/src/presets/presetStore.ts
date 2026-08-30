/**
 * CRUD for presets - local-first, no backend/accounts (see the
 * scaffolding epic's decision). Shares the app's one database with
 * assetCache.ts via storage/db.ts.
 */
import { STORE_PRESETS } from '../storage/db'
import { kvDelete, kvGet, kvGetAll, kvPut } from '../storage/kv'
import type { Preset } from './types'

/** Save (or overwrite) a preset. Uses `preset.id` as the key, via the store's keyPath. */
export async function savePreset(preset: Preset): Promise<void> {
  await kvPut(STORE_PRESETS, preset)
}

/** Read a preset by id, or null if it doesn't exist. */
export async function getPreset(id: string): Promise<Preset | null> {
  const result = await kvGet<Preset>(STORE_PRESETS, id)
  return result ?? null
}

/** Delete a preset by id. */
export async function deletePreset(id: string): Promise<void> {
  await kvDelete(STORE_PRESETS, id)
}

/** All saved presets, in no particular order - sort/filter/tag-search is a UI-layer concern. */
export async function listPresets(): Promise<Preset[]> {
  return kvGetAll<Preset>(STORE_PRESETS)
}
