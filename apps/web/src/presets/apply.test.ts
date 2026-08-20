import { describe, expect, it, vi } from 'vitest'
import { applyPreset } from './apply'
import type { Preset, PresetBlock, PresetRig } from './types'

vi.mock('../engine/assetCache', () => ({
  getCachedAsset: vi.fn(async () => ({
    text: async () => '{}',
    arrayBuffer: async () => new ArrayBuffer(8),
  })),
}))

function makeBlock(opts: { loadModelThrows?: boolean } = {}): PresetBlock {
  return {
    kind: 'amp',
    getParams: () => ({}),
    setParams: () => {},
    loadModel: opts.loadModelThrows
      ? async () => {
          throw new Error('bad model')
        }
      : async () => undefined,
    unloadModel: async () => {},
  } as unknown as PresetBlock
}

function makeRig(blocks: Record<string, PresetBlock>): PresetRig {
  return {
    listBlockIds: () => [],
    getBlock: (id) => blocks[id] ?? null,
    addBlock: async (_kind, _row, _col, id) => id ?? 'x',
    removeBlock: async () => {},
    listEdgeIds: () => [],
    connect: () => ({ ok: true }),
  }
}

describe('applyPreset', () => {
  it('reports a bad model in missingAssets instead of aborting the restore', async () => {
    const rig = makeRig({ b1: makeBlock(), b2: makeBlock({ loadModelThrows: true }) })
    const loadGraph = vi.fn()
    const store = { getState: () => ({ loadGraph }) } as never

    const preset: Preset = {
      id: 'p1',
      name: 'p',
      tags: [],
      favorite: false,
      createdAt: 0,
      updatedAt: 0,
      blocks: [
        { id: 'b1', kind: 'amp', row: 0, col: 1, params: {}, modelId: 'm1', modelName: 'M1' },
        { id: 'b2', kind: 'amp', row: 0, col: 2, params: {}, modelId: 'm2', modelName: 'M2' },
      ],
      edges: [],
      masterLevel: 1,
      masterMuted: false,
    }

    const result = await applyPreset({} as AudioContext, preset, rig, store)
    expect(result.missingAssets).toHaveLength(1)
    expect(result.missingAssets[0].id).toBe('m2')
    // The store sync must still run even when one asset fails.
    expect(loadGraph).toHaveBeenCalled()
  })
})
