// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGraphStore, type BlockInstance, type EdgeInstance } from '../state/graphStore'
import { bindGraphRig, type GraphRigControls } from './bindGraphRig'
import { jack } from './gridConfig'
import { useEngineVersion } from '../state/engineVersion'

function createMockRig(): {
  [K in keyof GraphRigControls]: ReturnType<typeof vi.fn<GraphRigControls[K]>>
} {
  let nextId = 0
  return {
    addBlock: vi.fn(async (_kind, _row, _col, id) => id ?? `block-${++nextId}`),
    removeBlock: vi.fn(async () => undefined),
    moveBlock: vi.fn(() => ({ ok: true })),
    setBlockParams: vi.fn(),
    getBlock: vi.fn(() => null),
    connect: vi.fn((_from, _to, id) => ({ ok: true, id: id ?? `edge-${++nextId}` })),
    disconnect: vi.fn(),
    setMasterLevel: vi.fn(),
    setMasterMuted: vi.fn(),
    setTunerMuted: vi.fn(),
    listBlockIds: vi.fn(() => []),
    listEdgeIds: vi.fn(() => []),
  }
}

function block(id: string, kind: string, row: number, col: number): BlockInstance {
  return { id, kind: kind as BlockInstance['kind'], row, col, params: {} }
}

/**
 * addBlock returns null only for a duplicate Send/Return kind (strictly 1:1,
 * issue #274) - these tests never add those, so the id is always present.
 */
function addBlock(kind: BlockInstance['kind'], row: number, col: number): string {
  const id = useGraphStore.getState().addBlock(kind, row, col)
  if (id === null) throw new Error(`addBlock('${kind}') refused`)
  return id
}

function loadGraph(blocks: BlockInstance[], edges: EdgeInstance[]) {
  useGraphStore.getState().loadGraph(blocks, edges, 1, false)
}

/**
 * Bindings made via bind() are undone after each test, so one test's
 * subscription can't keep reconciling (and bumping the engine version) in the
 * next.
 */
const unbinds: Array<() => void> = []
function bind(rig: GraphRigControls): () => void {
  const unbind = bindGraphRig(useGraphStore, rig)
  unbinds.push(unbind)
  return unbind
}

