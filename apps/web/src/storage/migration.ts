/**
 * One-time migration for the OpenAxe rebrand (#311, #326).
 *
 *  - IndexedDB `nam-web-studio` -> `openaxe` : copy every store, verify counts,
 *    then delete old. Guarded by localStorage flag `openaxe:migrated`.
 *  - localStorage `nam-web-studio:*` / `nam-web-studio-*` -> `openaxe:*` :
 *    copy-once bulk migration, delete old after successful write.
 *
 * Non-negotiables from #326:
 *  - Idempotent and safe to interrupt (copy-then-delete, never delete before
 *    verified write).
 *  - Failure is non-fatal: fall back to old DB and log, rather than starting
 *    empty.
 */

const OLD_DB_NAME = 'nam-web-studio'
const NEW_DB_NAME = 'openaxe'
const DB_VERSION = 6
const STORES = ['assets', 'presets', 'library', 'scenes', 'midi', 'presetBank'] as const
const MIGRATION_FLAG = 'openaxe:migrated'

let migrationPromise: Promise<string> | null = null
let effectiveDbName: string = NEW_DB_NAME

function log(...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.warn('[openaxe migration]', ...args)
}

function openDbByName(name: string, version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = version !== undefined ? indexedDB.open(name, version) : indexedDB.open(name)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => {
      // If blocked, resolve with what we have; caller will handle.
    }
  })
}

function deleteDb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
}

async function countStore(db: IDBDatabase, store: string): Promise<number> {
  if (!db.objectStoreNames.contains(store)) return 0
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly')
    const req = tx.objectStore(store).count()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function getAllKeysAndValues(
  db: IDBDatabase,
  store: string,
): Promise<Array<{ key: IDBValidKey; value: unknown }>> {
  if (!db.objectStoreNames.contains(store)) return []
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly')
    const objStore = tx.objectStore(store)
    const req = objStore.openCursor()
    const out: Array<{ key: IDBValidKey; value: unknown }> = []
    req.onsuccess = () => {
      const cursor = req.result as IDBCursorWithValue | null
      if (cursor) {
        out.push({ key: cursor.key, value: cursor.value })
        cursor.continue()
      } else {
        resolve(out)
      }
    }
    req.onerror = () => reject(req.error)
  })
}

