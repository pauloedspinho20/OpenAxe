// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GraphRig, jack } from './GraphRig'
import { IN_RAIL, OUT_RAIL } from './gridConfig'
import { RigWorkletNode, type RigModelInfo } from './RigWorkletNode'

/**
 * The web GraphRig is a thin driver over the single rig worklet (issue #55) -
 * it keeps block/edge bookkeeping and UI validation, then forwards every
 * mutation to RigWorkletNode's message port. These tests drive it against a
 * mock RigWorkletNode (mirroring NativeGraphRig.test.ts's mock bridge) so no
 * AudioContext or Web Audio is involved.
 */

function makeWorklet() {
  const node = { connect: vi.fn(), disconnect: vi.fn() }
  const calls = {
    addBlock: vi.fn(async () => undefined),
    removeBlock: vi.fn(async () => undefined),
    moveBlock: vi.fn(async () => undefined),
    connect: vi.fn(async () => ({ ok: true })),
    disconnect: vi.fn(async () => undefined),
    setParam: vi.fn(),
    setBypass: vi.fn(),
    setTrim: vi.fn(),
    setMasterLevel: vi.fn(),
    setMasterMuted: vi.fn(),
    setTunerMuted: vi.fn(),
    loadModel: vi.fn(async () => ({ slimmable: false, slimmableBreakpoints: [] })),
    unloadModel: vi.fn(async () => undefined),
    setSlimSize: vi.fn(async () => undefined),
    loadIr: vi.fn(async () => undefined),
    unloadIr: vi.fn(async () => undefined),
    meters: vi.fn(async () => ({})),
    inputMeters: vi.fn(async () => ({})),
    dispose: vi.fn(async () => undefined),
  }
  const worklet = { node, ...calls } as unknown as RigWorkletNode
  return { calls, worklet }
}

vi.mock('./RigWorkletNode', () => ({
  RigWorkletNode: { create: vi.fn() },
}))

async function createRig() {
  const { calls, worklet } = makeWorklet()
  vi.mocked(RigWorkletNode.create).mockResolvedValueOnce(worklet)
  const rig = await GraphRig.create({ sampleRate: 48000 } as AudioContext)
  return { calls, worklet, rig }
}

