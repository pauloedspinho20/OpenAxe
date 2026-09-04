// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGraphStore } from '../state/graphStore'
import type { Preset, PresetBlock, PresetRig, StageCapableRig, StagedPresetRig } from './types'

const { getCachedAssetMock } = vi.hoisted(() => ({ getCachedAssetMock: vi.fn() }))
vi.mock('../engine/assetCache', () => ({ getCachedAsset: getCachedAssetMock }))

const { applyPreset } = await import('./apply')

function createMockBlock(overrides: Partial<PresetBlock> = {}): PresetBlock {
  return {
    kind: 'compressor',
    getParams: () => ({}),
    setParams: vi.fn(),
    setBypass: vi.fn(),
    getLoadedModel: () => null,
    loadModel: vi.fn(async () => undefined),
    unloadModel: vi.fn(async () => undefined),
    getLoadedIr: () => null,
    loadIR: vi.fn(),
    clearIR: vi.fn(),
    ...overrides,
  }
}

function createMockRig(initial: Record<string, PresetBlock> = {}): PresetRig & {
  blocks: Record<string, PresetBlock>
} {
  const blocks = { ...initial }
  return {
    blocks,
    listBlockIds: () => Object.keys(blocks),
    getBlock: (id) => blocks[id] ?? null,
    addBlock: vi.fn(async (kind, _row, _col, id) => {
      const blockId = id ?? `${kind}-generated`
      blocks[blockId] = createMockBlock({ kind })
      return blockId
    }),
    removeBlock: vi.fn(async (id) => {
      delete blocks[id]
    }),
    listEdgeIds: () => [],
    connect: vi.fn(() => ({ ok: true })),
  }
}

function createMockContext(): AudioContext {
  return {
    decodeAudioData: vi.fn(async () => ({ duration: 1 }) as AudioBuffer),
  } as unknown as AudioContext
}

function emptyPreset(overrides: Partial<Preset> = {}): Preset {
  return {
    id: 'p1',
    name: 'Test',
    tags: [],
    favorite: false,
    createdAt: 0,
    updatedAt: 0,
    blocks: [],
    edges: [],
    masterLevel: 1,
    masterMuted: false,
    ...overrides,
  }
}

