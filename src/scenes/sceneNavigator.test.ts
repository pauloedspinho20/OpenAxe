// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSceneStore } from '../state/sceneStore'
import { useCurrentPresetStore } from '../state/currentPresetStore'
import { useGraphStore } from '../state/graphStore'
import { createEmptyBank } from './sceneBankStore'
import type { Preset, PresetRig } from '../presets/types'

const { applyPresetMock, getPresetMock } = vi.hoisted(() => ({
  applyPresetMock: vi.fn(),
  getPresetMock: vi.fn(),
}))
vi.mock('../presets/apply', () => ({ applyPreset: applyPresetMock }))
vi.mock('../presets/presetStore', () => ({ getPreset: getPresetMock }))

const { SceneNavigator } = await import('./sceneNavigator')

function preset(id: string): Preset {
  return {
    id,
    name: id,
    tags: [],
    favorite: false,
    createdAt: 0,
    updatedAt: 0,
    blocks: [],
    edges: [],
    masterLevel: 1,
    masterMuted: false,
  }
}

function fakeRig(): PresetRig {
  return {
    listBlockIds: () => [],
    getBlock: () => null,
    addBlock: vi.fn(async () => 'id'),
    removeBlock: vi.fn(async () => undefined),
    listEdgeIds: () => [],
    connect: vi.fn(() => ({ ok: true })),
  }
}

function fakeContext(): AudioContext {
  return {} as AudioContext
}

