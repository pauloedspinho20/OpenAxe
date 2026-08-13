import { BaseEffect, type EffectParams } from './Effect'
import { createModulatedDelay, type ModulatedDelay } from './modulatedDelay'

/** LFO-modulated delay with a long-ish base delay and light feedback - a classic chorus. */
export class Chorus extends BaseEffect {
  private readonly modDelay: ModulatedDelay

  constructor(context: BaseAudioContext) {
    const modDelay = createModulatedDelay(context, {
      baseDelayMs: 20,
      depthMs: 4,
      rateHz: 1.2,
      feedback: 0.15,
    })
    super(context, 'chorus', 'Chorus', modDelay.input, modDelay.output)
    this.modDelay = modDelay
  }

  /** LFO speed in Hz. */
  setRate(hz: number): void {
    this.modDelay.setRate(hz)
  }

  /** Modulation depth in ms. */
  setDepth(ms: number): void {
    this.modDelay.setDepth(ms)
  }

  /** Regeneration amount, [0, ~0.5] before it starts sounding flangey. */
  setFeedback(amount: number): void {
    this.modDelay.setFeedback(amount)
  }

  getParams(): EffectParams {
    return {
      ...this.baseParams(),
      rate: this.modDelay.lfo.frequency.value,
      depth: this.modDelay.depthGain.gain.value * 1000,
      feedback: this.modDelay.feedbackGain.gain.value,
    }
  }

  setParams(params: EffectParams): void {
    this.applyBaseParams(params)
    if (typeof params.rate === 'number') this.setRate(params.rate)
    if (typeof params.depth === 'number') this.setDepth(params.depth)
    if (typeof params.feedback === 'number') this.setFeedback(params.feedback)
  }

  dispose(): void {
    this.disposeBase()
    this.modDelay.dispose()
  }
}
