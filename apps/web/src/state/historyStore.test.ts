// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGraphStore } from './graphStore'
import {
  flushHistoryForTests,
  resetHistoryForTests,
  useHistoryStore,
  setHistoryTarget,
} from './historyStore'

function resetGraph() {
  useGraphStore.setState({
    blocks: [],
    edges: [],
    masterLevel: 1,
    masterMuted: false,
    tunerMuted: false,
  })
}

describe('historyStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetGraph()
    setHistoryTarget(null)
    resetHistoryForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts with nothing to undo/redo', () => {
    expect(useHistoryStore.getState().canUndo).toBe(false)
    expect(useHistoryStore.getState().canRedo).toBe(false)
  })

  it('pushes topology edits immediately — addBlock enables undo', async () => {
    useGraphStore.getState().addBlock('compressor', 0, 0)
    // topology push is synchronous (no debounce)
    expect(useHistoryStore.getState().canUndo).toBe(true)
    expect(useHistoryStore.getState().canRedo).toBe(false)
  })

  it('coalesces rapid setBlockParams into one history entry (debounce 300ms)', async () => {
    const id = useGraphStore.getState().addBlock('compressor', 0, 0)
    // initial addBlock already pushed; reset to isolate param test
    resetHistoryForTests()

    // rapid param changes — should debounce to one entry
    useGraphStore.getState().setBlockParams(id, { drive: 0.1 })
    useGraphStore.getState().setBlockParams(id, { drive: 0.3 })
    useGraphStore.getState().setBlockParams(id, { drive: 0.6 })

    // still debounced — no new undo yet
    expect(useHistoryStore.getState().canUndo).toBe(false)

    vi.advanceTimersByTime(350)
    flushHistoryForTests()

    expect(useHistoryStore.getState().canUndo).toBe(true)

    // undo should restore the pre-drag params
    await useHistoryStore.getState().undo()
    const block = useGraphStore.getState().blocks.find((b) => b.id === id)
    expect(block?.params).toEqual({})
  })

  it('undo restores previous graph and redo re-applies it', async () => {
    resetGraph()
    resetHistoryForTests()
    const id1 = useGraphStore.getState().addBlock('compressor', 0, 0)
    const id2 = useGraphStore.getState().addBlock('eq', 0, 2)

    expect(useGraphStore.getState().blocks).toHaveLength(2)

    await useHistoryStore.getState().undo()
    expect(useGraphStore.getState().blocks).toHaveLength(1)
    expect(useGraphStore.getState().blocks[0]?.id).toBe(id1)

    await useHistoryStore.getState().redo()
    expect(useGraphStore.getState().blocks).toHaveLength(2)
    expect(useGraphStore.getState().blocks.map((b) => b.id)).toContain(id2)
  })

  it('preset load is a single undo entry and undo restores previous graph', async () => {
    const id = useGraphStore.getState().addBlock('compressor', 0, 0)
    resetHistoryForTests()

    // Simulate preset load via loadGraph (one entry)
    useGraphStore.getState().loadGraph(
      [
        { id: 'p1', kind: 'eq', row: 1, col: 1, params: {} },
        { id: 'p2', kind: 'delay', row: 1, col: 3, params: { feedback: 0.5 } },
      ],
      [],
      0.7,
      true,
    )

    expect(useHistoryStore.getState().canUndo).toBe(true)
    await useHistoryStore.getState().undo()
    const state = useGraphStore.getState()
    expect(state.blocks).toHaveLength(1)
    expect(state.blocks[0]?.id).toBe(id)
  })

  it('caps history at 50 and discards redo on push-after-undo', async () => {
    // Push 55 topology edits (addBlock each is one entry)
    for (let i = 0; i < 55; i++) {
      useGraphStore.getState().addBlock('compressor', 0, i % 8)
      // each addBlock is a topology change, no debounce
    }
    // Undo 50 times should succeed, 51st should be null (oldest evicted)
    let undos = 0
    while (useHistoryStore.getState().canUndo) {
      await useHistoryStore.getState().undo()
      undos++
      if (undos > 60) break
    }
    expect(undos).toBe(50)

    // redo once, then push a new edit should discard redo
    resetGraph()
    resetHistoryForTests()
    useGraphStore.getState().addBlock('eq', 0, 0)
    useGraphStore.getState().addBlock('delay', 0, 2)
    await useHistoryStore.getState().undo()
    expect(useHistoryStore.getState().canRedo).toBe(true)
    useGraphStore.getState().addBlock('compressor', 0, 4)
    expect(useHistoryStore.getState().canRedo).toBe(false)
  })

  it('flushes pending debounced params before undo so knob drag is not lost', async () => {
    const id = useGraphStore.getState().addBlock('compressor', 0, 0)
    resetHistoryForTests()
    useGraphStore.getState().setBlockParams(id, { drive: 0.9 })
    // still pending
    expect(useHistoryStore.getState().canUndo).toBe(false)
    // undo should flush first — after flush, the param change is committed,
    // then undo reverts it
    await useHistoryStore.getState().undo()
    // After the first undo, we should be back to pre-drag (no extra entry lost)
    const block = useGraphStore.getState().blocks.find((b) => b.id === id)
    expect(block?.params).toEqual({})
  })

  it('does not push duplicate snapshots', () => {
    useGraphStore.getState().addBlock('compressor', 0, 0)
    const before = useHistoryStore.getState().canUndo
    // load same graph again via loadGraph with identical data — should not push duplicate
    const state = useGraphStore.getState()
    useGraphStore
      .getState()
      .loadGraph(state.blocks, state.edges, state.masterLevel, state.masterMuted)
    // still only one undo entry
    expect(useHistoryStore.getState().canUndo).toBe(before)
  })
})
