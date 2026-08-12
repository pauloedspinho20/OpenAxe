// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { useGraphStore, type EdgeInstance } from './graphStore'
import { jack } from '../engine/gridConfig'

describe('graphStore', () => {
  beforeEach(() => {
    useGraphStore.setState({ blocks: [], edges: [], masterLevel: 1, masterMuted: false })
  })

  it('starts empty at unity master level, unmuted', () => {
    const state = useGraphStore.getState()
    expect(state.blocks).toEqual([])
    expect(state.edges).toEqual([])
    expect(state.masterLevel).toBe(1)
    expect(state.masterMuted).toBe(false)
  })

  it('addBlock appends a block with empty params at the given position', () => {
    const id = useGraphStore.getState().addBlock('compressor', 1, 2)
    const block = useGraphStore.getState().blocks.find((b) => b.id === id)
    expect(block).toEqual({ id, kind: 'compressor', row: 1, col: 2, params: {} })
  })

  it('removeBlock drops the block and every edge touching it', () => {
    const a = useGraphStore.getState().addBlock('compressor', 0, 0)
    const b = useGraphStore.getState().addBlock('eq', 0, 1)
    useGraphStore.getState().connect(jack(a), jack(b))

    useGraphStore.getState().removeBlock(a)

    const state = useGraphStore.getState()
    expect(state.blocks.map((x) => x.id)).toEqual([b])
    expect(state.edges).toEqual([])
  })

  it('setBlockParams merges into existing params rather than replacing them', () => {
    const id = useGraphStore.getState().addBlock('compressor', 0, 0)
    useGraphStore.getState().setBlockParams(id, { drive: 0.8 })
    useGraphStore.getState().setBlockParams(id, { tone: 9000 })

    const block = useGraphStore.getState().blocks.find((b) => b.id === id)
    expect(block?.params).toEqual({ drive: 0.8, tone: 9000 })
  })

  it('setBlockParams on one block never touches another block sharing the same param key', () => {
    const a = useGraphStore.getState().addBlock('compressor', 0, 0)
    const b = useGraphStore.getState().addBlock('compressor', 0, 1)
    useGraphStore.getState().setBlockParams(a, { drive: 0.9 })

    const blocks = useGraphStore.getState().blocks
    expect(blocks.find((x) => x.id === a)?.params).toEqual({ drive: 0.9 })
    expect(blocks.find((x) => x.id === b)?.params).toEqual({})
  })

  it('setBlockBypass sets the flag only on the targeted block', () => {
    const a = useGraphStore.getState().addBlock('compressor', 0, 0)
    const b = useGraphStore.getState().addBlock('eq', 0, 1)
    useGraphStore.getState().setBlockBypass(a, true)

    const blocks = useGraphStore.getState().blocks
    expect(blocks.find((x) => x.id === a)?.bypass).toBe(true)
    expect(blocks.find((x) => x.id === b)?.bypass).toBeUndefined()
  })

  it('connect adds a valid forward edge and rejects an invalid one', () => {
    const a = useGraphStore.getState().addBlock('compressor', 0, 0)
    const b = useGraphStore.getState().addBlock('eq', 0, 1)

    const ok = useGraphStore.getState().connect(jack(a), jack(b))
    expect(ok.ok).toBe(true)

    const bad = useGraphStore.getState().connect(jack(b), jack(a))
    expect(bad.ok).toBe(false)
    expect(useGraphStore.getState().edges).toHaveLength(1)
  })

  it('disconnect removes exactly the named edge', () => {
    const a = useGraphStore.getState().addBlock('compressor', 0, 0)
    const b = useGraphStore.getState().addBlock('eq', 0, 1)
    const result = useGraphStore.getState().connect(jack(a), jack(b))
    const edgeId = (result as { ok: true; id: string }).id

    useGraphStore.getState().disconnect(edgeId)

    expect(useGraphStore.getState().edges).toEqual([])
  })

  it('moveBlock repositions a block and auto-drops a cable that would go backward', () => {
    const a = useGraphStore.getState().addBlock('compressor', 0, 0)
    const b = useGraphStore.getState().addBlock('eq', 0, 1)
    const result = useGraphStore.getState().connect(jack(a), jack(b))
    const edgeId = (result as { ok: true; id: string }).id

    const { droppedEdgeIds } = useGraphStore.getState().moveBlock(a, 0, 5)

    expect(droppedEdgeIds).toEqual([edgeId])
    expect(useGraphStore.getState().edges).toEqual([])
    expect(useGraphStore.getState().blocks.find((x) => x.id === a)?.col).toBe(5)
  })

  it('setMasterLevel and setMasterMuted set independent fields', () => {
    useGraphStore.getState().setMasterLevel(0.6)
    useGraphStore.getState().setMasterMuted(true)
    const state = useGraphStore.getState()
    expect(state.masterLevel).toBe(0.6)
    expect(state.masterMuted).toBe(true)
  })

  it('loadGraph replaces the entire graph atomically', () => {
    useGraphStore.getState().addBlock('compressor', 0, 0)
    const blocks = [{ id: 'x', kind: 'eq' as const, row: 2, col: 7, params: {} }]
    const edges: EdgeInstance[] = []
    useGraphStore.getState().loadGraph(blocks, edges, 0.8, true)

    const state = useGraphStore.getState()
    expect(state.blocks).toEqual(blocks)
    expect(state.masterLevel).toBe(0.8)
    expect(state.masterMuted).toBe(true)
  })
})
