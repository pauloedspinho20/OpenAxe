/**
 * IndexedDB blob cache for downloaded .nam models and IR files, so they're
 * available offline after the first fetch (see the Offline/PWA epic) without
 * re-downloading from Tone3000 every session.
 */

const DB_NAME = 'nam-web-studio'
const DB_VERSION = 1
const STORE_NAME = 'assets'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode)
      const request = run(tx.objectStore(STORE_NAME))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

/** Read a cached asset by id, or null if it isn't cached. */
export async function getCachedAsset(id: string): Promise<Blob | null> {
  const result = await withStore<Blob | undefined>('readonly', (store) => store.get(id))
  return result ?? null
}

/** Store (or overwrite) an asset blob under id. */
export async function putCachedAsset(id: string, blob: Blob): Promise<void> {
  await withStore<IDBValidKey>('readwrite', (store) => store.put(blob, id))
}

/** Remove a cached asset. */
export async function deleteCachedAsset(id: string): Promise<void> {
  await withStore<undefined>('readwrite', (store) => store.delete(id))
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
