/**
 * IndexedDB blob cache for downloaded .nam models and IR files, so they're
 * available offline after the first fetch (see the Offline/PWA epic) without
 * re-downloading from Tone3000 every session.
 */
import { STORE_ASSETS, withStore } from '../storage/db'

/** Read a cached asset by id, or null if it isn't cached. */
export async function getCachedAsset(id: string): Promise<Blob | null> {
  const result = await withStore<Blob | undefined>(STORE_ASSETS, 'readonly', (store) =>
    store.get(id),
  )
  return result ?? null
}

/** Store (or overwrite) an asset blob under id. */
export async function putCachedAsset(id: string, blob: Blob): Promise<void> {
  await withStore<IDBValidKey>(STORE_ASSETS, 'readwrite', (store) => store.put(blob, id))
}

/** Remove a cached asset. */
export async function deleteCachedAsset(id: string): Promise<void> {
  await withStore<undefined>(STORE_ASSETS, 'readwrite', (store) => store.delete(id))
}

/**
 * Fetch an asset from the network, caching it under `id` for next time.
 * Returns the cached copy immediately if present (no network request).
 */
export async function fetchWithCache(id: string, url: string): Promise<Blob> {
  const cached = await getCachedAsset(id)
  if (cached) return cached

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch asset '${id}' from ${url}: ${response.status}`)
  }
  const blob = await response.blob()
  await putCachedAsset(id, blob)
  return blob
}