describe('applyPreset', () => {
  beforeEach(() => {
    getCachedAssetMock.mockReset()
    useGraphStore.setState({ blocks: [], edges: [], masterLevel: 1, masterMuted: false })
  })

  it('clears every existing block on the rig before rebuilding', async () => {
    const rig = createMockRig({ old1: createMockBlock() })

    await applyPreset(createMockContext(), emptyPreset(), rig, useGraphStore)

    expect(rig.removeBlock).toHaveBeenCalledWith('old1')
  })

  it('adds every preset block at its saved position and pushes its params', async () => {
    const rig = createMockRig()
    const preset = emptyPreset({
      blocks: [{ id: 'b1', kind: 'compressor', row: 1, col: 2, params: { drive: 0.8 } }],
    })

    await applyPreset(createMockContext(), preset, rig, useGraphStore)

    expect(rig.addBlock).toHaveBeenCalledWith('compressor', 1, 2, 'b1')
    expect(rig.blocks.b1?.setParams).toHaveBeenCalledWith({ drive: 0.8 })
  })

  it('sets bypass on the new block only when the preset specifies it', async () => {
    const rig = createMockRig()
    const preset = emptyPreset({
      blocks: [{ id: 'b1', kind: 'compressor', row: 0, col: 0, bypass: true, params: {} }],
    })

    await applyPreset(createMockContext(), preset, rig, useGraphStore)

    expect(rig.blocks.b1?.setBypass).toHaveBeenCalledWith(true)
  })

  it('connects every preset edge with its saved id', async () => {
    const rig = createMockRig()
    const preset = emptyPreset({
      blocks: [
        { id: 'b1', kind: 'compressor', row: 0, col: 0, params: {} },
        { id: 'b2', kind: 'eq', row: 0, col: 1, params: {} },
      ],
      edges: [{ id: 'e1', from: { blockId: 'b1', port: 0 }, to: { blockId: 'b2', port: 0 } }],
    })

    await applyPreset(createMockContext(), preset, rig, useGraphStore)

    expect(rig.connect).toHaveBeenCalledWith(
      { blockId: 'b1', port: 0 },
      { blockId: 'b2', port: 0 },
      'e1',
    )
  })

  it('loads a cached model by id and reports none missing when cached', async () => {
    getCachedAssetMock.mockResolvedValue({ text: async () => '{"id":"model-1"}' })
    const rig = createMockRig()
    const preset = emptyPreset({
      blocks: [
        {
          id: 'amp1',
          kind: 'amp',
          row: 0,
          col: 0,
          params: {},
          modelId: 'model-1',
          modelName: 'Deluxe',
        },
      ],
    })

    const result = await applyPreset(createMockContext(), preset, rig, useGraphStore)

    expect(result.missingAssets).toEqual([])
    expect(rig.blocks.amp1?.loadModel).toHaveBeenCalledWith('{"id":"model-1"}', undefined, {
      id: 'model-1',
      name: 'Deluxe',
    })
  })

  it.each(['amp-cab', 'pedal', 'outboard', 'space'] as const)(
    'loads a cached model for %s blocks too, not just amp',
    async (kind) => {
      getCachedAssetMock.mockResolvedValue({ text: async () => '{"id":"model-1"}' })
      const rig = createMockRig()
      const preset = emptyPreset({
        blocks: [
          {
            id: 'blk1',
            kind,
            row: 0,
            col: 0,
            params: {},
            modelId: 'model-1',
            modelName: 'Deluxe',
          },
        ],
      })

      const result = await applyPreset(createMockContext(), preset, rig, useGraphStore)

      expect(result.missingAssets).toEqual([])
      expect(rig.blocks.blk1?.loadModel).toHaveBeenCalledWith('{"id":"model-1"}', undefined, {
        id: 'model-1',
        name: 'Deluxe',
      })
    },
  )

  it('reports a missing asset instead of throwing when a referenced model is not cached', async () => {
    getCachedAssetMock.mockResolvedValue(null)
    const rig = createMockRig()
    const preset = emptyPreset({
      blocks: [
        {
          id: 'amp1',
          kind: 'amp',
          row: 0,
          col: 0,
          params: {},
          modelId: 'missing',
          modelName: 'Ghost',
        },
      ],
    })

    const result = await applyPreset(createMockContext(), preset, rig, useGraphStore)

    expect(result.missingAssets).toEqual([
      { blockId: 'amp1', kind: 'model', id: 'missing', name: 'Ghost' },
    ])
    expect(rig.blocks.amp1?.loadModel).not.toHaveBeenCalled()
  })

  it('unloads the model when the preset has none, rather than leaving the previous one', async () => {
    const rig = createMockRig()
    const preset = emptyPreset({
      blocks: [{ id: 'amp1', kind: 'amp', row: 0, col: 0, params: {} }],
    })

    await applyPreset(createMockContext(), preset, rig, useGraphStore)

    expect(rig.blocks.amp1?.unloadModel).toHaveBeenCalled()
  })

  it('syncs graphStore to the rebuilt graph so future reconciles are no-ops', async () => {
    const rig = createMockRig()
    const preset = emptyPreset({
      blocks: [{ id: 'b1', kind: 'compressor', row: 0, col: 0, params: { drive: 0.8 } }],
      masterLevel: 0.6,
      masterMuted: true,
    })

    await applyPreset(createMockContext(), preset, rig, useGraphStore)

    const state = useGraphStore.getState()
    expect(state.blocks).toEqual([
      { id: 'b1', kind: 'compressor', row: 0, col: 0, params: { drive: 0.8 } },
    ])
    expect(state.masterLevel).toBe(0.6)
    expect(state.masterMuted).toBe(true)
  })

  it('reports a corrupt model in missingAssets instead of aborting the restore', async () => {
    getCachedAssetMock.mockResolvedValue({
      text: async () => {
        throw new Error('corrupt json')
      },
    })
    const rig = createMockRig()
    const preset = emptyPreset({
      blocks: [
        { id: 'amp1', kind: 'amp', row: 0, col: 0, params: {}, modelId: 'm1', modelName: 'M1' },
      ],
    })

    const result = await applyPreset(createMockContext(), preset, rig, useGraphStore)

    expect(result.missingAssets).toEqual([{ blockId: 'amp1', kind: 'model', id: 'm1', name: 'M1' }])
    // The store sync must still run even when one asset fails.
    expect(useGraphStore.getState().blocks).toHaveLength(1)
  })
})

function createMockStagedRig(): StageCapableRig & {
  staged: StagedPresetRig & { blocks: Record<string, PresetBlock> }
  liveBlocks: Record<string, PresetBlock>
} {
  const liveBlocks: Record<string, PresetBlock> = { old1: createMockBlock() }
  const stagedBlocks: Record<string, PresetBlock> = {}
  const staged: StagedPresetRig & { blocks: Record<string, PresetBlock> } = {
    blocks: stagedBlocks,
    getBlock: (id) => stagedBlocks[id] ?? null,
    addBlock: vi.fn(async (kind, _row, _col, id) => {
      stagedBlocks[id] = createMockBlock({ kind })
      return id
    }),
    connectAndWait: vi.fn(async () => ({ ok: true })),
    commit: vi.fn(async () => {}),
    discard: vi.fn(async () => {}),
    takeEntries: vi.fn(() => ({ blocks: new Map(), edges: new Map() })),
  }
  const rig: StageCapableRig & {
    staged: StagedPresetRig & { blocks: Record<string, PresetBlock> }
    liveBlocks: Record<string, PresetBlock>
  } = {
    staged,
    liveBlocks,
    listBlockIds: () => Object.keys(liveBlocks),
    getBlock: (id) => liveBlocks[id] ?? null,
    addBlock: vi.fn(async (kind, _row, _col, id) => {
      const blockId = id ?? `${kind}-generated`
      liveBlocks[blockId] = createMockBlock({ kind })
      return blockId
    }),
    removeBlock: vi.fn(async (id) => {
      delete liveBlocks[id]
    }),
    listEdgeIds: () => [],
    connect: vi.fn(() => ({ ok: true })),
    beginStage: vi.fn(async () => staged),
    adoptStage: vi.fn(),
  }
  return rig
}

