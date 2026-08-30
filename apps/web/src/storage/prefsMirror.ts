/**
 * Makes localStorage durable and shared in the native shells (issue #300
 * follow-up), without asking every caller to become async.
 *
 * The small preferences - theme, onboarding dismissal, the factory-setup
 * flag, the zustand-persisted IO and settings stores - are all read
 * synchronously, at module load or during the first render. Turning those
 * into bridge round-trips would mean an async rewrite of half a dozen hooks
 * for data measured in bytes.
 *
 * So localStorage stays the synchronous source of truth, and this module
 * makes it survive a restart:
 *
 *   - at boot, every pref in the shared on-disk store is copied *into*
 *     localStorage, before React mounts and before anything reads one;
 *   - from then on, every write to localStorage is mirrored back out to the
 *     shared store.
 *
 * The result is that the desktop app and a plugin instance start from the
 * same preferences, and neither loses them when the UI server binds a
 * different ephemeral port next launch.
 *
 * On the web this module does nothing at all: `getOpenAxe()` is null, no
 * patch is installed, and localStorage behaves exactly as it always has.
 */
import { getOpenAxe } from '../native/openaxe'

/** The native store holding mirrored preferences. */
export const PREFS_STORE = 'prefs'

/**
 * Never mirrored. The Tone3000 refresh token is a live credential and belongs
 * in the OS keychain (see tone3000/client.ts, which already routes it there in
 * a native shell) - copying it into a plain file under the data directory
 * would undo that. It is listed anyway so that a future change routing it
 * back through localStorage cannot silently leak it.
 */
const NEVER_MIRROR = new Set(['t3k_refresh_token'])

/**
 * Nothing may block the app from mounting on a bridge call, because a bridge
 * call is not guaranteed to be answered. iPlug2's EvaluateJavaScript is a
 * silent no-op while the webview is still loading, so a response sent in that
 * window is dropped and its promise never settles — which is exactly what
 * happened here, and left the editor a blank window in every plugin format
 * until the plugin learned to queue those responses instead.
 *
 * The plugin side is fixed, but the shape of the risk stays: this module runs
 * before the first render specifically so preferences are readable
 * synchronously, and that makes it the one place where a hung bridge costs
 * the whole UI. So it gives up rather than hanging, and the app starts with
 * default preferences instead of not starting.
 */
const HYDRATE_TIMEOUT_MS = 3000

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error('prefs hydration timed out')), HYDRATE_TIMEOUT_MS),
    ),
  ])
}

let installed = false

/**
 * The pristine Storage methods, captured before the first patch. Kept so the
 * patch can be undone exactly - re-patching an already-patched prototype
 * would nest the wrappers and mirror each write once per install.
 */
let originals: {
  setItem: Storage['setItem']
  removeItem: Storage['removeItem']
  clear: Storage['clear']
} | null = null

/** Test-only: undo the patch and forget it was installed. */
export function __resetPrefsMirrorForTests(): void {
  if (originals) {
    Storage.prototype.setItem = originals.setItem
    Storage.prototype.removeItem = originals.removeItem
    Storage.prototype.clear = originals.clear
    originals = null
  }
  installed = false
}

/**
 * Copies the shared store's preferences into localStorage and starts
 * mirroring writes back. Safe to call more than once; resolves immediately on
 * the web.
 */
export async function installPrefsMirror(): Promise<void> {
  const native = getOpenAxe()
  if (!native || installed) return
  installed = true

  // 1. Hydrate. Keys and values come back in matching order.
  try {
    const [keysResult, valuesResult] = await withTimeout(
      Promise.all([
        native.storageKeys({ store: PREFS_STORE }),
        native.storageValues({ store: PREFS_STORE }),
      ]),
    )
    // Keys() and Values() walk the same directory but are two separate
    // listings, so pair them by key and re-read anything that does not line
    // up rather than trusting the order.
    if (keysResult.keys.length === valuesResult.values.length) {
      keysResult.keys.forEach((key, index) => {
        const value = valuesResult.values[index]
        if (value !== undefined && !NEVER_MIRROR.has(key)) localStorage.setItem(key, value)
      })
    } else {
      for (const key of keysResult.keys) {
        if (NEVER_MIRROR.has(key)) continue
        const result = await native.storageGet({ store: PREFS_STORE, key })
        if (result.value !== null) localStorage.setItem(key, result.value)
      }
    }
  } catch {
    // A shell too old to have the storage bridge still runs, just without
    // preferences that outlive the session.
  }

  // 2. Mirror writes. Patching the prototype rather than replacing
  //    window.localStorage keeps every existing call site working untouched;
  //    the `this` check keeps sessionStorage out of it.
  const proto = Storage.prototype
  originals = {
    setItem: proto.setItem,
    removeItem: proto.removeItem,
    clear: proto.clear,
  }
  const {
    setItem: originalSetItem,
    removeItem: originalRemoveItem,
    clear: originalClear,
  } = originals

  proto.setItem = function setItem(key: string, value: string) {
    originalSetItem.call(this, key, value)
    if (this !== window.localStorage || NEVER_MIRROR.has(key)) return
    // Fire and forget: a pref is not worth blocking a render on, and the
    // local copy is already updated either way.
    void native.storagePut({ store: PREFS_STORE, key, value }).catch(() => {})
  }

  proto.removeItem = function removeItem(key: string) {
    originalRemoveItem.call(this, key)
    if (this !== window.localStorage) return
    void native.storageDelete({ store: PREFS_STORE, key }).catch(() => {})
  }

  proto.clear = function clear() {
    originalClear.call(this)
    if (this !== window.localStorage) return
    void native.storageClear({ store: PREFS_STORE }).catch(() => {})
  }
}
