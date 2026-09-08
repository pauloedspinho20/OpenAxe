// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getCachedAssetMock } = vi.hoisted(() => ({ getCachedAssetMock: vi.fn() }))
vi.mock('./assetCache', () => ({ getCachedAsset: getCachedAssetMock }))

const {
  cacheModelText,
  clearPreloadedModels,
  getPreloadedModelText,
  MODEL_PRELOAD_BUDGET_BYTES,
  preloadedBytes,
  preloadModelTexts,
  preloadPresets,
} = await import('./modelPreloader')

function textBlob(text: string): Blob {
  return { text: async () => text } as Blob
}

describe('modelPreloader', () => {
  beforeEach(() => {
    getCachedAssetMock.mockReset()
    clearPreloadedModels()
  })

  it('misses before anything is preloaded', () => {
    expect(getPreloadedModelText('nope')).toBeNull()
  })

  it('loads missing ids from the asset cache and serves them resident after', async () => {
    getCachedAssetMock.mockResolvedValue(textBlob('{"model":"a"}'))

    const result = await preloadModelTexts(['a'])

    expect(result).toEqual({ loaded: ['a'], missing: [] })
    expect(getPreloadedModelText('a')).toBe('{"model":"a"}')
    expect(preloadedBytes()).toBeGreaterThan(0)

    // Second call is served resident - no second cache read.
    getCachedAssetMock.mockClear()
    const again = await preloadModelTexts(['a'])
    expect(again).toEqual({ loaded: ['a'], missing: [] })
    expect(getCachedAssetMock).not.toHaveBeenCalled()
  })

  it('reports uncached ids as missing instead of throwing', async () => {
    getCachedAssetMock.mockResolvedValue(null)

    const result = await preloadModelTexts(['ghost', 'ghost2'])

    expect(result.loaded).toEqual([])
    expect(result.missing).toEqual(expect.arrayContaining(['ghost', 'ghost2']))
  })

  it('shares one in-flight read between concurrent callers', async () => {
    let resolveText!: (text: string) => void
    getCachedAssetMock.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveText = resolve
      }).then((text) => textBlob(text)),
    )

    const first = preloadModelTexts(['shared'])
    const second = preloadModelTexts(['shared'])
    resolveText('{"shared":true}')
    await Promise.all([first, second])

    expect(getCachedAssetMock).toHaveBeenCalledTimes(1)
    expect(getPreloadedModelText('shared')).toBe('{"shared":true}')
  })

  it('evicts least-recently-used entries past the budget', async () => {
    const big = 'x'.repeat(40 * 1024 * 1024)
    cacheModelText('old', big)
    cacheModelText('new', big)

    // 80 MB resident against a 64 MB budget: the oldest entry goes.
    expect(MODEL_PRELOAD_BUDGET_BYTES).toBe(64 * 1024 * 1024)
    expect(getPreloadedModelText('old')).toBeNull()
    expect(getPreloadedModelText('new')).toBe(big)
    expect(preloadedBytes()).toBeLessThanOrEqual(MODEL_PRELOAD_BUDGET_BYTES)
  })

  it('collects model ids across presets, skipping blocks without one', async () => {
    getCachedAssetMock.mockImplementation(async (id: string) => textBlob(`{"id":"${id}"}`))

    await preloadPresets([
      {
        id: 'p1',
        name: 'one',
        tags: [],
        favorite: false,
        createdAt: 0,
        updatedAt: 0,
        blocks: [
          { id: 'amp', kind: 'amp', row: 0, col: 0, params: {}, modelId: 'm1' },
          { id: 'eq', kind: 'eq', row: 0, col: 1, params: {} },
        ],
        edges: [],
        masterLevel: 1,
        masterMuted: false,
      },
      null,
      undefined,
    ])

    expect(getPreloadedModelText('m1')).toBe('{"id":"m1"}')
    expect(getCachedAssetMock).toHaveBeenCalledTimes(1)
  })
})
