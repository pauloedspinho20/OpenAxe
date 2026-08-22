// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Tone3000Library, useTone3000Library } from './library'
import { clearStore, STORE_LIBRARY } from '../storage/db'
import { clearTokens, setTokens } from './client'
import { getCachedAsset } from '../engine/assetCache'
import { importTone3000Asset } from './importService'
import type { BlockLoadTarget } from './importService'

const MODEL_BLOB = new Blob([JSON.stringify({ model: { config: 1 } })], {
  type: 'application/json',
})
const IR_BLOB = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/wav' })

function stubFetch(blob: Blob) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) }))
}

function makeRequest(overrides: Partial<Parameters<typeof importTone3000Asset>[0]> = {}) {
  return {
    id: 'tone3000:model:42',
    blockId: 'block-1',
    slot: 'model' as const,
    name: 'Deluxe Reverb',
    modelUrl: 'https://www.tone3000.com/models/42/download',
    creator: 'pauloedspinho20',
    sourceUrl: 'https://www.tone3000.com/tones/42',
    toneTitle: 'Fender Deluxe',
    ...overrides,
  }
}

describe('importTone3000Asset', () => {
  beforeEach(() => {
    setTokens({ access_token: 'a', refresh_token: 'r', expires_at: Date.now() + 120_000 })
    useTone3000Library.setState({ entries: [] })
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    clearTokens()
    await clearStore(STORE_LIBRARY)
  })

  it('downloads + caches the asset and records it in the library', async () => {
    stubFetch(MODEL_BLOB)
    const result = await importTone3000Asset(makeRequest(), null, null)

    expect(result).toEqual({
      id: 'tone3000:model:42',
      name: 'Deluxe Reverb',
      slot: 'model',
      blockId: 'block-1',
    })
    expect(await getCachedAsset('tone3000:model:42')).not.toBeNull()
    expect(useTone3000Library.getState().entries).toHaveLength(1)
  })

  it('loads into a live block when a load target + context are provided (model slot)', async () => {
    stubFetch(MODEL_BLOB)
    const load = {
      loadModel: vi.fn().mockResolvedValue(undefined),
      loadIR: vi.fn(),
    } satisfies BlockLoadTarget
    const context = { decodeAudioData: vi.fn() } as unknown as AudioContext

    await importTone3000Asset(makeRequest(), load, context)

    expect(load.loadModel).toHaveBeenCalledOnce()
    expect(load.loadIR).not.toHaveBeenCalled()
    const [json, info] = load.loadModel.mock.calls[0]!
    expect(JSON.parse(json)).toEqual({ model: { config: 1 } })
    expect(info).toEqual({ id: 'tone3000:model:42', name: 'Deluxe Reverb' })
  })

  it('loads into a live block via loadIR for the ir slot', async () => {
    stubFetch(IR_BLOB)
    const load = {
      loadModel: vi.fn(),
      loadIR: vi.fn(),
    } satisfies BlockLoadTarget
    const decoded = {} as AudioBuffer
    const context = {
      decodeAudioData: vi.fn().mockResolvedValue(decoded),
    } as unknown as AudioContext

    await importTone3000Asset(
      makeRequest({ id: 'tone3000:ir:9', slot: 'ir', name: 'V30 cab' }),
      load,
      context,
    )

    expect(context.decodeAudioData).toHaveBeenCalledOnce()
    expect(load.loadIR).toHaveBeenCalledOnce()
    expect(load.loadIR.mock.calls[0]![0]).toBe(decoded)
    expect(load.loadIR.mock.calls[0]![1]).toEqual({ id: 'tone3000:ir:9', name: 'V30 cab' })
  })

  it('does not load into a live block when no context is given', async () => {
    stubFetch(MODEL_BLOB)
    const load = { loadModel: vi.fn(), loadIR: vi.fn() } satisfies BlockLoadTarget
    await importTone3000Asset(makeRequest(), load, null)
    expect(load.loadModel).not.toHaveBeenCalled()
  })

  it('throws if the cached asset is missing when a load is requested', async () => {
    stubFetch(MODEL_BLOB)
    const load = { loadModel: vi.fn(), loadIR: vi.fn() } satisfies BlockLoadTarget
    const context = { decodeAudioData: vi.fn() } as unknown as AudioContext
    // importAsset still succeeds + caches, but getBlob reports a miss at load time.
    vi.spyOn(Tone3000Library, 'getBlob').mockResolvedValue(null)
    await expect(importTone3000Asset(makeRequest(), load, context)).rejects.toThrow(
      /was not cached/,
    )
    expect(load.loadModel).not.toHaveBeenCalled()
  })
})
