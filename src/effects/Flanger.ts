import { BaseEffect, type EffectParams } from './Effect'
import { createModulatedDelay, type ModulatedDelay } from './modulatedDelay'

/** LFO-modulated delay with a very short base delay and higher feedback - the classic comb-filter sweep. */
export class Flanger extends BaseEffect {
  private readonly modDelay: ModulatedDelay

  constructor(context: BaseAudioContext) {
    const modDelay = createModulatedDelay(context, {
      baseDelayMs: 3,
      depthMs: 2,
      rateHz: 0.25,
      feedback: 0.6,
    })
    super(context, 'flanger', 'Flanger', modDelay.input, modDelay.output)
    this.modDelay = modDelay
  }

  setRate(hz: number): void {
    this.modDelay.setRate(hz)
  }

  setDepth(ms: number): void {
    this.modDelay.setDepth(ms)
  }

  /** Regeneration amount - higher values push toward metallic self-oscillation. */
  setFeedback(amount: number): void {
    this.modDelay.setFeedback(amount)
  }

  getParams(): EffectParams {
    return {
      rate: this.modDelay.lfo.frequency.value,
      depth: this.modDelay.depthGain.gain.value * 1000,
      feedback: this.modDelay.feedbackGain.gain.value,
    }
  }

  setParams(params: EffectParams): void {
    if (typeof params.rate === 'number') this.setRate(params.rate)
    if (typeof params.depth === 'number') this.setDepth(params.depth)
    if (typeof params.feedback === 'number') this.setFeedback(params.feedback)
  }

  dispose(): void {
    this.disposeBase()
    this.modDelay.dispose()
  }
}
