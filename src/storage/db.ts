/**
 * Single shared IndexedDB database for everything the app persists locally
 * (asset blobs, presets). Centralized here so adding a store bumps one
 * version number in one place - two modules independently calling
 * `indexedDB.open` with different versions for the same database name is a
 * recipe for version-conflict errors.
 */

const DB_NAME = 'nam-web-studio'
const DB_VERSION = 2

/** Blob store: downloaded .nam/IR files, keyed by an explicit id (see assetCache.ts). */
export const STORE_ASSETS = 'assets'
/** Preset store: keyPath 'id', so put() uses each preset's own id as the key (see presetStore.ts). */
export const STORE_PRESETS = 'presets'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_ASSETS)) {
        db.createObjectStore(STORE_ASSETS)
      }
      if (!db.objectStoreNames.contains(STORE_PRESETS)) {
        db.createObjectStore(STORE_PRESETS, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** Run one request against a store inside its own transaction, opening/closing the db each time. */
export async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode)
      const request = run(tx.objectStore(storeName))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}
