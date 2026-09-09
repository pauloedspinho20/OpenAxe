import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'

// Node 22.4+ ships built-in Web Storage globals. Without --localstorage-file
// `globalThis.localStorage` is a lazy accessor that evaluates to `undefined`
// (newer Node even warns on access), and vitest's jsdom environment only
// copies window keys that are *not* already on globalThis — so jsdom's real
// Storage never lands on the global and every read sees `undefined`. CI pins
// Node 22 (where the global is absent), but newer local Node versions hit
// this, so stand in a plain in-memory Storage when the global is missing.
// (The stand-in is deliberately a last resort, not a substitute: it isn't a
// real Storage, so consumers must not assume the global `Storage` binding is
// its prototype — see prefsMirror's write-mirror, which targets the object's
// own prototype for exactly this reason.)
class MemoryStorage implements Storage {
  #items = new Map<string, string>()

  get length() {
    return this.#items.size
  }

  key(index: number) {
    return [...this.#items.keys()][index] ?? null
  }

  getItem(key: string) {
    return this.#items.get(String(key)) ?? null
  }

  setItem(key: string, value: string) {
    this.#items.set(String(key), String(value))
  }

  removeItem(key: string) {
    this.#items.delete(String(key))
  }

  clear() {
    this.#items.clear()
  }

  [key: string]: unknown
}

for (const key of ['localStorage', 'sessionStorage'] as const) {
  if (globalThis[key] === undefined) {
    Object.defineProperty(globalThis, key, {
      value: new MemoryStorage(),
      configurable: true,
      writable: true,
    })
  }
}
