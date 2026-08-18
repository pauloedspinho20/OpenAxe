// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GraphRig, jack } from './GraphRig'
import type { AmpBlock } from './blocks/AmpBlock'

function stubAudioNode() {
  return class {
    connect = vi.fn()
    disconnect = vi.fn()
    gain = { value: 1, setTargetAtTime: vi.fn() }
    pan = { value: 0, setTargetAtTime: vi.fn() }
  }
}

// None of GainNode/StereoPannerNode/DynamicsCompressorNode/ConvolverNode
// exist in the `node` test environment - stub the ones GraphRig and the
// block kinds used in these tests construct.
vi.stubGlobal('GainNode', stubAudioNode())
vi.stubGlobal('StereoPannerNode', stubAudioNode())
vi.stubGlobal('BiquadFilterNode', stubAudioNode())
vi.stubGlobal('DynamicsCompressorNode', stubAudioNode())
vi.stubGlobal('ConvolverNode', stubAudioNode())
vi.stubGlobal('AnalyserNode', stubAudioNode())

function createMockContext(): AudioContext {
  return { currentTime: 0 } as AudioContext
}

// Amp blocks now build their own core-backed worklet node (NamAmpNode) instead
// of being handed a node by an engine object, so the rig needs no engine at all.
vi.mock('./NamAmpNode', () => ({
  NamAmpNode: {
    create: async () => ({
      node: { connect: vi.fn(), disconnect: vi.fn() },
      loadModel: async () => ({ slimmable: false, slimmableBreakpoints: [] }),
      unloadModel: async () => undefined,
      setSlimSize: async () => undefined,
      dispose: async () => undefined,
    }),
  },
}))