describe('SceneNavigator', () => {
  beforeEach(() => {
    applyPresetMock.mockReset()
    applyPresetMock.mockResolvedValue({ missingAssets: [] })
    getPresetMock.mockReset()
    getPresetMock.mockImplementation(async (id: string) => preset(id))

    const bank = createEmptyBank()
    bank.scenes[0]!.slots[0] = 'preset-a'
    bank.scenes[0]!.slots[1] = 'preset-b'
    // slot 2 stays empty
    bank.scenes[1]!.slots[3] = 'preset-c'
    bank.scenes[63]!.slots[0] = 'preset-d'
    useSceneStore.getState().hydrate(bank)

    SceneNavigator.setTarget({ rig: fakeRig(), context: fakeContext() })
  })

  it('applies the slot preset and moves the pointer', async () => {
    const result = await SceneNavigator.goToSlot(1)
    expect(result.ok).toBe(true)
    expect(result.presetId).toBe('preset-b')
    expect(applyPresetMock).toHaveBeenCalledTimes(1)
    expect(useSceneStore.getState().activeSlot).toBe(1)
  })

  it('moves the pointer but applies nothing for an empty slot', async () => {
    const result = await SceneNavigator.goToSlot(2)
    expect(result).toMatchObject({ ok: false, reason: 'empty-slot' })
    expect(applyPresetMock).not.toHaveBeenCalled()
    expect(useSceneStore.getState().activeSlot).toBe(2)
  })

  it('moves the pointer but reports no-engine when nothing is registered', async () => {
    SceneNavigator.setTarget(null)
    const result = await SceneNavigator.goToSlot(0)
    expect(result).toMatchObject({ ok: false, reason: 'no-engine', presetId: 'preset-a' })
    expect(applyPresetMock).not.toHaveBeenCalled()
    expect(useSceneStore.getState().activeSlot).toBe(0)
  })

  it('reports missing-preset without throwing when the slot points at a deleted preset', async () => {
    getPresetMock.mockResolvedValue(null)
    const result = await SceneNavigator.goToSlot(0)
    expect(result).toMatchObject({ ok: false, reason: 'missing-preset' })
  })

  it('reports error without throwing when applyPreset rejects', async () => {
    applyPresetMock.mockRejectedValue(new Error('boom'))
    const result = await SceneNavigator.goToSlot(0)
    expect(result).toMatchObject({ ok: false, reason: 'error' })
  })

  it('nextScene wraps from the last scene back to the first', async () => {
    useSceneStore.getState().setActive(63, 0)
    const result = await SceneNavigator.nextScene()
    expect(result.scene).toBe(0)
  })

  it('prevScene wraps from the first scene back to the last', async () => {
    useSceneStore.getState().setActive(0, 0)
    const result = await SceneNavigator.prevScene()
    expect(result.scene).toBe(63)
    expect(result.presetId).toBe('preset-d')
  })

  it('goToScene falls back to the first non-empty slot when the current slot is empty there', async () => {
    useSceneStore.getState().setActive(0, 2) // slot 2 is empty everywhere
    const result = await SceneNavigator.goToScene(1)
    expect(result.slot).toBe(3) // scene 1's only filled slot
    expect(result.presetId).toBe('preset-c')
  })

  it('serializes overlapping calls so only the last one actually applies', async () => {
    const first = SceneNavigator.goToSlot(0)
    const second = SceneNavigator.goToSlot(1)
    const [r1, r2] = await Promise.all([first, second])

    expect(r1.reason).toBe('superseded')
    expect(r2.ok).toBe(true)
    expect(r2.presetId).toBe('preset-b')
    expect(applyPresetMock).toHaveBeenCalledTimes(1)
  })

  it('switching is true during the apply and false once settled', async () => {
    let sawSwitching = false
    applyPresetMock.mockImplementation(async () => {
      sawSwitching = useSceneStore.getState().switching
      return { missingAssets: [] }
    })
    await SceneNavigator.goToSlot(0)
    expect(sawSwitching).toBe(true)
    expect(useSceneStore.getState().switching).toBe(false)
  })

  describe('currentPresetStore baseline', () => {
    it('resolves the current-preset baseline on a normal load', async () => {
      await SceneNavigator.goToSlot(0)
      expect(useCurrentPresetStore.getState().saved?.id).toBe('preset-a')
    })

    it('resolves the baseline even with no engine registered', async () => {
      SceneNavigator.setTarget(null)
      await SceneNavigator.goToSlot(0)
      expect(useCurrentPresetStore.getState().saved?.id).toBe('preset-a')
    })

    it('clears the baseline for an empty slot', async () => {
      useCurrentPresetStore.getState().setSaved(preset('stale'))
      await SceneNavigator.goToSlot(2)
      expect(useCurrentPresetStore.getState().saved).toBeNull()
    })

    it('clears the baseline when the slot points at a deleted preset', async () => {
      useCurrentPresetStore.getState().setSaved(preset('stale'))
      getPresetMock.mockResolvedValue(null)
      await SceneNavigator.goToSlot(0)
      expect(useCurrentPresetStore.getState().saved).toBeNull()
    })
  })

  describe('clearing the grid on an empty slot', () => {
    beforeEach(() => {
      useGraphStore.setState({
        blocks: [{ id: 'b1', kind: 'compressor', row: 0, col: 0, params: {} }],
        edges: [{ id: 'e1', from: { blockId: 'IN', port: 0 }, to: { blockId: 'b1', port: 0 } }],
        masterLevel: 0.75,
        masterMuted: true,
      })
    })

    it('removes every live block from the rig and empties the store, keeping master level/mute', async () => {
      const removeBlock = vi.fn(async () => undefined)
      SceneNavigator.setTarget({
        rig: { ...fakeRig(), listBlockIds: () => ['b1'], removeBlock },
        context: fakeContext(),
      })

      await SceneNavigator.goToSlot(2)

      expect(removeBlock).toHaveBeenCalledWith('b1')
      const state = useGraphStore.getState()
      expect(state.blocks).toEqual([])
      expect(state.edges).toEqual([])
      expect(state.masterLevel).toBe(0.75)
      expect(state.masterMuted).toBe(true)
    })

    it('still empties the store when no engine is registered', async () => {
      SceneNavigator.setTarget(null)

      await SceneNavigator.goToSlot(2)

      const state = useGraphStore.getState()
      expect(state.blocks).toEqual([])
      expect(state.edges).toEqual([])
    })

    it('does not clear the grid when the slot has a preset to load', async () => {
      await SceneNavigator.goToSlot(0)
      expect(useGraphStore.getState().blocks).not.toEqual([])
    })
  })
})
