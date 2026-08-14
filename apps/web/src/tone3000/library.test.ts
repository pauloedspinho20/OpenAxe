// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Tone3000Library, useTone3000Library } from './library'
import { clearStore, STORE_LIBRARY } from '../storage/db'
import { clearTokens, setTokens } from './client'
import { getCachedAsset } from '../engine/assetCache'

function makeStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size
    },
  }
}

describe('tone3000 library', () => {
  const downloadBlob = new Blob([JSON.stringify({ model: { config: 1 } })], { type: 'text/plain' })

  beforeEach(async () => {
    // node env has no web storage — provide in-memory shims. Do NOT unstub
    // here (afterEach handles teardown) so the stubs survive into each test.
    vi.stubGlobal('sessionStorage', makeStorage())
    vi.stubGlobal('localStorage', makeStorage())
    clearTokens()
    useTone3000Library.setState({ entries: [] })
    await clearStore(STORE_LIBRARY)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is empty before anything is imported', async () => {
    await expect(Tone3000Library.list()).resolves.toEqual([])
  })

  it('importAsset downloads, caches a blob, records attribution, and refreshes the store', async () => {
    setTokens({ access_token: 'a', refresh_token: 'r', expires_at: Date.now() + 120_000 })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(downloadBlob) }),
    )

    const entry = await Tone3000Library.importAsset({
      id: 'tone3000:model:42',
      kind: 'model',
      name: 'Deluxe Reverb',
      creator: 'pauloedspinho20',
      sourceUrl: 'https://www.tone3000.com/tones/7',
      toneTitle: 'Fender Deluxe',
      modelUrl: 'https://www.tone3000.com/models/42/download',
    })

    expect(entry.id).toBe('tone3000:model:42')
    expect(entry.creator).toBe('pauloedspinho20')

    const cached = await getCachedAsset('tone3000:model:42')
    expect(cached).not.toBeNull()
    expect(JSON.parse((await cached!.text()).toString())).toEqual({ model: { config: 1 } })

    expect(useTone3000Library.getState().entries).toHaveLength(1)

    const list = await Tone3000Library.list()
    expect(list[0]!.name).toBe('Deluxe Reverb')
    expect(list[0]!.sourceUrl).toContain('tone3000.com')
  })

  it('has() reports an id once its blob is cached', async () => {
    setTokens({ access_token: 'a', refresh_token: 'r', expires_at: Date.now() + 120_000 })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(downloadBlob) }),
    )

    expect(await Tone3000Library.has('tone3000:ir:9')).toBe(false)
    await Tone3000Library.importAsset({
      id: 'tone3000:ir:9',
      kind: 'ir',
      name: 'V30 cab',
      creator: 'cabguy',
      sourceUrl: 'https://www.tone3000.com/tones/9',
      toneTitle: null,
      modelUrl: 'https://www.tone3000.com/models/9/download',
    })
    expect(await Tone3000Library.has('tone3000:ir:9')).toBe(true)
  })

  it('remove deletes the library entry but keeps the cached blob (asset cache is separate)', async () => {
    setTokens({ access_token: 'a', refresh_token: 'r', expires_at: Date.now() + 120_000 })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(downloadBlob) }),
    )

    await Tone3000Library.importAsset({
      id: 'tone3000:model:100',
      kind: 'model',
      name: 'M',
      creator: 'c',
      sourceUrl: 'https://www.tone3000.com/tones/100',
      toneTitle: null,
      modelUrl: 'https://www.tone3000.com/models/100/download',
    })
    await Tone3000Library.remove('tone3000:model:100')

    expect(await Tone3000Library.list()).toEqual([])
    expect(await getCachedAsset('tone3000:model:100')).not.toBeNull()
  })
})
