/**
 * Tone3000 library: metadata for models/IRs the user has imported into the
 * local preset library (the bytes live in the engine's assetCache IndexedDB
 * blob store, keyed by the same id). Tracks attribution (creator, Tone3000
 * source url) which the partner terms require when a tone is used.
 */
import { create } from 'zustand'
import { getCachedAsset, putCachedAsset } from '../engine/assetCache'
import { STORE_LIBRARY, withStore } from '../storage/db'
import { apiDownloadModel } from './client'
import type { Tone3000Slot } from './types'

/** What the app knows about one imported Tone3000 asset (the bytes are in assetCache). */
export interface Tone3000LibraryEntry {
  /** Id shared with the assetCache blob (and with presets' modelId/irId). */
  id: string
  kind: Tone3000Slot
  name: string
  creator: string
  /** Where the model/IR came from on Tone3000 (attribution). */
  sourceUrl: string
  /** Tone's own title, when we have it. */
  toneTitle: string | null
  importedAt: number
}

interface LibraryQuery {
  /** Query the cached library list. */
  list(): Promise<Tone3000LibraryEntry[]>
  /** Whether an asset id is already cached locally (offline-usable). */
  has(id: string): Promise<boolean>
  /** The cached blob for an id, or null if not cached. */
  getBlob(id: string): Promise<Blob | null>
  /** Download + cache a Tone3000 model/IR blob under `id`, returning the cached entry. */
  importAsset(params: {
    id: string
    kind: Tone3000Slot
    name: string
    creator: string
    sourceUrl: string
    toneTitle?: string | null
    modelUrl: string
  }): Promise<Tone3000LibraryEntry>
  remove: (id: string) => Promise<void>
  refresh: () => Promise<void>
  /**
   * Bump the version counter after a library→chain load so
   * ChannelStrip re-renders (it subscribes to `version`).
   */
  notifyLoaded: () => Promise<void>
}

export const useTone3000Library = create<{
  entries: Tone3000LibraryEntry[]
  /** Bumped on every import or library->chain load so ChannelStrip re-renders. */
  version: number
}>(() => ({
  entries: [],
  version: 0,
}))

async function getLibrary(): Promise<Tone3000LibraryEntry[]> {
  return withStore<Tone3000LibraryEntry[]>(
    STORE_LIBRARY,
    'readonly',
    (store) => store.getAll() as IDBRequest<Tone3000LibraryEntry[]>,
  )
    .catch(() => [])
    .then((list) => list.sort((a, b) => b.importedAt - a.importedAt))
}

export const Tone3000Library: LibraryQuery = {
  async list() {
    return getLibrary()
  },

  async has(id) {
    return (await getCachedAsset(id)) !== null
  },

  async getBlob(id) {
    return getCachedAsset(id)
  },

  async importAsset({ id, kind, name, creator, sourceUrl, toneTitle, modelUrl }) {
    const blob = await apiDownloadModel(modelUrl)
    await putCachedAsset(id, blob)
    const entry: Tone3000LibraryEntry = {
      id,
      kind,
      name,
      creator,
      sourceUrl,
      toneTitle: toneTitle ?? null,
      importedAt: Date.now(),
    }
    await withStore<IDBValidKey>(
      STORE_LIBRARY,
      'readwrite',
      (store) => store.put(entry) as IDBRequest<unknown> as IDBRequest<IDBValidKey>,
    )
    const entries = await getLibrary()
    useTone3000Library.setState((s) => ({ entries, version: s.version + 1 }))
    return entry
  },

  async remove(id) {
    await withStore<IDBValidKey>(
      STORE_LIBRARY,
      'readwrite',
      (store) => store.delete(id) as IDBRequest<unknown> as IDBRequest<IDBValidKey>,
    )
    const entries = await getLibrary()
    useTone3000Library.setState((s) => ({ entries, version: s.version + 1 }))
  },

  async refresh() {
    await useTone3000Library.setState({ entries: await getLibrary() })
  },

  async notifyLoaded() {
    useTone3000Library.setState((s) => ({ version: s.version + 1 }))
  },
}