/** Let the internal reconcile promise chain settle. */
async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('bindGraphRig', () => {
  afterEach(() => {
    for (const unbind of unbinds.splice(0)) unbind()
  })

  beforeEach(() => {
    useGraphStore.setState({
      blocks: [],
      edges: [],
      masterLevel: 1,
      masterMuted: false,
      tunerMuted: false,
    })
  })

  it('does not bump the engine version on a param-only change', async () => {
    const rig = createMockRig()
    const id = addBlock('compressor', 0, 1)
    rig.listBlockIds.mockImplementation(() => [id])
    rig.listEdgeIds.mockImplementation(() => useGraphStore.getState().edges.map((e) => e.id))
    bind(rig)
    await flush()
    const before = useEngineVersion.getState().version

    useGraphStore.getState().setBlockParams(id, { threshold: -20 })
    await flush()

    expect(rig.setBlockParams).toHaveBeenLastCalledWith(id, { threshold: -20 })
    expect(useEngineVersion.getState().version).toBe(before)
  })

  it('re-sends params only for the block that changed', async () => {
    const rig = createMockRig()
    const a = addBlock('compressor', 0, 1)
    const b = addBlock('eq', 0, 3)
    rig.listBlockIds.mockImplementation(() => [a, b])
    rig.listEdgeIds.mockImplementation(() => useGraphStore.getState().edges.map((e) => e.id))
    bind(rig)
    await flush()
    rig.setBlockParams.mockClear()

    useGraphStore.getState().setBlockParams(a, { threshold: -10 })
    await flush()

    expect(rig.setBlockParams).toHaveBeenCalledTimes(1)
    expect(rig.setBlockParams).toHaveBeenCalledWith(a, { threshold: -10 })
  })

  it('re-applies params to a block replaced under the same id', async () => {
    const rig = createMockRig()
    const a = addBlock('compressor', 0, 1)
    let instance = { tag: 'first' }
    rig.getBlock.mockImplementation(() => instance as never)
    rig.listBlockIds.mockImplementation(() => [a])
    rig.listEdgeIds.mockImplementation(() => useGraphStore.getState().edges.map((e) => e.id))
    bind(rig)
    await flush()
    rig.setBlockParams.mockClear()

    instance = { tag: 'second' }
    useGraphStore.getState().setMasterLevel(0.5)
    await flush()

    expect(rig.setBlockParams).toHaveBeenCalledWith(a, expect.anything())
  })

  it('bumps the engine version on a first bypass toggle, not on a later param tick', async () => {
    const rig = createMockRig()
    const a = addBlock('compressor', 0, 1)
    rig.listBlockIds.mockImplementation(() => [a])
    rig.listEdgeIds.mockImplementation(() => useGraphStore.getState().edges.map((e) => e.id))
    bind(rig)
    await flush()

    const v0 = useEngineVersion.getState().version
    useGraphStore.getState().setBlockBypass(a, true)
    await flush()
    expect(useEngineVersion.getState().version).toBe(v0 + 1)

    useGraphStore.getState().setBlockParams(a, { threshold: -5 })
    await flush()
    expect(useEngineVersion.getState().version).toBe(v0 + 1)
  })

  it('does not bump on the first param tick after a move', async () => {
    const rig = createMockRig()
    const a = addBlock('compressor', 0, 1)
    useGraphStore.getState().setBlockBypass(a, false)
    rig.listBlockIds.mockImplementation(() => [a])
    rig.listEdgeIds.mockImplementation(() => useGraphStore.getState().edges.map((e) => e.id))
    bind(rig)
    await flush()
    useGraphStore.getState().moveBlock(a, 0, 4)
    await flush()

    const before = useEngineVersion.getState().version
    useGraphStore.getState().setBlockParams(a, { threshold: -5 })
    await flush()
    expect(useEngineVersion.getState().version).toBe(before)
  })

  it('applies the current state immediately on bind', async () => {
    const rig = createMockRig()
    bind(rig)
    await flush()

    expect(rig.setMasterLevel).toHaveBeenCalledWith(1)
    expect(rig.setMasterMuted).toHaveBeenCalledWith(false)
    expect(rig.setTunerMuted).toHaveBeenCalledWith(false)
  })

  it('adds a block that appears in the store but not yet in the rig', async () => {
    const rig = createMockRig()
    bind(rig)
    await flush()

    const id = addBlock('compressor', 0, 0)
    await flush()

    expect(rig.addBlock).toHaveBeenCalledWith('compressor', 0, 0, id)
  })

  it('removes a block dropped from the store', async () => {
    const rig = createMockRig()
    const id = addBlock('compressor', 0, 0)
    rig.listBlockIds.mockReturnValue([id])
    bind(rig)
    await flush()

    useGraphStore.getState().removeBlock(id)
    await flush()

    expect(rig.removeBlock).toHaveBeenCalledWith(id)
  })

  it('pushes params for every block on each reconcile', async () => {
    const rig = createMockRig()
    const id = addBlock('compressor', 0, 0)
    bind(rig)
    await flush()
    rig.setBlockParams.mockClear()

    useGraphStore.getState().setBlockParams(id, { drive: 0.8 })
    await flush()

    expect(rig.setBlockParams).toHaveBeenCalledWith(id, { drive: 0.8 })
  })

  it('connects a new edge from the store', async () => {
    const rig = createMockRig()
    bind(rig)
    await flush()
    loadGraph([block('a', 'compressor', 0, 0), block('b', 'eq', 0, 1)], [])
    await flush()

    const result = useGraphStore.getState().connect(jack('a'), jack('b'))
    await flush()

    expect(result.ok).toBe(true)
    expect(rig.connect).toHaveBeenCalledWith(jack('a'), jack('b'), (result as { id: string }).id)
  })

  it('disconnects an edge removed from the store', async () => {
    const rig = createMockRig()
    loadGraph(
      [block('a', 'compressor', 0, 0), block('b', 'eq', 0, 1)],
      [{ id: 'ab', from: jack('a'), to: jack('b') }],
    )
    rig.listEdgeIds.mockReturnValue(['ab'])
    bind(rig)
    await flush()

    useGraphStore.getState().disconnect('ab')
    await flush()

    expect(rig.disconnect).toHaveBeenCalledWith('ab')
  })

  it('skips moveBlock when only params change (issue #62)', async () => {
    const rig = createMockRig()
    const id = addBlock('compressor', 0, 0)
    rig.listBlockIds.mockReturnValue([id])
    bind(rig)
    await flush()
    rig.moveBlock.mockClear()

    useGraphStore.getState().setBlockParams(id, { drive: 0.8 })
    await flush()

    expect(rig.moveBlock).not.toHaveBeenCalled()
    expect(rig.setBlockParams).toHaveBeenCalledWith(id, { drive: 0.8 })
  })

  it('still calls moveBlock when a block is relocated (issue #62)', async () => {
    const rig = createMockRig()
    const id = addBlock('compressor', 0, 0)
    rig.listBlockIds.mockReturnValue([id])
    bind(rig)
    await flush()
    rig.moveBlock.mockClear()

    useGraphStore.getState().moveBlock(id, 2, 3)
    await flush()

    expect(rig.moveBlock).toHaveBeenCalledWith(id, 2, 3)
  })

  it('pushes the tuner mute flag', async () => {
    const rig = createMockRig()
    bind(rig)
    await flush()

    useGraphStore.getState().setTunerMuted(true)
    await flush()

    expect(rig.setTunerMuted).toHaveBeenCalledWith(true)
  })

  it('stops applying updates once unbound', async () => {
    const rig = createMockRig()
    const unbind = bind(rig)
    await flush()
    unbind()
    rig.addBlock.mockClear()

    addBlock('compressor', 0, 0)
    await flush()

    expect(rig.addBlock).not.toHaveBeenCalled()
  })
})
