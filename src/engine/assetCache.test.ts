// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteCachedAsset, fetchWithCache, getCachedAsset, putCachedAsset } from './assetCache'

describe('assetCache', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns null for a key that was never cached', async () => {
    expect(await getCachedAsset('missing')).toBeNull()
  })

  it('round-trips a stored blob', async () => {
    const blob = new Blob(['hello'], { type: 'text/plain' })
    await putCachedAsset('greeting', blob)

    const cached = await getCachedAsset('greeting')
    expect(cached).not.toBeNull()
    expect(await cached?.text()).toBe('hello')
  })

  it('overwrites an existing entry on put', async () => {
    await putCachedAsset('key', new Blob(['first']))
    await putCachedAsset('key', new Blob(['second']))

    const cached = await getCachedAsset('key')
    expect(await cached?.text()).toBe('second')
  })

  it('removes an entry on delete', async () => {
    await putCachedAsset('to-delete', new Blob(['x']))
    await deleteCachedAsset('to-delete')

    expect(await getCachedAsset('to-delete')).toBeNull()
  })

  it('fetchWithCache returns the cached blob without hitting the network', async () => {
    await putCachedAsset('cached-model', new Blob(['cached bytes']))
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const blob = await fetchWithCache('cached-model', 'https://example.com/model.nam')

    expect(await blob.text()).toBe('cached bytes')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fetchWithCache fetches and caches on a miss', async () => {
    const responseBlob = new Blob(['fresh bytes'])
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(responseBlob),
      }),
    )

    const blob = await fetchWithCache('new-model', 'https://example.com/model.nam')
    expect(await blob.text()).toBe('fresh bytes')

    const cached = await getCachedAsset('new-model')
    expect(await cached?.text()).toBe('fresh bytes')
  })

  it('fetchWithCache throws on a failed response and does not cache it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))

    await expect(fetchWithCache('bad-model', 'https://example.com/missing.nam')).rejects.toThrow(
      /404/,
    )
    expect(await getCachedAsset('bad-model')).toBeNull()
  })
})
