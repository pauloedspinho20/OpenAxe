// @vitest-environment jsdom
/**
 * The two backends behind every persistent store (issue #300 follow-up).
 *
 * The point of these tests is the split itself. In a native shell the data has
 * to go to the shared on-disk library, or the desktop app and the plugin see
 * different libraries and the factory pack appears to need reinstalling every
 * launch. On the web there is no shell and nothing may change: the browser
 * build must keep using IndexedDB exactly as it always has, and must never
 * reach for a bridge that isn't there.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getOpenAxe } from '../native/openaxe'

import { STORE_PRESETS, STORE_ASSETS } from './db'
import { kvClear, kvDelete, kvGet, kvGetAll, kvGetAllKeys, kvPut } from './kv'

vi.mock('../native/openaxe', () => ({
  getOpenAxe: vi.fn(() => null),
}))

/** A stand-in for the C++ side: one map per store, same semantics. */
function makeFakeBridge() {
  const stores = new Map<string, Map<string, string>>()
  const of = (store: string) => {
    let s = stores.get(store)
    if (!s) {
      s = new Map()
      stores.set(store, s)
    }
    return s
  }
  return {
    stores,
    storageGet: vi.fn(async ({ store, key }: { store: string; key: string }) => ({
      ok: true,
      value: of(store).get(key) ?? null,
    })),
    storagePut: vi.fn(
      async ({ store, key, value }: { store: string; key: string; value: string }) => {
        of(store).set(key, value)
        return { ok: true }
      },
    ),
    storageDelete: vi.fn(async ({ store, key }: { store: string; key: string }) => {
      of(store).delete(key)
      return { ok: true }
    }),
    storageKeys: vi.fn(async ({ store }: { store: string }) => ({
      ok: true,
      keys: [...of(store).keys()],
    })),
    storageValues: vi.fn(async ({ store }: { store: string }) => ({
      ok: true,
      values: [...of(store).values()],
    })),
    storageClear: vi.fn(async ({ store }: { store: string }) => {
      of(store).clear()
      return { ok: true }
    }),
  }
}

describe('kv storage', () => {
  beforeEach(() => {
    vi.mocked(getOpenAxe).mockReturnValue(null)
  })

  afterEach(async () => {
    vi.mocked(getOpenAxe).mockReturnValue(null)
    await kvClear(STORE_PRESETS)
    await kvClear(STORE_ASSETS)
  })

  describe('the web build, which must keep working exactly as before', () => {
    it('round-trips through IndexedDB', async () => {
      await kvPut(STORE_PRESETS, { id: 'p1', name: 'Crunch' })
      expect(await kvGet(STORE_PRESETS, 'p1')).toEqual({ id: 'p1', name: 'Crunch' })

      await kvPut(STORE_PRESETS, { id: 'p2', name: 'Clean' })
      expect(await kvGetAllKeys(STORE_PRESETS)).toEqual(expect.arrayContaining(['p1', 'p2']))
      expect(await kvGetAll(STORE_PRESETS)).toHaveLength(2)

      await kvDelete(STORE_PRESETS, 'p1')
      expect(await kvGet(STORE_PRESETS, 'p1')).toBeUndefined()

      await kvClear(STORE_PRESETS)
      expect(await kvGetAll(STORE_PRESETS)).toHaveLength(0)
    })

    it('stores out-of-line values under the key it is given', async () => {
      // The assets store has no keyPath, so the key travels separately.
      // Passing one to a keyPath store instead makes IndexedDB throw, which
      // is the mistake this branch exists to avoid.
      await kvPut(STORE_ASSETS, new Blob(['bytes']), 'asset-1')
      expect(await kvGetAllKeys(STORE_ASSETS)).toEqual(['asset-1'])
    })

    it('really writes to IndexedDB, not just to something kv can read back', async () => {
      await kvPut(STORE_PRESETS, { id: 'p3', name: 'Lead' })

      // Read it straight out of IndexedDB, bypassing kv entirely — otherwise
      // this suite would pass just as happily against an in-memory map, and
      // the browser build would quietly stop persisting anything.
      const raw = await new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open('openaxe')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const request = db
            .transaction(STORE_PRESETS, 'readonly')
            .objectStore(STORE_PRESETS)
            .get('p3')
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            resolve(request.result)
            db.close()
          }
        }
      })
      expect(raw).toEqual({ id: 'p3', name: 'Lead' })
    })
  })

  describe('the desktop shell and the plugins, which share one library', () => {
    it('round-trips through the bridge instead of IndexedDB', async () => {
      const bridge = makeFakeBridge()
      vi.mocked(getOpenAxe).mockReturnValue(bridge as never)

      await kvPut(STORE_PRESETS, { id: 'p1', name: 'Crunch' })
      expect(bridge.storagePut).toHaveBeenCalledWith({
        store: 'presets',
        key: 'p1',
        value: JSON.stringify({ id: 'p1', name: 'Crunch' }),
      })
      expect(await kvGet(STORE_PRESETS, 'p1')).toEqual({ id: 'p1', name: 'Crunch' })

      await kvDelete(STORE_PRESETS, 'p1')
      expect(await kvGet(STORE_PRESETS, 'p1')).toBeUndefined()
    })

    it('writes nothing to IndexedDB, so the two backends cannot drift', async () => {
      const bridge = makeFakeBridge()
      vi.mocked(getOpenAxe).mockReturnValue(bridge as never)
      await kvPut(STORE_PRESETS, { id: 'native-only', name: 'X' })

      // Same read, but back on the web path: IndexedDB must not have it.
      vi.mocked(getOpenAxe).mockReturnValue(null)
      expect(await kvGet(STORE_PRESETS, 'native-only')).toBeUndefined()
    })

    it('renames presetBank, whose camelCase the native store cannot hold', async () => {
      // Store names become directory names, and an uppercase letter folds into
      // its lowercase twin on a case-insensitive filesystem — so the native
      // side rejects them outright rather than silently merging two stores.
      const bridge = makeFakeBridge()
      vi.mocked(getOpenAxe).mockReturnValue(bridge as never)

      await kvPut('presetBank', { id: 'default', slots: [] })
      expect(bridge.storagePut).toHaveBeenCalledWith(
        expect.objectContaining({ store: 'preset-bank' }),
      )
    })

    it('drops only the unreadable record when one is corrupt', async () => {
      const bridge = makeFakeBridge()
      vi.mocked(getOpenAxe).mockReturnValue(bridge as never)
      bridge.storageValues.mockResolvedValueOnce({
        ok: true,
        values: ['{"id":"good"}', 'not json at all', '{"id":"also-good"}'],
      })
      // A preset written by a newer build, or a file truncated by a crash,
      // costs that row and not the whole list.
      expect(await kvGetAll(STORE_PRESETS)).toEqual([{ id: 'good' }, { id: 'also-good' }])
    })
  })
})