async function copyStore(
  oldDb: IDBDatabase,
  newDb: IDBDatabase,
  store: string,
  keyPath: string | null,
): Promise<{ oldCount: number; newCount: number }> {
  const oldCount = await countStore(oldDb, store)
  if (oldCount === 0) return { oldCount: 0, newCount: 0 }

  const records = await getAllKeysAndValues(oldDb, store)
  // Write to new DB
  await new Promise<void>((resolve, reject) => {
    const tx = newDb.transaction(store, 'readwrite')
    const objStore = tx.objectStore(store)
    for (const { key, value } of records) {
      try {
        if (keyPath) {
          objStore.put(value)
        } else {
          objStore.put(value, key)
        }
      } catch (e) {
        // put may throw synchronously for invalid key
        log(`put failed for store ${store} key`, key, e)
      }
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })

  const newCount = await countStore(newDb, store)
  return { oldCount, newCount }
}

function migrateLocalStorage(): void {
  try {
    if (typeof localStorage === 'undefined') return
    // If flag already set, assume done (but still do a quick scan for any
    // leftover old keys that might have been written by an old tab after flag)
    const keys = Object.keys(localStorage)
    let copied = 0
    for (const oldKey of keys) {
      if (!oldKey.startsWith('nam-web-studio')) continue
      const newKey = 'openaxe' + oldKey.slice('nam-web-studio'.length)
      if (localStorage.getItem(newKey) !== null) continue // new already exists, don't overwrite
      const value = localStorage.getItem(oldKey)
      if (value === null) continue
      localStorage.setItem(newKey, value)
      copied++
    }
    if (copied > 0) {
      log(`migrated ${copied} localStorage keys from nam-web-studio* to openaxe*`)
      // Delete old keys only after all new writes succeeded (copy-then-delete)
      for (const oldKey of keys) {
        if (!oldKey.startsWith('nam-web-studio')) continue
        const newKey = 'openaxe' + oldKey.slice('nam-web-studio'.length)
        // Only delete if new key now exists and equals old value (verified write)
        const oldVal = localStorage.getItem(oldKey)
        const newVal = localStorage.getItem(newKey)
        if (oldVal !== null && newVal === oldVal) {
          localStorage.removeItem(oldKey)
        }
      }
    }
  } catch (e) {
    log('localStorage migration failed', e)
  }
}

async function migrateIndexedDB(): Promise<string> {
  // Fast path: flag already set
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(MIGRATION_FLAG) === '1') {
      effectiveDbName = NEW_DB_NAME
      return NEW_DB_NAME
    }
  } catch {
    // ignore
  }

  // Also migrate localStorage keys together (synchronous)
  migrateLocalStorage()

  let oldDb: IDBDatabase | null = null
  let newDb: IDBDatabase | null = null
  try {
    // Check if old DB exists by trying to open it. If it doesn't exist,
    // indexedDB.open will create an empty one with no stores; we can detect
    // that by checking if it has any of our stores or any data.
    oldDb = await openDbByName(OLD_DB_NAME)
    const oldHasStores = STORES.some((s) => oldDb!.objectStoreNames.contains(s))
    if (!oldHasStores) {
      oldDb.close()
      oldDb = null
      // No old DB, nothing to migrate. Mark done.
      try {
        localStorage.setItem(MIGRATION_FLAG, '1')
      } catch {}
      effectiveDbName = NEW_DB_NAME
      return NEW_DB_NAME
    }

    // Check old counts: if all empty, treat as no data to migrate
    let oldTotal = 0
    for (const s of STORES) oldTotal += await countStore(oldDb, s)
    if (oldTotal === 0) {
      oldDb.close()
      oldDb = null
      try {
        localStorage.setItem(MIGRATION_FLAG, '1')
      } catch {}
      // No data, delete empty old DB to tidy up? Leave it, but we can delete.
      try {
        await deleteDb(OLD_DB_NAME)
      } catch {}
      effectiveDbName = NEW_DB_NAME
      return NEW_DB_NAME
    }

    // Open new DB (will create stores if needed via onupgradeneeded from db.ts's openDb,
    // but here we need to ensure it exists. We open with version to ensure stores.
    // However db.ts's openDb creates stores; we can reuse that logic by opening
    // new DB with version and creating missing stores if needed.
    newDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(NEW_DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets')
        if (!db.objectStoreNames.contains('presets'))
          db.createObjectStore('presets', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('library'))
          db.createObjectStore('library', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('scenes'))
          db.createObjectStore('scenes', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('midi')) db.createObjectStore('midi', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('presetBank'))
          db.createObjectStore('presetBank', { keyPath: 'id' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })

    // If new DB already has data, assume migration already done or user has
    // created new data; don't overwrite. We consider migration done if new
    // total >0 and flag not set but new has data.
    let newTotal = 0
    for (const s of STORES) newTotal += await countStore(newDb, s)
    if (newTotal > 0) {
      // New already has data. Don't copy old over it (would overwrite).
      // But if old still has data, we leave old intact and mark migrated
      // to avoid looping. User's new data takes precedence.
      log(`new DB already has ${newTotal} records, skipping copy (old had ${oldTotal})`)
      try {
        localStorage.setItem(MIGRATION_FLAG, '1')
      } catch {}
      oldDb.close()
      newDb.close()
      effectiveDbName = NEW_DB_NAME
      return NEW_DB_NAME
    }

    // Copy each store
    const keyPaths: Record<string, string | null> = {
      assets: null,
      presets: 'id',
      library: 'id',
      scenes: 'id',
      midi: 'id',
      presetBank: 'id',
    }

    let verified = true
    for (const store of STORES) {
      const kp = keyPaths[store] ?? null
      const { oldCount, newCount } = await copyStore(oldDb, newDb, store, kp)
      if (oldCount !== newCount) {
        log(`store ${store} count mismatch after copy: old ${oldCount}, new ${newCount}`)
        verified = false
        break
      }
    }

    if (!verified) {
      log('IndexedDB migration verification failed, aborting delete, falling back to old DB')
      oldDb.close()
      newDb.close()
      effectiveDbName = OLD_DB_NAME
      return OLD_DB_NAME
    }

    // Verify total
    let finalNewTotal = 0
    for (const s of STORES) finalNewTotal += await countStore(newDb, s)
    if (finalNewTotal !== oldTotal) {
      log(`total count mismatch: old ${oldTotal}, new ${finalNewTotal}`)
      oldDb.close()
      newDb.close()
      effectiveDbName = OLD_DB_NAME
      return OLD_DB_NAME
    }

    // Success: close both, delete old, set flag
    oldDb.close()
    newDb.close()
    oldDb = null
    newDb = null
    await deleteDb(OLD_DB_NAME)
    try {
      localStorage.setItem(MIGRATION_FLAG, '1')
    } catch {}
    log(`migrated IndexedDB ${OLD_DB_NAME} -> ${NEW_DB_NAME}: ${oldTotal} records`)
    effectiveDbName = NEW_DB_NAME
    return NEW_DB_NAME
  } catch (e) {
    log('IndexedDB migration failed, falling back to old DB', e)
    try {
      oldDb?.close()
    } catch {}
    try {
      newDb?.close()
    } catch {}
    effectiveDbName = OLD_DB_NAME
    return OLD_DB_NAME
  }
}

export function ensureMigrated(): Promise<string> {
  if (migrationPromise) return migrationPromise
  // localStorage migration is synchronous but we call it inside async flow
  migrationPromise = migrateIndexedDB()
  return migrationPromise
}

export function getEffectiveDbName(): string {
  return effectiveDbName
}

// Also export for testing
export const _private = {
  OLD_DB_NAME,
  NEW_DB_NAME,
  MIGRATION_FLAG,
  STORES,
}
