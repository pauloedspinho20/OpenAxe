// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { AmpBlock } from './AmpBlock'

// The NAM inference itself lives in packages/core behind an AudioWorklet (see
// NamAmpNode); these tests cover the Web Audio staging AmpBlock puts around it,
// so the node is stubbed rather than instantiated.
vi.mock('../NamAmpNode', () => ({
  NamAmpNode: {
    create: vi.fn(async () => ({
      // `node` is the AudioWorkletNode the block wires into its chain; the
      // model calls are the wrapper's own async port messages.
      node: { connect: vi.fn(), disconnect: vi.fn() },
      // The tone stack is a core param behind the worklet now, not a Web Audio
      // filter chain, so the block just forwards knob values here.
      setToneGainDb: vi.fn(),
      loadModel: vi.fn(),
      unloadModel: vi.fn(),
      setSlimSize: vi.fn(),
      dispose: vi.fn(),
    })),
  },
}))

function stubAudioParam(initial: number) {
  const param = {
    value: initial,
    setTargetAtTime: vi.fn((v: number) => {
      param.value = v
      return param
    }),
  }
  return param
}

const gainInstances: Array<{ gain: ReturnType<typeof stubAudioParam> }> = []

class StubGainNode {
  connect = vi.fn()
  disconnect = vi.fn()
  gain: ReturnType<typeof stubAudioParam>
  constructor(_context: unknown, opts?: { gain?: number }) {
    this.gain = stubAudioParam(opts?.gain ?? 1)
    gainInstances.push(this)
  }
}

class StubBiquadFilterNode {
  connect = vi.fn()
  disconnect = vi.fn()
  gain = stubAudioParam(0)
  frequency = stubAudioParam(0)
  Q = stubAudioParam(0)
  constructor(_context: unknown, _opts?: unknown) {}
}

vi.stubGlobal('GainNode', StubGainNode)
vi.stubGlobal('BiquadFilterNode', StubBiquadFilterNode)

async function createAmp() {
  gainInstances.length = 0
  const context = { currentTime: 0 } as BaseAudioContext
  const amp = await AmpBlock.create(context, 'amp')
  // dryGain is the only node created with an initial gain of 0; wetMuteGain
  // is the last GainNode the constructor creates - see AmpBlock's wiring order.
  const dryGain = gainInstances.find((g) => g.gain.value === 0)!
  const wetMuteGain = gainInstances[gainInstances.length - 1]!
  return { amp, dryGain, wetMuteGain }
}

describe('AmpBlock bypass', () => {
  it('starts un-bypassed', async () => {
    const { amp } = await createAmp()
    expect(amp.isBypassed()).toBe(false)
  })

  it('engaging bypass mutes the wet path and unmutes the dry path', async () => {
    const { amp, dryGain, wetMuteGain } = await createAmp()
    amp.setBypass(true)
    expect(amp.isBypassed()).toBe(true)
    expect(wetMuteGain.gain.setTargetAtTime).toHaveBeenCalledWith(0, 0, 0.01)
    expect(dryGain.gain.setTargetAtTime).toHaveBeenCalledWith(1, 0, 0.01)
  })

  it('disengaging bypass restores the wet path and mutes the dry path', async () => {
    const { amp, dryGain, wetMuteGain } = await createAmp()
    amp.setBypass(true)
    dryGain.gain.setTargetAtTime.mockClear()
    wetMuteGain.gain.setTargetAtTime.mockClear()

    amp.setBypass(false)
    expect(amp.isBypassed()).toBe(false)
    expect(wetMuteGain.gain.setTargetAtTime).toHaveBeenCalledWith(1, 0, 0.01)
    expect(dryGain.gain.setTargetAtTime).toHaveBeenCalledWith(0, 0, 0.01)
  })

  it('setting the same bypass value twice is a no-op', async () => {
    const { amp, dryGain, wetMuteGain } = await createAmp()
    amp.setBypass(false)
    expect(dryGain.gain.setTargetAtTime).not.toHaveBeenCalled()
    expect(wetMuteGain.gain.setTargetAtTime).not.toHaveBeenCalled()
  })

  it('dispose is idempotent', async () => {
    const { amp } = await createAmp()
    await amp.dispose()
    await amp.dispose()
  })
})
