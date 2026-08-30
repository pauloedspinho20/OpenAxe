/**
 * Single shared IndexedDB database for everything the app persists locally
 * (asset blobs, presets). Centralized here so adding a store bumps one
 * version number in one place - two modules independently calling
 * `indexedDB.open` with different versions for the same database name is a
 * recipe for version-conflict errors.
 */

// Deliberately still 'nam-web-studio' after the OpenAxe rebrand (issue #151):
// this is the on-disk IndexedDB name users' saved rigs live under. Renaming
// it without a migration would orphan every preset/scene/asset, so the old
// name stays. If it is ever renamed, copy old DB -> new in a one-time
// migration first.
const DB_NAME = 'nam-web-studio'
/**
 * v4: the preset schema changed from a fixed dual-chain shape (chainA/
 * chainB) to a generic block/edge graph (see presets/types.ts) - old rows
 * would just fail the new validation, so the presets store is wiped on
 * upgrade rather than leaving unreadable rows sitting in it.
 * v5: adds the scenes and midi stores; presets are untouched.
 * v6: adds the presetBank store (a single 512-slot row); all existing stores
 *     are untouched.
 */
const DB_VERSION = 6

/** Blob store: downloaded .nam/IR files, keyed by an explicit id (see assetCache.ts). */
export const STORE_ASSETS = 'assets'
/** Preset store: keyPath 'id', so put() uses each preset's own id as the key (see presetStore.ts). */
export const STORE_PRESETS = 'presets'
/** Tone3000 library metadata (what's been imported, who made it) - see src/tone3000/library.ts. */
export const STORE_LIBRARY = 'library'
/** Scene bank: keyPath 'id', a single row keyed 'default' (see scenes/sceneBankStore.ts). */
export const STORE_SCENES = 'scenes'
/** MIDI mapping config: keyPath 'id', a single row keyed 'midi-config' (see midi/midiConfigStore.ts). */
export const STORE_MIDI = 'midi'
/** Preset bank: keyPath 'id', a single 512-slot row keyed 'default' (see presets/presetBankStore.ts). */
export const STORE_PRESET_BANK = 'presetBank'

/**
 * Which stores declare a keyPath, and what it is. `null` means an out-of-line
 * store whose key is passed separately (assets, keyed by asset id).
 *
 * storage/kv.ts needs this: the native backend has no notion of a keyPath, so
 * it must be told the key for every record, and IndexedDB throws if a key is
 * passed for a store that has one.
 */
export const STORE_KEY_PATHS: Record<string, string | null> = {
  [STORE_ASSETS]: null,
  [STORE_PRESETS]: 'id',
  [STORE_LIBRARY]: 'id',
  [STORE_SCENES]: 'id',
  [STORE_MIDI]: 'id',
  [STORE_PRESET_BANK]: 'id',
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = (event) => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_ASSETS)) {
        db.createObjectStore(STORE_ASSETS)
      }
      if (!db.objectStoreNames.contains(STORE_PRESETS)) {
        db.createObjectStore(STORE_PRESETS, { keyPath: 'id' })
      } else if (event.oldVersion < 4) {
        request.transaction?.objectStore(STORE_PRESETS).clear()
      }
      if (!db.objectStoreNames.contains(STORE_LIBRARY)) {
        db.createObjectStore(STORE_LIBRARY, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_SCENES)) {
        db.createObjectStore(STORE_SCENES, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_MIDI)) {
        db.createObjectStore(STORE_MIDI, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_PRESET_BANK)) {
        db.createObjectStore(STORE_PRESET_BANK, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** Remove all entries from an object store. */
export async function clearStore(storeName: string): Promise<void> {
  await withStore<undefined>(
    storeName,
    'readwrite',
    (store) => store.clear() as IDBRequest<undefined>,
  )
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