describe('applyPreset (staged)', () => {
  beforeEach(() => {
    getCachedAssetMock.mockReset()
    useGraphStore.setState({ blocks: [], edges: [], masterLevel: 1, masterMuted: false })
  })

  it('builds on the staged graph and adopts it without touching the live rig', async () => {
    const rig = createMockStagedRig()
    const preset = emptyPreset({
      blocks: [{ id: 'b1', kind: 'compressor', row: 1, col: 2, params: { drive: 0.8 } }],
      edges: [{ id: 'e1', from: { blockId: 'b1', port: 0 }, to: { blockId: 'b1', port: 0 } }],
    })

    const result = await applyPreset(createMockContext(), preset, rig, useGraphStore)

    expect(rig.beginStage).toHaveBeenCalled()
    // The live rig is never torn down on the staged path.
    expect(rig.removeBlock).not.toHaveBeenCalled()
    expect(rig.addBlock).not.toHaveBeenCalled()
    expect(rig.staged.addBlock).toHaveBeenCalledWith('compressor', 1, 2, 'b1')
    expect(rig.staged.blocks.b1?.setParams).toHaveBeenCalledWith({ drive: 0.8 })
    expect(rig.staged.connectAndWait).toHaveBeenCalledWith(
      { blockId: 'b1', port: 0 },
      { blockId: 'b1', port: 0 },
      'e1',
    )
    expect(rig.staged.commit).toHaveBeenCalled()
    expect(rig.adoptStage).toHaveBeenCalledWith(rig.staged)
    expect(result.missingAssets).toEqual([])
    // The store still syncs to the new graph.
    expect(useGraphStore.getState().blocks).toEqual([
      { id: 'b1', kind: 'compressor', row: 1, col: 2, params: { drive: 0.8 } },
    ])
  })

  it('prefers the preloader over the asset cache for model text', async () => {
    const { cacheModelText } = await import('../engine/modelPreloader')
    cacheModelText('model-1', '{"preloaded":true}')
    const rig = createMockStagedRig()
    const preset = emptyPreset({
      blocks: [
        {
          id: 'amp1',
          kind: 'amp',
          row: 0,
          col: 0,
          params: {},
          modelId: 'model-1',
          modelName: 'Deluxe',
        },
      ],
    })

    await applyPreset(createMockContext(), preset, rig, useGraphStore)

    expect(getCachedAssetMock).not.toHaveBeenCalled()
    expect(rig.staged.blocks.amp1?.loadModel).toHaveBeenCalledWith(
      '{"preloaded":true}',
      undefined,
      { id: 'model-1', name: 'Deluxe' },
    )
  })

  it('discards the stage and falls back to rebuild when commit fails', async () => {
    const rig = createMockStagedRig()
    vi.mocked(rig.staged.commit).mockRejectedValueOnce(new Error('commit exploded'))
    const preset = emptyPreset({
      blocks: [{ id: 'b1', kind: 'compressor', row: 0, col: 0, params: {} }],
    })

    await applyPreset(createMockContext(), preset, rig, useGraphStore)

    expect(rig.staged.discard).toHaveBeenCalled()
    expect(rig.adoptStage).not.toHaveBeenCalled()
    // Legacy fallback rebuilt the live rig instead.
    expect(rig.removeBlock).toHaveBeenCalledWith('old1')
    expect(rig.addBlock).toHaveBeenCalledWith('compressor', 0, 0, 'b1')
    expect(useGraphStore.getState().blocks).toHaveLength(1)
  })

  it('falls back to rebuild when staging is unsupported (old WASM)', async () => {
    const rig = createMockStagedRig()
    vi.mocked(rig.beginStage).mockRejectedValueOnce(new Error('unsupported'))
    const preset = emptyPreset({
      blocks: [{ id: 'b1', kind: 'compressor', row: 0, col: 0, params: {} }],
    })

    await applyPreset(createMockContext(), preset, rig, useGraphStore)

    expect(rig.removeBlock).toHaveBeenCalledWith('old1')
    expect(useGraphStore.getState().blocks).toHaveLength(1)
  })
})
