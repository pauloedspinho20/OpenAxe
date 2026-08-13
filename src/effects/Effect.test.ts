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
    return this.baseParams()
  }
  setParams(params: EffectParams): void {
    this.applyBaseParams(params)
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
    // (mix isn't a param in paramSchema.ts for any effect).
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

  it('setLevel applies to the outputNode gain directly - no extra node needed', () => {
    const effect = new TestEffect({ currentTime: 0 } as BaseAudioContext)
    expect(effect.getLevel()).toBe(1)

    effect.setLevel(0.5)
    expect(effect.getLevel()).toBe(0.5)
    expect((effect.outputNode as unknown as StubGainNode).gain.value).toBe(0.5)

    effect.setLevel(3) // clamped to MAX_LEVEL (1.5), same headroom as the master/mixer knobs
    expect(effect.getLevel()).toBe(1.5)
  })

  it('getParams/setParams round-trip mix and level via baseParams/applyBaseParams', () => {
    const effect = new TestEffect({ currentTime: 0 } as BaseAudioContext)
    effect.setMix(0.6)
    effect.setLevel(0.8)

    const saved = effect.getParams()
    expect(saved).toEqual({ mix: 0.6, level: 0.8 })

    const restored = new TestEffect({ currentTime: 0 } as BaseAudioContext)
    restored.setParams(saved)
    expect(restored.getMix()).toBe(0.6)
    expect(restored.getLevel()).toBe(0.8)
  })
})
