// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { MixerBlock, MIXER_INPUT_COUNT } from './MixerBlock'

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

function stubNode() {
  return class {
    connect = vi.fn()
    disconnect = vi.fn()
    gain = stubAudioParam(1)
    pan = stubAudioParam(0)
  }
}

vi.stubGlobal('GainNode', stubNode())
vi.stubGlobal('StereoPannerNode', stubNode())

function createMockContext(): BaseAudioContext {
  return { currentTime: 0 } as BaseAudioContext
}

describe('MixerBlock', () => {
  it('exposes a distinct jack per input slot', () => {
    const mixer = new MixerBlock(createMockContext())
    const jacks = Array.from({ length: MIXER_INPUT_COUNT }, (_, i) => mixer.inputNodeAt(i))
    expect(new Set(jacks).size).toBe(MIXER_INPUT_COUNT)
  })

  it('inputNode is an alias for slot 0', () => {
    const mixer = new MixerBlock(createMockContext())
    expect(mixer.inputNode).toBe(mixer.inputNodeAt(0))
  })

  it('round-trips level/pan for every slot via getParams/setParams', () => {
    const mixer = new MixerBlock(createMockContext())
    mixer.setParams({ in0_level: 0.5, in0_pan: -1, in3_level: 0.2, in3_pan: 1 })
    const params = mixer.getParams()
    expect(params.in0_level).toBe(0.5)
    expect(params.in0_pan).toBe(-1)
    expect(params.in3_level).toBe(0.2)
    expect(params.in3_pan).toBe(1)
  })

  it('dispose is idempotent', () => {
    const mixer = new MixerBlock(createMockContext())
    expect(() => {
      mixer.dispose()
      mixer.dispose()
    }).not.toThrow()
  })
})
