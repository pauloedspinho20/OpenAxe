// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { useGraphStore, type BlockInstance, type EdgeInstance } from './graphStore'
import { jack } from '../engine/gridConfig'

function block(id: string, kind: string, row: number, col: number): BlockInstance {
  return { id, kind: kind as BlockInstance['kind'], row, col, params: {} }
}

function edge(id: string, from: string, to: string, toPort = 0): EdgeInstance {
  return { id, from: { blockId: from, port: 0 }, to: { blockId: to, port: toPort } }
}

function loadGraph(blocks: BlockInstance[], edges: EdgeInstance[]) {
  useGraphStore.getState().loadGraph(blocks, edges, 1, false)
}

/** Compact projection of the current edge list, e.g. ['A->B', 'IN->A']. */
function edgeSummary(): string[] {
  return useGraphStore
    .getState()
    .edges.map((e) => `${e.from.blockId}->${e.to.blockId}`)
    .sort()
}

/** Assert the edge list equals exactly these pairs (order-insensitive - ids are random). */
function expectEdges(...pairs: string[]) {
  expect(edgeSummary()).toEqual([...pairs].sort())
}

describe('graphStore', () => {
  beforeEach(() => {
    useGraphStore.setState({
      blocks: [],
      edges: [],
      masterLevel: 1,
      masterMuted: false,
      tunerMuted: false,
    })
  })

  it('starts empty at unity master level, unmuted', () => {
    const state = useGraphStore.getState()
    expect(state.blocks).toEqual([])
    expect(state.edges).toEqual([])
    expect(state.masterLevel).toBe(1)
    expect(state.masterMuted).toBe(false)
    expect(state.tunerMuted).toBe(false)
  })

  it('addBlock appends a block with empty params at the given position', () => {
    const id = useGraphStore.getState().addBlock('compressor', 1, 2)
    const block = useGraphStore.getState().blocks.find((b) => b.id === id)
    expect(block).toEqual({ id, kind: 'compressor', row: 1, col: 2, params: {} })
  })

  // ── Semi-auto wiring (see autoWireEdges) ───────────────────────────────

  it('auto-wires the very first block to both the IN and OUT rails', () => {
    const id = useGraphStore.getState().addBlock('compressor', 1, 2)
    expectEdges(`IN->${id}`, `${id}->OUT`)
  })

  it('splices a new block into the middle of a cable that straddles its column', () => {
    loadGraph([block('a', 'compressor', 0, 1), block('b', 'eq', 0, 3)], [edge('ab', 'a', 'b')])
    const id = useGraphStore.getState().addBlock('noise-gate', 0, 2)
    expectEdges(`a->${id}`, `${id}->b`)
  })

  it('extends a chain right of the last block (OUT rail counts as an endpoint)', () => {
    loadGraph([block('a', 'compressor', 0, 2)], [edge('ao', 'a', 'OUT')])
    const id = useGraphStore.getState().addBlock('eq', 0, 5)
    expectEdges(`a->${id}`, `${id}->OUT`)
  })

  it('extends a chain left of the first block (IN rail counts as an endpoint)', () => {
    loadGraph([block('a', 'compressor', 0, 2)], [edge('ia', 'IN', 'a')])
    const id = useGraphStore.getState().addBlock('eq', 0, 0)
    expectEdges(`IN->${id}`, `${id}->a`)
  })

  it('splices the cable whose endpoints are on the row nearest the new cell', () => {
    loadGraph(
      [block('top', 'compressor', 0, 1), block('bottom', 'eq', 1, 2)],
      [edge('top-out', 'top', 'OUT'), edge('bottom-out', 'bottom', 'OUT')],
    )
    const id = useGraphStore.getState().addBlock('delay', 1, 4)
    expectEdges('top->OUT', `bottom->${id}`, `${id}->OUT`)
  })

  it('anchors an otherwise-orphaned block to IN when OUT is already taken', () => {
    loadGraph([block('a', 'compressor', 0, 7)], [edge('ao', 'a', 'OUT')])
    const id = useGraphStore.getState().addBlock('eq', 0, 2)
    expectEdges('a->OUT', `IN->${id}`)
  })

  it('connects a fresh unconnected pair by hand on a custom graph', () => {
    loadGraph([block('a', 'compressor', 0, 0), block('b', 'eq', 0, 1)], [])
    const ok = useGraphStore.getState().connect(jack('a'), jack('b'))
    expect(ok.ok).toBe(true)
    expect(useGraphStore.getState().edges).toHaveLength(1)
  })

  // ── Mutations ──────────────────────────────────────────────────────────

  it('removeBlock drops the block and every edge touching it', () => {
    loadGraph(
      [block('a', 'compressor', 0, 0), block('b', 'eq', 0, 1)],
      [edge('ia', 'IN', 'a'), edge('ab', 'a', 'b'), edge('bo', 'b', 'OUT')],
    )
    useGraphStore.getState().removeBlock('a')

    const state = useGraphStore.getState()
    expect(state.blocks.map((x) => x.id)).toEqual(['b'])
    expect(edgeSummary()).toEqual(['b->OUT'])
  })

  it('setBlockParams merges into existing params rather than replacing them', () => {
    const id = useGraphStore.getState().addBlock('compressor', 0, 0)
    useGraphStore.getState().setBlockParams(id, { drive: 0.8 })
    useGraphStore.getState().setBlockParams(id, { tone: 9000 })

    const block = useGraphStore.getState().blocks.find((b) => b.id === id)
    expect(block?.params).toEqual({ drive: 0.8, tone: 9000 })
  })

  it('setBlockParams on one block never touches another block sharing the same param key', () => {
    loadGraph([block('a', 'compressor', 0, 0), block('b', 'compressor', 0, 1)], [])
    useGraphStore.getState().setBlockParams('a', { drive: 0.9 })

    const blocks = useGraphStore.getState().blocks
    expect(blocks.find((x) => x.id === 'a')?.params).toEqual({ drive: 0.9 })
    expect(blocks.find((x) => x.id === 'b')?.params).toEqual({})
  })

  it('setBlockBypass sets the flag only on the targeted block', () => {
    loadGraph([block('a', 'compressor', 0, 0), block('b', 'eq', 0, 1)], [])
    useGraphStore.getState().setBlockBypass('a', true)

    const blocks = useGraphStore.getState().blocks
    expect(blocks.find((x) => x.id === 'a')?.bypass).toBe(true)
    expect(blocks.find((x) => x.id === 'b')?.bypass).toBeUndefined()
  })

  it('connect adds a valid forward edge and rejects an invalid one', () => {
    loadGraph([block('a', 'compressor', 0, 0), block('b', 'eq', 0, 1)], [])

    const ok = useGraphStore.getState().connect(jack('a'), jack('b'))
    expect(ok.ok).toBe(true)

    const bad = useGraphStore.getState().connect(jack('b'), jack('a'))
    expect(bad.ok).toBe(false)
    expect(useGraphStore.getState().edges).toHaveLength(1)
  })

  it('disconnect removes exactly the named edge', () => {
    loadGraph([block('a', 'compressor', 0, 0), block('b', 'eq', 0, 1)], [edge('ab', 'a', 'b')])
    useGraphStore.getState().disconnect('ab')
    expect(useGraphStore.getState().edges).toEqual([])
  })

  it('disconnectConnections removes every cable out of an output jack', () => {
    loadGraph(
      [block('a', 'compressor', 0, 0), block('b', 'eq', 0, 1), block('c', 'delay', 0, 2)],
      [edge('ab', 'a', 'b'), edge('ac', 'a', 'c')],
    )
    useGraphStore.getState().disconnectConnections(jack('a', 0), 'out')
    expect(useGraphStore.getState().edges).toEqual([])
  })

  it('disconnectConnections removes every cable into an input jack', () => {
    loadGraph(
      [block('a', 'compressor', 0, 0), block('b', 'eq', 0, 1), block('c', 'delay', 0, 3)],
      [edge('ab', 'a', 'b'), edge('cb', 'c', 'b')],
    )
    useGraphStore.getState().disconnectConnections(jack('b', 0), 'in')
    expect(useGraphStore.getState().edges).toEqual([])
  })

  it('moveBlock repositions a block and auto-drops a cable that would go backward', () => {
    loadGraph([block('a', 'compressor', 0, 0), block('b', 'eq', 0, 1)], [edge('ab', 'a', 'b')])

    const { droppedEdgeIds } = useGraphStore.getState().moveBlock('a', 0, 5)

    expect(droppedEdgeIds).toEqual(['ab'])
    expect(useGraphStore.getState().edges).toEqual([])
    expect(useGraphStore.getState().blocks.find((x) => x.id === 'a')?.col).toBe(5)
  })

  it('setMasterLevel, setMasterMuted and setTunerMuted set independent fields', () => {
    useGraphStore.getState().setMasterLevel(0.6)
    useGraphStore.getState().setMasterMuted(true)
    useGraphStore.getState().setTunerMuted(true)
    const state = useGraphStore.getState()
    expect(state.masterLevel).toBe(0.6)
    expect(state.masterMuted).toBe(true)
    expect(state.tunerMuted).toBe(true)
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
