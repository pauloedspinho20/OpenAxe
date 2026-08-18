import { describe, expect, it, vi } from 'vitest'
import { IN_RAIL, OUT_RAIL, jack } from '../engine/gridConfig'
import { NativeGraphRig } from './NativeGraphRig'
import type { NamStudioBridge } from './namStudio'

/** A mock bridge recording calls, cast loosely (tests only touch what rigs use). */
function makeBridge() {
  const calls = {
    addBlock: vi.fn(async (args: { id?: string }) => ({ ok: true, id: args.id })),
    removeBlock: vi.fn(async () => ({ ok: true })),
    moveBlock: vi.fn(async () => ({ ok: true })),
    connect: vi.fn(async () => ({ ok: true, id: 'edge-x' })),
    disconnect: vi.fn(async () => ({ ok: true })),
    setParam: vi.fn(async (_args: { key: string }) => ({ ok: true })),
    loadModelJson: vi.fn(async () => ({ ok: true, result: 0 })),
    unloadModel: vi.fn(async () => ({ ok: true })),
    setBypass: vi.fn(async () => ({ ok: true })),
    setBlockTrim: vi.fn(async () => ({ ok: true })),
    setMasterLevel: vi.fn(async () => ({ ok: true })),
    setMasterMuted: vi.fn(async () => ({ ok: true })),
    setTunerMuted: vi.fn(async () => ({ ok: true })),
  }
  return { calls, bridge: calls as unknown as NamStudioBridge }
}

