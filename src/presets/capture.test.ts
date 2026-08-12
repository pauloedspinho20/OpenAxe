// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { useDualChainStore } from '../state/dualChainStore'
import { capturePreset } from './capture'
import type { Effect } from '../effects/Effect'
import type { PresetAmpChain, PresetEffectsChain, PresetRig } from './types'

function createMockAmp(overrides: Partial<PresetAmpChain> = {}): PresetAmpChain {
  return {
    getLoadedModel: () => null,
    getLoadedIr: () => null,
    getIrMix: () => 0,
    loadModel: async () => undefined,
    unloadModel: async () => undefined,
    loadIR: () => undefined,
    clearIR: () => undefined,
    ...overrides,
  }
}

function createMockEffect(kind: Effect['kind'], overrides: Partial<Effect> = {}): Effect {
  return {
    kind,
    name: kind,
    inputNode: {} as unknown as AudioNode,
    outputNode: {} as unknown as AudioNode,
    setMix: () => undefined,
    getMix: () => 1,
    setBypass: () => undefined,
    isBypassed: () => false,
    getParams: () => ({}),
    setParams: () => undefined,
    dispose: () => undefined,
    ...overrides,
  }
}

function createMockEffectsChain(effects: Effect[] = []): PresetEffectsChain {
  return {
    list: () => effects,
    insert: () => undefined,
    remove: () => undefined,
  }
}

describe('capturePreset', () => {
  beforeEach(() => {
    useDualChainStore.setState({
      chainA: { level: 0.8, pan: -1, mute: false, solo: false },
      chainB: { level: 1, pan: 1, mute: true, solo: false },
      masterLevel: 0.9,
      linked: true,
    })
  })

  it('captures top-level metadata and store-level state', () => {
    const rig: PresetRig = {
      amp: () => createMockAmp(),
      preFx: () => createMockEffectsChain(),
      postFx: () => createMockEffectsChain(),
    }

    const preset = capturePreset('p1', 'My Tone', rig, useDualChainStore)

    expect(preset.id).toBe('p1')
    expect(preset.name).toBe('My Tone')
    expect(preset.masterLevel).toBe(0.9)
    expect(preset.linked).toBe(true)
    expect(preset.tags).toEqual([])
    expect(preset.favorite).toBe(false)
  })

  it('captures each chain strip from the store, per chain', () => {
    const rig: PresetRig = {
      amp: () => createMockAmp(),
      preFx: () => createMockEffectsChain(),
      postFx: () => createMockEffectsChain(),
    }

    const preset = capturePreset('p1', 'My Tone', rig, useDualChainStore)

    expect(preset.chainA).toMatchObject({ level: 0.8, pan: -1, mute: false, solo: false })
    expect(preset.chainB).toMatchObject({ level: 1, pan: 1, mute: true, solo: false })
  })

  it('captures the loaded model/IR identity and mix per chain', () => {
    const rig: PresetRig = {
      amp: (chain) =>
        createMockAmp({
          getLoadedModel: () => (chain === 'A' ? { id: 'model-1', name: 'Deluxe' } : null),
          getLoadedIr: () => (chain === 'A' ? { id: 'ir-1', name: 'Celestion' } : null),
          getIrMix: () => (chain === 'A' ? 0.75 : 0),
        }),
      preFx: () => createMockEffectsChain(),
      postFx: () => createMockEffectsChain(),
    }

    const preset = capturePreset('p1', 'My Tone', rig, useDualChainStore)

    expect(preset.chainA.modelId).toBe('model-1')
    expect(preset.chainA.modelName).toBe('Deluxe')
    expect(preset.chainA.irId).toBe('ir-1')
    expect(preset.chainA.irMix).toBe(0.75)
    expect(preset.chainB.modelId).toBeNull()
    expect(preset.chainB.irId).toBeNull()
  })

  it('captures each effect in the pre/post FX chains with its kind, bypass, mix, and params', () => {
    const driveEffect = createMockEffect('drive', {
      isBypassed: () => true,
      getMix: () => 0.5,
      getParams: () => ({ type: 'fuzz', drive: 0.9 }),
    })
    const reverbEffect = createMockEffect('reverb', { getParams: () => ({ roomSize: 0.6 }) })

    const rig: PresetRig = {
      amp: () => createMockAmp(),
      preFx: (chain) => createMockEffectsChain(chain === 'A' ? [driveEffect] : []),
      postFx: (chain) => createMockEffectsChain(chain === 'A' ? [reverbEffect] : []),
    }

    const preset = capturePreset('p1', 'My Tone', rig, useDualChainStore)

    expect(preset.chainA.preFx).toEqual([
      { kind: 'drive', bypass: true, mix: 0.5, params: { type: 'fuzz', drive: 0.9 } },
    ])
    expect(preset.chainA.postFx).toEqual([
      { kind: 'reverb', bypass: false, mix: 1, params: { roomSize: 0.6 } },
    ])
    expect(preset.chainB.preFx).toEqual([])
  })

  it('preserves tags/favorite/createdAt when re-capturing an existing preset', () => {
    const rig: PresetRig = {
      amp: () => createMockAmp(),
      preFx: () => createMockEffectsChain(),
      postFx: () => createMockEffectsChain(),
    }

    const preset = capturePreset('p1', 'My Tone', rig, useDualChainStore, {
      tags: ['ambient'],
      favorite: true,
      createdAt: 12345,
    })

    expect(preset.tags).toEqual(['ambient'])
    expect(preset.favorite).toBe(true)
    expect(preset.createdAt).toBe(12345)
    expect(preset.updatedAt).toBeGreaterThanOrEqual(preset.createdAt)
  })
})
