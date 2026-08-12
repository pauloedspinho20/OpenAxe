// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDualChainStore } from '../state/dualChainStore'
import type { Effect } from '../effects/Effect'
import type {
  ChainPresetData,
  Preset,
  PresetAmpChain,
  PresetEffectsChain,
  PresetRig,
} from './types'

const { getCachedAssetMock } = vi.hoisted(() => ({ getCachedAssetMock: vi.fn() }))
vi.mock('../engine/assetCache', () => ({ getCachedAsset: getCachedAssetMock }))

const { createEffectMock } = vi.hoisted(() => ({ createEffectMock: vi.fn() }))
vi.mock('../effects/effectRegistry', () => ({ createEffect: createEffectMock }))

const { applyPreset } = await import('./apply')

function createMockAmp(): PresetAmpChain & {
  loadModel: ReturnType<typeof vi.fn<PresetAmpChain['loadModel']>>
  unloadModel: ReturnType<typeof vi.fn<PresetAmpChain['unloadModel']>>
  loadIR: ReturnType<typeof vi.fn<PresetAmpChain['loadIR']>>
  clearIR: ReturnType<typeof vi.fn<PresetAmpChain['clearIR']>>
} {
  return {
    getLoadedModel: () => null,
    getLoadedIr: () => null,
    getIrMix: () => 0,
    loadModel: vi.fn(async () => undefined),
    unloadModel: vi.fn(async () => undefined),
    loadIR: vi.fn(),
    clearIR: vi.fn(),
  }
}

function createMockEffectsChain(): PresetEffectsChain & {
  insert: ReturnType<typeof vi.fn<PresetEffectsChain['insert']>>
  remove: ReturnType<typeof vi.fn<PresetEffectsChain['remove']>>
} {
  const effects: Effect[] = []
  return {
    list: () => effects,
    insert: vi.fn((effect: Effect) => {
      effects.push(effect)
    }),
    remove: vi.fn(),
  }
}

function createMockContext(): AudioContext {
  return {
    decodeAudioData: vi.fn(async () => ({ duration: 1 }) as AudioBuffer),
  } as unknown as AudioContext
}

function emptyChainData(overrides: Partial<ChainPresetData> = {}): ChainPresetData {
  return {
    modelId: null,
    modelName: null,
    irId: null,
    irName: null,
    irMix: 1,
    level: 1,
    pan: 0,
    mute: false,
    solo: false,
    preFx: [],
    postFx: [],
    ...overrides,
  }
}

function emptyPreset(overrides: Partial<Preset> = {}): Preset {
  return {
    id: 'p1',
    name: 'Test',
    tags: [],
    favorite: false,
    createdAt: 0,
    updatedAt: 0,
    chainA: emptyChainData(),
    chainB: emptyChainData(),
    masterLevel: 1,
    linked: false,
    ...overrides,
  }
}

describe('applyPreset', () => {
  beforeEach(() => {
    getCachedAssetMock.mockReset()
    createEffectMock.mockReset()
    useDualChainStore.setState({
      chainA: { level: 1, pan: -1, mute: false, solo: false },
      chainB: { level: 1, pan: 1, mute: false, solo: false },
      masterLevel: 1,
      linked: false,
    })
  })

  it('applies top-level store state (levels, pans, mute/solo, master, linked)', async () => {
    const rig: PresetRig = {
      amp: () => createMockAmp(),
      preFx: () => createMockEffectsChain(),
      postFx: () => createMockEffectsChain(),
    }
    const preset = emptyPreset({
      chainA: emptyChainData({ level: 0.4, pan: -0.5, mute: true }),
      masterLevel: 0.6,
      linked: true,
    })

    await applyPreset(createMockContext(), preset, rig, useDualChainStore)

    const state = useDualChainStore.getState()
    expect(state.chainA).toMatchObject({ level: 0.4, pan: -0.5, mute: true })
    expect(state.masterLevel).toBe(0.6)
    expect(state.linked).toBe(true)
  })

  it('loads a cached model/IR by id and reports none missing when both are cached', async () => {
    const amp = createMockAmp()
    getCachedAssetMock.mockImplementation(async (id: string) => ({
      text: async () => `{"id":"${id}"}`,
      arrayBuffer: async () => new ArrayBuffer(0),
    }))
    const rig: PresetRig = {
      amp: () => amp,
      preFx: () => createMockEffectsChain(),
      postFx: () => createMockEffectsChain(),
    }
    const preset = emptyPreset({
      chainA: emptyChainData({
        modelId: 'model-1',
        modelName: 'Deluxe',
        irId: 'ir-1',
        irName: 'Cab',
      }),
    })

    const result = await applyPreset(createMockContext(), preset, rig, useDualChainStore)

    expect(result.missingAssets).toEqual([])
    expect(amp.loadModel).toHaveBeenCalledWith('{"id":"model-1"}', undefined, {
      id: 'model-1',
      name: 'Deluxe',
    })
    expect(amp.loadIR).toHaveBeenCalled()
  })

  it('reports a missing asset instead of throwing when a referenced model/IR is not cached', async () => {
    getCachedAssetMock.mockResolvedValue(null)
    const amp = createMockAmp()
    const rig: PresetRig = {
      amp: () => amp,
      preFx: () => createMockEffectsChain(),
      postFx: () => createMockEffectsChain(),
    }
    const preset = emptyPreset({
      chainA: emptyChainData({ modelId: 'missing-model', modelName: 'Ghost Amp' }),
    })

    const result = await applyPreset(createMockContext(), preset, rig, useDualChainStore)

    expect(result.missingAssets).toEqual([
      { chain: 'A', kind: 'model', id: 'missing-model', name: 'Ghost Amp' },
    ])
    expect(amp.loadModel).not.toHaveBeenCalled()
  })

  it('unloads the model/IR when the preset has none, rather than leaving the previous one', async () => {
    const amp = createMockAmp()
    const rig: PresetRig = {
      amp: () => amp,
      preFx: () => createMockEffectsChain(),
      postFx: () => createMockEffectsChain(),
    }

    await applyPreset(createMockContext(), emptyPreset(), rig, useDualChainStore)

    expect(amp.unloadModel).toHaveBeenCalled()
    expect(amp.clearIR).toHaveBeenCalled()
  })

  it('rebuilds the FX chains: disposes old effects and inserts new ones from saved params', async () => {
    const oldEffect = { dispose: vi.fn() } as unknown as Effect
    const preFx = createMockEffectsChain()
    preFx.list = () => [oldEffect]
    const newEffect = { name: 'Reverb', setBypass: vi.fn(), setMix: vi.fn() } as unknown as Effect
    createEffectMock.mockResolvedValue(newEffect)

    const rig: PresetRig = {
      amp: () => createMockAmp(),
      preFx: () => preFx,
      postFx: () => createMockEffectsChain(),
    }
    const preset = emptyPreset({
      chainA: emptyChainData({
        preFx: [{ kind: 'reverb', bypass: true, mix: 0.3, params: { roomSize: 0.5 } }],
      }),
    })

    await applyPreset(createMockContext(), preset, rig, useDualChainStore)

    expect(preFx.remove).toHaveBeenCalledWith(oldEffect)
    expect(oldEffect.dispose).toHaveBeenCalled()
    expect(createEffectMock).toHaveBeenCalledWith(expect.anything(), 'reverb', { roomSize: 0.5 })
    expect(preFx.insert).toHaveBeenCalledWith(newEffect)
  })
})