describe('NativeGraphRig', () => {
  it('addBlock creates a block and mirrors it to the bridge with the given id', async () => {
    const { calls, bridge } = makeBridge()
    const rig = new NativeGraphRig(bridge)

    const id = await rig.addBlock('delay', 0, 2, 'd1')
    expect(id).toBe('d1')
    expect(calls.addBlock).toHaveBeenCalledWith({ kind: 'delay', row: 0, col: 2, id: 'd1' })
    expect(rig.listBlockIds()).toEqual(['d1'])
    expect(rig.getBlockPosition('d1')).toEqual({ row: 0, col: 2 })
  })

  it('auto-generates an id when none is given', async () => {
    const { bridge } = makeBridge()
    const rig = new NativeGraphRig(bridge)
    const id = await rig.addBlock('mixer', 0, 0)
    expect(id).toMatch(/^block-/)
    expect(rig.listBlockIds()).toEqual([id])
  })

  it('connects a valid IN->block->OUT chain, mapping rails to core sentinels', async () => {
    const { calls, bridge } = makeBridge()
    const rig = new NativeGraphRig(bridge)
    await rig.addBlock('mixer', 0, 1, 'm1')

    const inEdge = rig.connect(jack(IN_RAIL), jack('m1'))
    expect(inEdge.ok).toBe(true)
    const outEdge = rig.connect(jack('m1'), jack(OUT_RAIL))
    expect(outEdge.ok).toBe(true)

    expect(calls.connect).toHaveBeenCalledWith({
      fromId: -1,
      fromPort: 0,
      toId: 'm1',
      toPort: 0,
      id: inEdge.ok ? inEdge.id : '',
    })
    expect(calls.connect).toHaveBeenCalledWith({
      fromId: 'm1',
      fromPort: 0,
      toId: -2,
      toPort: 0,
      id: outEdge.ok ? outEdge.id : '',
    })
    expect(rig.listEdgeIds()).toHaveLength(2)
  })

  it('rejects an invalid connect without touching the bridge', async () => {
    const { calls, bridge } = makeBridge()
    const rig = new NativeGraphRig(bridge)
    await rig.addBlock('mixer', 0, 1, 'm1')

    // Same block (self-connect) - invalid.
    const result = rig.connect(jack('m1'), jack('m1'))
    expect(result.ok).toBe(false)
    expect(calls.connect).not.toHaveBeenCalled()
  })

  it('disconnect removes an edge', async () => {
    const { calls, bridge } = makeBridge()
    const rig = new NativeGraphRig(bridge)
    await rig.addBlock('mixer', 0, 1, 'm1')
    const edge = rig.connect(jack(IN_RAIL), jack('m1'))
    expect(edge.ok && edge.id).toBeTruthy()
    const edgeId = edge.ok ? edge.id : ''

    rig.disconnect(edgeId)
    expect(rig.listEdgeIds()).toHaveLength(0)
    expect(calls.disconnect).toHaveBeenCalledWith({ edgeId })
  })

  it('removeBlock drops touching edges', async () => {
    const { calls, bridge } = makeBridge()
    const rig = new NativeGraphRig(bridge)
    await rig.addBlock('mixer', 0, 1, 'm1')
    rig.connect(jack(IN_RAIL), jack('m1'))
    rig.connect(jack('m1'), jack(OUT_RAIL))

    await rig.removeBlock('m1')
    expect(rig.listBlockIds()).toHaveLength(0)
    expect(rig.listEdgeIds()).toHaveLength(0)
    expect(calls.removeBlock).toHaveBeenCalledWith({ blockId: 'm1' })
  })

  it('moveBlock validates against cable ordering before mirroring', async () => {
    const { calls, bridge } = makeBridge()
    const rig = new NativeGraphRig(bridge)
    await rig.addBlock('eq', 0, 1, 'e1')
    await rig.addBlock('delay', 0, 3, 'd1')
    rig.connect(jack('e1'), jack('d1'))

    // Moving e1 to the right of d1 would break the cable -> rejected.
    const bad = rig.moveBlock('e1', 0, 5)
    expect(bad.ok).toBe(false)
    expect(calls.moveBlock).not.toHaveBeenCalled()

    const good = rig.moveBlock('e1', 1, 2)
    expect(good.ok).toBe(true)
    expect(calls.moveBlock).toHaveBeenCalledWith({ blockId: 'e1', row: 1, col: 2 })
  })

  it('setBlockParams delegates each entry to the bridge by symbol', async () => {
    const { calls, bridge } = makeBridge()
    const rig = new NativeGraphRig(bridge)
    await rig.addBlock('reverb', 0, 0, 'r1')

    rig.setBlockParams('r1', { mix: 0.5, decay: '3.2' })
    expect(calls.setParam).toHaveBeenCalledWith({ blockId: 'r1', key: 'mix', value: 0.5 })
    expect(calls.setParam).toHaveBeenCalledWith({ blockId: 'r1', key: 'decay', value: 3.2 })
  })

  it('countActiveHeavyBlocks reflects loaded NAM models', async () => {
    const { bridge } = makeBridge()
    const rig = new NativeGraphRig(bridge)
    await rig.addBlock('amp', 0, 0, 'a1')
    await rig.addBlock('delay', 0, 1, 'd1')

    expect(rig.countActiveHeavyBlocks()).toBe(0)
    const block = rig.getBlock('a1') as unknown as {
      loadModel(json: string, s: number | undefined, i: { id: string; name: string }): Promise<void>
    }
    await block.loadModel('{"metadata":{}}', undefined, { id: 'm', name: 'M' })
    expect(rig.countActiveHeavyBlocks()).toBe(1)
  })

  it('getBlockAnalyser returns a Web-Audio-free analyser reflecting the native peak', async () => {
    const { bridge } = makeBridge()
    const rig = new NativeGraphRig(bridge)
    await rig.addBlock('mixer', 0, 0, 'm1')

    const analyser = rig.getBlockAnalyser('m1')
    expect(analyser).not.toBeNull()
    expect(analyser).toHaveProperty('fftSize')
    expect(analyser!.getFloatTimeDomainData).toBeTypeOf('function')

    // Silent block -> meter reads near-zero peak.
    rig.updateMeter('m1', 0)
    const bytes = new Uint8Array(256)
    analyser!.getByteTimeDomainData(bytes)
    let peak = 0
    for (const b of bytes) peak = Math.max(peak, Math.abs(b - 128) / 128)
    expect(peak).toBeLessThan(0.1)

    // Full-scale block -> meter reads ~full.
    rig.updateMeter('m1', 1)
    analyser!.getByteTimeDomainData(bytes)
    peak = 0
    for (const b of bytes) peak = Math.max(peak, Math.abs(b - 128) / 128)
    expect(peak).toBeGreaterThan(0.9)

    // Unknown block -> null.
    expect(rig.getBlockAnalyser('nope')).toBeNull()
  })

  it('setBypass forwards to the bridge (issue #42)', async () => {
    const { calls, bridge } = makeBridge()
    const rig = new NativeGraphRig(bridge)
    await rig.addBlock('delay', 0, 0, 'd1')

    const block = rig.getBlock('d1') as unknown as { setBypass(bypassed: boolean): void }
    block.setBypass(true)
    expect(calls.setBypass).toHaveBeenCalledWith({ blockId: 'd1', bypassed: true })

    block.setBypass(false)
    expect(calls.setBypass).toHaveBeenCalledWith({ blockId: 'd1', bypassed: false })
  })

  it('the Input/Output knobs become core block trims, not amp calibration params', async () => {
    const { calls, bridge } = makeBridge()
    const rig = new NativeGraphRig(bridge)
    await rig.addBlock('amp', 0, 0, 'a1')

    const block = rig.getBlock('a1') as unknown as { setParams(p: Record<string, number>): void }
    block.setParams({ input_level: 0.5, output_level: 1.2, gain: 0.3 })

    // Trims go to setBlockTrim in one call...
    expect(calls.setBlockTrim).toHaveBeenCalledWith({ blockId: 'a1', input: 0.5, output: 1.2 })
    // ...and never to setParam, where they would overwrite the loaded NAM
    // model's dBu calibration instead of trimming the block.
    const paramKeys = calls.setParam.mock.calls.map((c) => (c[0] as { key: string }).key)
    expect(paramKeys).toEqual(['gain'])

    // One knob moving alone leaves the other trim untouched.
    calls.setBlockTrim.mockClear()
    block.setParams({ output_level: 0.25 })
    expect(calls.setBlockTrim).toHaveBeenCalledWith({ blockId: 'a1', output: 0.25 })
  })

  it('master level/mute and tuner mute forward to the bridge (issue #42)', () => {
    const { calls, bridge } = makeBridge()
    const rig = new NativeGraphRig(bridge)

    rig.setMasterLevel(0.5)
    expect(calls.setMasterLevel).toHaveBeenCalledWith({ level: 0.5 })

    rig.setMasterMuted(true)
    expect(calls.setMasterMuted).toHaveBeenCalledWith({ muted: true })

    rig.setTunerMuted(true)
    expect(calls.setTunerMuted).toHaveBeenCalledWith({ muted: true })
  })
})
