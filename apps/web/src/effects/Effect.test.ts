// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { BaseEffect, type EffectParams } from './Effect'

/** Real enough to observe gain values without a real Web Audio context. */
class StubGainNode {
  gain: { value: number; setTargetAtTime: (v: number) => void }
  context: unknown
  connect = vi.fn()
  disconnect = vi.fn()
  constructor(context: unknown, options?: { gain?: number }) {
    const gain = {
      value: options?.gain ?? 1,
      setTargetAtTime: (v: number) => {
        gain.value = v
      },
    }
    this.gain = gain
    this.context = context
  }
}
vi.stubGlobal('GainNode', StubGainNode)

class TestEffect extends BaseEffect {
  constructor(context: BaseAudioContext) {
    const wetNode = new StubGainNode(context) as unknown as AudioNode
    super(context, 'compressor', 'Test', wetNode, wetNode)
  }
  getParams(): EffectParams {
    return {}
  }
  setParams(params: EffectParams): void {
    void params
  }
  dispose(): void {
    this.disposeBase()
  }
}

describe('BaseEffect', () => {
  it('starts fully wet, not silently passing the dry signal through unprocessed', () => {
    // Regression test: every effect kind (Compressor, EQ, Chorus, ...)
    // reported `mix = 1` (fully wet) from the moment it was constructed,
    // but the underlying dry/wet GainNodes were built with the opposite
    // values (dry=1, wet=0) and nothing ever synced them - so every effect
    // silently passed its input straight through unprocessed until
    // something explicitly called setMix(), which nothing in the app does
    // (mix/level aren't params in paramSchema.ts anymore — see Effect.ts).
    // Effects expose their own native dry/wet control only where the DSP
    // provides one (Compressor's Mix, Reverb's Dry).
    const effect = new TestEffect({ currentTime: 0 } as BaseAudioContext)

    expect(effect.getMix()).toBe(1)
    expect(effect.isBypassed()).toBe(false)

    const { dryGain, wetGain } = effect as unknown as {
      dryGain: StubGainNode
      wetGain: StubGainNode
    }
    expect(wetGain.gain.value).toBe(1)
    expect(dryGain.gain.value).toBe(0)
  })

  it('setLevel scales the wet path only - the shared outputNode is untouched', () => {
    const effect = new TestEffect({ currentTime: 0 } as BaseAudioContext)
    expect(effect.getLevel()).toBe(1)

    effect.setLevel(0.5)
    expect(effect.getLevel()).toBe(0.5)

    const { wetGain, dryGain } = effect as unknown as {
      wetGain: StubGainNode
      dryGain: StubGainNode
    }
    // mix is still 1 (fully wet): wetGain = mix * level = 0.5; dry is untouched by level.
    expect(wetGain.gain.value).toBe(0.5)
    expect(dryGain.gain.value).toBe(0)
    expect((effect.outputNode as unknown as StubGainNode).gain.value).toBe(1)

    effect.setLevel(3) // clamped to MAX_LEVEL (1.5), same headroom as the master/mixer knobs
    expect(effect.getLevel()).toBe(1.5)
  })

  it('a bypassed effect is a hard unity passthrough - Level and Mix changes have no audible effect until un-bypassed', () => {
    // Regression test: setLevel used to write straight to outputNode.gain,
    // which is also where the dry bypass signal sums in - so turning the
    // Level knob (or Mix) audibly changed a bypassed pedal's passthrough
    // volume instead of leaving it untouched, the way a real footswitch
    // bypass would.
    const effect = new TestEffect({ currentTime: 0 } as BaseAudioContext)
    const { wetGain, dryGain } = effect as unknown as {
      wetGain: StubGainNode
      dryGain: StubGainNode
    }

    effect.setBypass(true)
    expect(wetGain.gain.value).toBe(0)
    expect(dryGain.gain.value).toBe(1)

    effect.setLevel(0.2)
    effect.setMix(0.1)
    expect(wetGain.gain.value).toBe(0)
    expect(dryGain.gain.value).toBe(1)
    // The values themselves are still tracked/editable while bypassed...
    expect(effect.getLevel()).toBe(0.2)
    expect(effect.getMix()).toBe(0.1)

    // ...and correctly take effect once un-bypassed, rather than being
    // silently reverted to whatever they were when bypass first engaged.
    effect.setBypass(false)
    expect(wetGain.gain.value).toBeCloseTo(0.1 * 0.2)
    expect(dryGain.gain.value).toBeCloseTo(1 - 0.1)
  })

  it("getParams/setParams are the concrete class's job - base defines no shared params", () => {
    const effect = new TestEffect({ currentTime: 0 } as BaseAudioContext)
    expect(effect.getParams()).toEqual({})

    // setParams with empty params is a no-op: mix/level stay whatever they are.
    effect.setLevel(0.8)
    effect.setMix(0.6)
    effect.setParams({})
    expect(effect.getMix()).toBe(0.6)
    expect(effect.getLevel()).toBe(0.8)
  })
})
