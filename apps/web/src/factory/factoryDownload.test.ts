// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getPreset, deletePreset, listPresets } from '../presets/presetStore'
import { loadPresetBank } from '../presets/presetBankStore'
import { loadSceneBank } from '../scenes/sceneBankStore'
import { clearStore, STORE_SCENES, STORE_PRESET_BANK, STORE_LIBRARY } from '../storage/db'
import type { Tone, Tone3000Model } from '../tone3000/types'
import { downloadFactoryPack } from './factoryDownload'
import type { FactoryPack } from './factoryPack'

const { apiGetToneMock, apiListModelsMock, hasMock, importAssetMock } = vi.hoisted(() => ({
  apiGetToneMock: vi.fn(),
  apiListModelsMock: vi.fn(),
  hasMock: vi.fn(async () => false),
  importAssetMock: vi.fn(async () => ({ id: 'x' })),
}))
vi.mock('../tone3000/client', () => ({
  apiGetTone: apiGetToneMock,
  apiListModels: apiListModelsMock,
}))
vi.mock('../tone3000/library', () => ({
  Tone3000Library: { has: hasMock, importAsset: importAssetMock },
}))

function tone(id: number): Tone {
  return {
    id,
    user_id: 'u',
    user: { id: 'u', username: 'creator', avatar_url: null, url: '' },
    created_at: '2026-01-01',
    title: 'Deluxe',
    description: null,
    gear: 'amp',
    images: null,
    is_public: true,
    links: null,
    format: 'nam',
    license: 'T3K',
    sizes: ['small', 'large'],
    makes: [],
    tags: [],
    models_count: 1,
    downloads_count: 1,
    favorites_count: 0,
    url: 'https://www.tone3000.com/tones/1',
  }
}

function model(id: number): Tone3000Model {
  return {
    id,
    created_at: '',
    updated_at: '',
    user_id: 'u',
    model_url: 'https://www.tone3000.com/models/1/download',
    name: 'Deluxe (small)',
    size: 'small',
    architecture_version: '2',
    tone_id: 1,
  }
}

const pack: FactoryPack = {
  models: [{ toneId: 1, slot: 'model', name: 'Deluxe' }],
  presets: [
    {
      id: 'factory-deluxe',
      name: 'Deluxe Lead',
      bankSlot: 0,
      blocks: [{ modelRef: 0, kind: 'amp' }],
    },
  ],
  scene0Slots: [0, 1, 2, 3, 4, 5, 6, 7],
}

beforeEach(async () => {
  for (const preset of await listPresets()) await deletePreset(preset.id)
  await clearStore(STORE_SCENES)
  await clearStore(STORE_PRESET_BANK)
  await clearStore(STORE_LIBRARY)
  apiGetToneMock.mockReset()
  apiListModelsMock.mockReset()
  hasMock.mockReset()
  hasMock.mockResolvedValue(false)
  importAssetMock.mockClear()
})

describe('downloadFactoryPack', () => {
  it('downloads the model, caches it, and places the pack preset', async () => {
    apiGetToneMock.mockResolvedValue(tone(1))
    apiListModelsMock.mockResolvedValue({
      data: [model(1)],
      page: 1,
      page_size: 50,
      total: 1,
      total_pages: 1,
    })

    const summary = await downloadFactoryPack(undefined, pack)

    expect(summary.downloaded).toBe(1)
    expect(summary.skipped).toBe(0)
    expect(summary.failed).toEqual([])
    expect(summary.placedPresets).toBe(1)
    expect(hasMock).toHaveBeenCalledWith('tone3000:model:1')
    expect(importAssetMock).toHaveBeenCalledTimes(1)

    const preset = await getPreset('factory-deluxe')
    expect(preset?.blocks[0]?.modelId).toBe('tone3000:model:1')
    expect(preset?.blocks[0]?.modelName).toBe('Deluxe (small)')

    expect((await loadPresetBank())?.slots[0]).toBe('factory-deluxe')
    expect((await loadSceneBank())?.scenes[0]?.slots[0]).toBe(0)
  })

  it('skips models already cached', async () => {
    apiGetToneMock.mockResolvedValue(tone(1))
    apiListModelsMock.mockResolvedValue({
      data: [model(1)],
      page: 1,
      page_size: 50,
      total: 1,
      total_pages: 1,
    })
    hasMock.mockResolvedValue(true)

    const summary = await downloadFactoryPack(undefined, pack)

    expect(summary.downloaded).toBe(0)
    expect(summary.skipped).toBe(1)
    expect(importAssetMock).not.toHaveBeenCalled()
    expect(summary.placedPresets).toBe(1)
  })

  it('keeps going when a model fails, reporting it and skipping its preset', async () => {
    apiGetToneMock.mockRejectedValue(new Error('tone gone'))

    const summary = await downloadFactoryPack(undefined, pack)

    expect(summary.downloaded).toBe(0)
    expect(summary.failed).toHaveLength(1)
    expect(summary.failed[0]?.name).toBe('Deluxe')
    expect(summary.placedPresets).toBe(0)
    expect(await loadPresetBank()).toBeNull()
    expect(await getPreset('factory-deluxe')).toBeNull()
  })

  it('reports progress through the callback', async () => {
    apiGetToneMock.mockResolvedValue(tone(1))
    apiListModelsMock.mockResolvedValue({
      data: [model(1)],
      page: 1,
      page_size: 50,
      total: 1,
      total_pages: 1,
    })
    const seen: Array<{ done: number; total: number }> = []
    await downloadFactoryPack((p) => seen.push({ done: p.done, total: p.total }), pack)
    expect(seen).toHaveLength(2)
    expect(seen[0]).toEqual({ done: 0, total: 1 })
    expect(seen[1]).toEqual({ done: 1, total: 1 })
  })
})
