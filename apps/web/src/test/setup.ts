import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'

// Node 22.4+ ships built-in Web Storage globals. Without --localstorage-file
// `globalThis.localStorage` is defined but evaluates to `undefined`, and
// vitest's jsdom environment only copies window keys that are *not* already on
// globalThis — so jsdom's real Storage never lands and every call throws. CI
// pins Node 22 (where the global is absent), but newer local Node versions hit
// this, so stand in a plain in-memory Storage when the global is missing.
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
