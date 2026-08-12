// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { useGraphStore } from '../state/graphStore'
import { capturePreset } from './capture'
import type { PresetBlock, PresetRig } from './types'

function createMockBlock(overrides: Partial<PresetBlock> = {}): PresetBlock {
  return {
    kind: 'drive',
    getParams: () => ({}),
    setParams: () => undefined,
    ...overrides,
  }
}

function createMockRig(blocks: Record<string, PresetBlock> = {}): PresetRig {
  return {
    listBlockIds: () => Object.keys(blocks),
    getBlock: (id) => blocks[id] ?? null,
    addBlock: async () => '',
    removeBlock: async () => undefined,
    listEdgeIds: () => [],
    connect: () => ({ ok: true }),
  }
}

describe('capturePreset', () => {
  beforeEach(() => {
    useGraphStore.setState({ blocks: [], edges: [], masterLevel: 1, masterMuted: false })
  })

  it('captures top-level metadata and store-level state', () => {
    useGraphStore.setState({ masterLevel: 0.9, masterMuted: true })
    const preset = capturePreset('p1', 'My Tone', createMockRig(), useGraphStore)

    expect(preset.id).toBe('p1')
    expect(preset.name).toBe('My Tone')
    expect(preset.masterLevel).toBe(0.9)
    expect(preset.masterMuted).toBe(true)
    expect(preset.tags).toEqual([])
    expect(preset.favorite).toBe(false)
  })

  it('captures each block from the store with its position and live params', () => {
    const rig = createMockRig({
      b1: createMockBlock({ getParams: () => ({ drive: 0.8 }) }),
    })
    useGraphStore.setState({
      blocks: [{ id: 'b1', kind: 'drive', row: 1, col: 2, params: {} }],
    })

    const preset = capturePreset('p1', 'My Tone', rig, useGraphStore)

    expect(preset.blocks).toEqual([
      {
        id: 'b1',
        kind: 'drive',
        row: 1,
        col: 2,
        params: { drive: 0.8 },
        modelId: null,
        modelName: null,
        irId: null,
        irName: null,
      },
    ])
  })

  it('falls back to the store copy of params when the block is not live (e.g. engine off)', () => {
    useGraphStore.setState({
      blocks: [{ id: 'b1', kind: 'drive', row: 0, col: 0, params: { drive: 0.5 } }],
    })

    const preset = capturePreset('p1', 'My Tone', createMockRig(), useGraphStore)

    expect(preset.blocks[0]?.params).toEqual({ drive: 0.5 })
  })

  it('captures bypass only when explicitly set on the stored block', () => {
    useGraphStore.setState({
      blocks: [
        { id: 'b1', kind: 'drive', row: 0, col: 0, bypass: true, params: {} },
        { id: 'b2', kind: 'eq', row: 0, col: 1, params: {} },
      ],
    })

    const preset = capturePreset('p1', 'My Tone', createMockRig(), useGraphStore)

    expect(preset.blocks[0]?.bypass).toBe(true)
    expect(preset.blocks[1]?.bypass).toBeUndefined()
  })

  it('captures the loaded model/IR identity for Amp/Cab blocks', () => {
    const rig = createMockRig({
      amp1: createMockBlock({
        kind: 'amp',
        getLoadedModel: () => ({ id: 'model-1', name: 'Deluxe' }),
      }),
    })
    useGraphStore.setState({
      blocks: [{ id: 'amp1', kind: 'amp', row: 0, col: 0, params: {} }],
    })

    const preset = capturePreset('p1', 'My Tone', rig, useGraphStore)

    expect(preset.blocks[0]?.modelId).toBe('model-1')
    expect(preset.blocks[0]?.modelName).toBe('Deluxe')
  })

  it('captures edges verbatim from the store', () => {
    useGraphStore.setState({
      edges: [{ id: 'e1', from: { blockId: 'IN', port: 0 }, to: { blockId: 'b1', port: 0 } }],
    })

    const preset = capturePreset('p1', 'My Tone', createMockRig(), useGraphStore)

    expect(preset.edges).toEqual([
      { id: 'e1', from: { blockId: 'IN', port: 0 }, to: { blockId: 'b1', port: 0 } },
    ])
  })

  it('preserves tags/favorite/createdAt when re-capturing an existing preset', () => {
    const preset = capturePreset('p1', 'My Tone', createMockRig(), useGraphStore, {
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