describe('GraphRig', () => {
  let rig: GraphRig

  beforeEach(async () => {
    rig = await GraphRig.create(createMockContext())
  })

  it('starts with no blocks or edges', () => {
    expect(rig.listBlockIds()).toEqual([])
    expect(rig.listEdgeIds()).toEqual([])
  })

  it('adds a block at a given position and can look it up', async () => {
    const id = await rig.addBlock('mixer', 1, 2)
    expect(rig.getBlockPosition(id)).toEqual({ row: 1, col: 2 })
    expect(rig.getBlock(id)?.kind).toBe('mixer')
  })

  it('getBlockAnalyser lazily creates and caches one tap per block, null for an unknown id', async () => {
    const id = await rig.addBlock('mixer', 0, 0)
    expect(rig.getBlockAnalyser('nope')).toBeNull()
    const first = rig.getBlockAnalyser(id)
    const second = rig.getBlockAnalyser(id)
    expect(first).not.toBeNull()
    expect(second).toBe(first)
  })

  it('honors an explicit id when adding a block', async () => {
    const id = await rig.addBlock('mixer', 0, 0, 'my-mixer')
    expect(id).toBe('my-mixer')
    expect(rig.listBlockIds()).toEqual(['my-mixer'])
  })

  it('connects two blocks in increasing column order', async () => {
    const a = await rig.addBlock('mixer', 0, 0)
    const b = await rig.addBlock('mixer', 0, 1)
    const result = rig.connect(jack(a), jack(b))
    expect(result.ok).toBe(true)
    expect(rig.listEdgeIds()).toHaveLength(1)
  })

  it('rejects a backward connection', async () => {
    const a = await rig.addBlock('mixer', 0, 1)
    const b = await rig.addBlock('mixer', 0, 0)
    const result = rig.connect(jack(a), jack(b))
    expect(result.ok).toBe(false)
  })

  it('rejects a second cable into an already-occupied jack', async () => {
    const a = await rig.addBlock('mixer', 0, 0)
    const b = await rig.addBlock('mixer', 0, 1)
    const c = await rig.addBlock('mixer', 0, 1)
    expect(rig.connect(jack(a), jack(b)).ok).toBe(true)
    expect(rig.connect(jack(c), jack(b)).ok).toBe(false)
  })

  it('honors an explicit edge id, so a store-generated id can be mirrored', async () => {
    const a = await rig.addBlock('mixer', 0, 0)
    const b = await rig.addBlock('mixer', 0, 1)
    const result = rig.connect(jack(a), jack(b), 'my-edge')
    expect(result).toEqual({ ok: true, id: 'my-edge' })
    expect(rig.listEdgeIds()).toEqual(['my-edge'])
  })

  it('disconnects an edge by id', async () => {
    const a = await rig.addBlock('mixer', 0, 0)
    const b = await rig.addBlock('mixer', 0, 1)
    const { id } = rig.connect(jack(a), jack(b)) as { ok: true; id: string }
    rig.disconnect(id)
    expect(rig.listEdgeIds()).toEqual([])
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
  })

  it('moving a block to a column that would break a cable is rejected and the block does not move', async () => {
    const a = await rig.addBlock('mixer', 0, 0)
    const b = await rig.addBlock('mixer', 0, 1)
    rig.connect(jack(a), jack(b))

    const result = rig.moveBlock(a, 0, 5)

    expect(result.ok).toBe(false)
    expect(rig.listEdgeIds()).toHaveLength(1)
    expect(rig.getBlockPosition(a)).toEqual({ row: 0, col: 0 })
  })

  it('routes multiple cables into distinct Mixer ports', async () => {
    const a = await rig.addBlock('mixer', 0, 0)
    const b = await rig.addBlock('mixer', 1, 0)
    const mixer = await rig.addBlock('mixer', 0, 1)
    expect(rig.connect(jack(a), jack(mixer, 0)).ok).toBe(true)
    expect(rig.connect(jack(b), jack(mixer, 1)).ok).toBe(true)
    expect(rig.listEdgeIds()).toHaveLength(2)
  })

  it('connects the IN rail to a block and the block to the OUT rail', async () => {
    const a = await rig.addBlock('mixer', 0, 0)
    expect(rig.connect(jack('IN'), jack(a)).ok).toBe(true)
    expect(rig.connect(jack(a), jack('OUT')).ok).toBe(true)
  })

  it('is a no-op to remove or move a block that does not exist', async () => {
    await expect(rig.removeBlock('ghost')).resolves.toBeUndefined()
    expect(rig.moveBlock('ghost', 0, 0)).toEqual({ ok: false, reason: 'Unknown block' })
  })

  it('dispose is idempotent and clears blocks/edges', async () => {
    const a = await rig.addBlock('mixer', 0, 0)
    const b = await rig.addBlock('mixer', 0, 1)
    rig.connect(jack(a), jack(b))

    await rig.dispose()
    await rig.dispose()

    expect(rig.listBlockIds()).toEqual([])
    expect(rig.listEdgeIds()).toEqual([])
  })

  it('silences the output while tuner-muted, restoring the saved level after', () => {
    const masterGain = (
      rig as unknown as { masterGain: { gain: { setTargetAtTime: ReturnType<typeof vi.fn> } } }
    ).masterGain
    rig.setMasterLevel(0.5)
    const lastTarget = () => masterGain.gain.setTargetAtTime.mock.calls.at(-1)![0]

    rig.setTunerMuted(true)
    expect(lastTarget()).toBe(0)

    rig.setTunerMuted(false)
    expect(lastTarget()).toBe(0.5)
  })

  it('counts only Amp/Cab blocks with an actual model/IR loaded', async () => {
    const ampId = await rig.addBlock('amp', 0, 0)
    await rig.addBlock('cab', 0, 1)
    await rig.addBlock('mixer', 0, 2)
    expect(rig.countActiveHeavyBlocks()).toBe(0)

    const amp = rig.getBlock(ampId) as AmpBlock
    await amp.loadModel('{}', undefined, { id: 'm1', name: 'Model' })

    expect(rig.countActiveHeavyBlocks()).toBe(1)
  })
})
