/**
 * The one key/value API every persistent store in the app goes through, with
 * two backends behind it (issue #300 follow-up).
 *
 * On the web that backend is IndexedDB, exactly as before. In the desktop
 * shell and inside a plugin it is a directory on disk, reached over the
 * openAxe.storage* bridge, because the webview's own storage cannot do the
 * job there:
 *
 *   - The UI server binds an ephemeral port, so the webview's origin
 *     (http://127.0.0.1:<port>) is different every launch, and IndexedDB and
 *     localStorage are both scoped to an origin. That is why the factory pack
 *     appeared to need reinstalling on every start: the data was never lost,
 *     just stranded under an origin nothing would visit again.
 *   - WKWebView and WebView2 also scope website data to the host application.
 *     The desktop app's lives under com.openaxe.desktop and a plugin's under
 *     the DAW's own container, a different one per DAW. So even a fixed port
 *     could not give the desktop app and the plugin one shared library.
 *
 * Values are structured data here and JSON on the wire. Blobs do not come
 * through this module at all - see engine/assetCache.ts, which has its own
 * pair of paths for the same reason.
 */
import { getOpenAxe } from '../native/openaxe'

import { STORE_KEY_PATHS, withStore, clearStore } from './db'

/**
 * IndexedDB store name -> native store name. The native side restricts store
 * names to [a-z0-9_-], because an uppercase letter would fold into a
 * lowercase one on a case-insensitive filesystem and silently merge two
 * stores; 'presetBank' is the only name that needed changing.
 */
const NATIVE_STORE: Record<string, string> = {
  presetBank: 'preset-bank',
}

function nativeStore(store: string): string {
  return NATIVE_STORE[store] ?? store
}

/**
 * The key for a record, given the value. Most stores declare a keyPath, so
 * the key lives inside the value and IndexedDB extracts it; the native side
 * has no such notion and needs it passed explicitly.
 */
export function keyForValue(store: string, value: unknown): string {
  const keyPath = STORE_KEY_PATHS[store]
  if (!keyPath) {
    throw new Error(`kv: store '${store}' has no keyPath, pass the key explicitly`)
  }
  const key = (value as Record<string, unknown>)[keyPath]
  if (typeof key !== 'string') {
    throw new Error(`kv: value for store '${store}' has no string '${keyPath}'`)
  }
  return key
}

export async function kvGet<T>(store: string, key: string): Promise<T | undefined> {
  const native = getOpenAxe()
  if (native) {
    const result = await native.storageGet({ store: nativeStore(store), key })
    if (result.value === null || result.value === undefined) return undefined
    return JSON.parse(result.value) as T
  }
  return withStore<T | undefined>(store, 'readonly', (s) => s.get(key))
}

export async function kvPut(store: string, value: unknown, explicitKey?: string): Promise<void> {
  const key = explicitKey ?? keyForValue(store, value)
  const native = getOpenAxe()
  if (native) {
    await native.storagePut({ store: nativeStore(store), key, value: JSON.stringify(value) })
    return
  }
  // Out-of-line stores take the key as a second argument; keyPath stores must
  // not be given one at all, or IndexedDB throws.
  await withStore<IDBValidKey>(store, 'readwrite', (s) =>
    STORE_KEY_PATHS[store] ? s.put(value) : s.put(value, key),
  )
}

export async function kvDelete(store: string, key: string): Promise<void> {
  const native = getOpenAxe()
  if (native) {
    await native.storageDelete({ store: nativeStore(store), key })
    return
  }
  await withStore<undefined>(store, 'readwrite', (s) => s.delete(key))
}

export async function kvGetAll<T>(store: string): Promise<T[]> {
  const native = getOpenAxe()
  if (native) {
    const result = await native.storageValues({ store: nativeStore(store) })
    const out: T[] = []
    for (const raw of result.values) {
      // One unreadable record must not take out the whole list - a preset
      // written by a newer build, or a file truncated by a crash, should cost
      // that row and nothing else.
      try {
        out.push(JSON.parse(raw) as T)
      } catch {
        // ignore
      }
    }
    return out
  }
  return withStore<T[]>(store, 'readonly', (s) => s.getAll())
}

export async function kvGetAllKeys(store: string): Promise<string[]> {
  const native = getOpenAxe()
  if (native) {
    const result = await native.storageKeys({ store: nativeStore(store) })
    return result.keys
  }
  const keys = await withStore<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys())
  return keys.map(String)
}

export async function kvClear(store: string): Promise<void> {
  const native = getOpenAxe()
  if (native) {
    await native.storageClear({ store: nativeStore(store) })
    return
  }
  await clearStore(store)
}