describe('GraphRig', () => {
  let calls: ReturnType<typeof makeWorklet>['calls']
  let rig: GraphRig

  beforeEach(async () => {
    ;({ calls, rig } = await createRig())
  })

  // GraphRig.create() starts a 50ms meter-poll interval; without this the
  // timer outlives every test and keeps calling into a torn-down mock. It
  // only bites when the suite is slower than one tick (CI, not a single
  // file locally), which is why it surfaced as flaky unhandled errors.
  // dispose() is idempotent, so the test that calls it explicitly is fine.
  afterEach(async () => {
    await rig.dispose()
  })

  it('starts with no blocks or edges', () => {
    expect(rig.listBlockIds()).toEqual([])
    expect(rig.listEdgeIds()).toEqual([])
  })

  it('adds a block, mirrors it to the worklet, and can look it up', async () => {
    const id = await rig.addBlock('mixer', 1, 2, 'm1')
    expect(id).toBe('m1')
    expect(calls.addBlock).toHaveBeenCalledWith('m1', 'mixer', 1, 2)
    expect(rig.getBlockPosition(id)).toEqual({ row: 1, col: 2 })
    expect(rig.getBlock(id)?.kind).toBe('mixer')
  })

  it('auto-generates an id when none is given', async () => {
    const id = await rig.addBlock('delay', 0, 0)
    expect(id).toMatch(/^block-/)
    expect(calls.addBlock).toHaveBeenCalledWith(id, 'delay', 0, 0)
  })

  it('getBlockAnalyser returns a Web-Audio-free analyser reflecting the block peak', async () => {
    const id = await rig.addBlock('mixer', 0, 0)
    expect(rig.getBlockAnalyser('nope')).toBeNull()

    const first = rig.getBlockAnalyser(id)
    const second = rig.getBlockAnalyser(id)
    expect(first).not.toBeNull()
    expect(second).toBe(first)
    expect(first).toHaveProperty('fftSize')

    const analyser = first as unknown as {
      getByteTimeDomainData(bytes: Uint8Array): void
    }
    const bytes = new Uint8Array(256)
    rig.updateMeter(id, 0)
    analyser.getByteTimeDomainData(bytes)
    let peak = 0
    for (const b of bytes) peak = Math.max(peak, Math.abs(b - 128) / 128)
    expect(peak).toBeLessThan(0.1)

    rig.updateMeter(id, 1)
    analyser.getByteTimeDomainData(bytes)
    peak = 0
    for (const b of bytes) peak = Math.max(peak, Math.abs(b - 128) / 128)
    expect(peak).toBeGreaterThan(0.9)
  })

  it('connects a valid IN->block->OUT chain, mapping rails and forwarding to the worklet', async () => {
    await rig.addBlock('mixer', 0, 1, 'm1')

    const inEdge = rig.connect(jack(IN_RAIL), jack('m1'))
    expect(inEdge.ok).toBe(true)
    const outEdge = rig.connect(jack('m1'), jack(OUT_RAIL))
    expect(outEdge.ok).toBe(true)

    expect(calls.connect).toHaveBeenCalledWith(
      { blockId: IN_RAIL, port: 0 },
      { blockId: 'm1', port: 0 },
      inEdge.ok ? inEdge.id : '',
    )
    expect(rig.listEdgeIds()).toHaveLength(2)
  })

  it('rejects an invalid connect without forwarding to the worklet', async () => {
    await rig.addBlock('mixer', 0, 1, 'm1')
    const result = rig.connect(jack('m1'), jack('m1'))
    expect(result.ok).toBe(false)
    expect(calls.connect).not.toHaveBeenCalled()
  })

  it('rejects a second cable into an already-occupied jack', async () => {
    const a = await rig.addBlock('mixer', 0, 0)
    const b = await rig.addBlock('mixer', 0, 1)
    const c = await rig.addBlock('mixer', 0, 1)
    expect(rig.connect(jack(a), jack(b)).ok).toBe(true)
    expect(rig.connect(jack(c), jack(b)).ok).toBe(false)
  })

  it('disconnect removes an edge and forwards to the worklet', async () => {
    const a = await rig.addBlock('mixer', 0, 0)
    const b = await rig.addBlock('mixer', 0, 1)
    const edge = rig.connect(jack(a), jack(b)) as { ok: true; id: string }

    rig.disconnect(edge.id)
    expect(rig.listEdgeIds()).toHaveLength(0)
    expect(calls.disconnect).toHaveBeenCalledWith(edge.id)
  })

  it('removing a block also drops every edge that touched it', async () => {
    const a = await rig.addBlock('mixer', 0, 0)
    const b = await rig.addBlock('mixer', 0, 1)
    const c = await rig.addBlock('mixer', 0, 2)
    rig.connect(jack(a), jack(b))
    rig.connect(jack(b), jack(c))

    await rig.removeBlock('nonexistent')
    await rig.removeBlock(b)

    expect(rig.listBlockIds().sort()).toEqual([a, c].sort())
    expect(rig.listEdgeIds()).toEqual([])
    expect(calls.removeBlock).toHaveBeenCalledWith(b)
  })

  it('moving a block to a column that would break a cable is rejected and not forwarded', async () => {
    const a = await rig.addBlock('mixer', 0, 0)
    const b = await rig.addBlock('mixer', 0, 1)
    rig.connect(jack(a), jack(b))

    const bad = rig.moveBlock(a, 0, 5)
    expect(bad.ok).toBe(false)
    expect(calls.moveBlock).not.toHaveBeenCalled()

    const good = rig.moveBlock(a, 1, 0)
    expect(good.ok).toBe(true)
    expect(calls.moveBlock).toHaveBeenCalledWith(a, 1, 0)
  })

  it('routes multiple cables into distinct Mixer ports', async () => {
    const a = await rig.addBlock('mixer', 0, 0)
    const b = await rig.addBlock('mixer', 1, 0)
    const mixer = await rig.addBlock('mixer', 0, 1)
    expect(rig.connect(jack(a), jack(mixer, 0)).ok).toBe(true)
    expect(rig.connect(jack(b), jack(mixer, 1)).ok).toBe(true)
    expect(rig.listEdgeIds()).toHaveLength(2)
  })

  it('setBlockParams delegates each entry to the worklet by symbol', async () => {
    await rig.addBlock('reverb', 0, 0, 'r1')
    rig.setBlockParams('r1', { mix: 0.5, decay: '3.2' })
    expect(calls.setParam).toHaveBeenCalledWith('r1', 'mix', 0.5)
    expect(calls.setParam).toHaveBeenCalledWith('r1', 'decay', 3.2)
  })

  it('the Input/Output knobs become core block trims, not calibration params', async () => {
    await rig.addBlock('amp', 0, 0, 'a1')
    const block = rig.getBlock('a1') as unknown as { setParams(p: Record<string, unknown>): void }
    block.setParams({ input_level: 0.5, output_level: 1.2, gain: 0.3 })

    expect(calls.setTrim).toHaveBeenCalledWith('a1', 0.5, 1.2)
    const paramKeys = calls.setParam.mock.calls.map((c) => c[1] as string)
    expect(paramKeys).toEqual(['gain'])
  })

  it('setBypass forwards to the worklet', async () => {
    await rig.addBlock('delay', 0, 0, 'd1')
    const block = rig.getBlock('d1') as unknown as { setBypass(b: boolean): void }
    block.setBypass(true)
    expect(calls.setBypass).toHaveBeenCalledWith('d1', true)
  })

  it('counts only Amp/Cab blocks with an actual model/IR loaded', async () => {
    const ampId = await rig.addBlock('amp', 0, 0)
    await rig.addBlock('cab', 0, 1)
    await rig.addBlock('mixer', 0, 2)
    expect(rig.countActiveHeavyBlocks()).toBe(0)

    const amp = rig.getBlock(ampId) as unknown as {
      loadModel(
        json: string,
        s: number | undefined,
        i: { id: string; name: string },
      ): Promise<RigModelInfo>
    }
    await amp.loadModel('{}', undefined, { id: 'm1', name: 'Model' })
    expect(rig.countActiveHeavyBlocks()).toBe(1)
  })

  it('master level/mute and tuner mute forward to the worklet', () => {
    rig.setMasterLevel(0.5)
    expect(calls.setMasterLevel).toHaveBeenCalledWith(0.5)
    rig.setMasterMuted(true)
    expect(calls.setMasterMuted).toHaveBeenCalledWith(true)
    rig.setTunerMuted(true)
    expect(calls.setTunerMuted).toHaveBeenCalledWith(true)
  })

  it('dispose is idempotent, clears state, and disposes the worklet', async () => {
    await rig.addBlock('mixer', 0, 0)
    await rig.dispose()
    await rig.dispose()
    expect(rig.listBlockIds()).toEqual([])
    expect(rig.listEdgeIds()).toEqual([])
    expect(calls.dispose).toHaveBeenCalledTimes(1)
  })
})
