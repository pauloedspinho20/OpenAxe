import { BaseEffect, type EffectParams } from './Effect'

const STAGE_COUNT = 4
const MIN_FREQ = 200
const MAX_FREQ = 2000

/**
 * Cascaded allpass filters swept by a shared LFO, with feedback for
 * resonance - the classic phaser topology.
 */
export class Phaser extends BaseEffect {
  private readonly stages: BiquadFilterNode[]
  private readonly lfo: OscillatorNode
  private readonly depthGain: GainNode
  private readonly feedbackGain: GainNode
  private readonly input: GainNode

  constructor(context: BaseAudioContext) {
    const input = new GainNode(context)
    const output = new GainNode(context)
    const stages = Array.from(
      { length: STAGE_COUNT },
      () =>
        new BiquadFilterNode(context, { type: 'allpass', frequency: (MIN_FREQ + MAX_FREQ) / 2 }),
    )
    for (let i = 0; i < stages.length - 1; i++) stages[i]!.connect(stages[i + 1]!)
    const lastStage = stages[stages.length - 1]!

    const feedbackGain = new GainNode(context, { gain: 0.5 })
    input.connect(stages[0]!)
    lastStage.connect(output)
    lastStage.connect(feedbackGain)
    feedbackGain.connect(stages[0]!)

    const lfo = new OscillatorNode(context, { type: 'sine', frequency: 0.4 })
    const depthGain = new GainNode(context, { gain: (MAX_FREQ - MIN_FREQ) / 2 })
    // Center each stage's frequency, then let the shared LFO sweep them together.
    for (const stage of stages) {
      stage.frequency.value = (MIN_FREQ + MAX_FREQ) / 2
      depthGain.connect(stage.frequency)
    }
    lfo.connect(depthGain)
    lfo.start()

    super(context, 'phaser', 'Phaser', input, output)
    this.input = input
    this.stages = stages
    this.lfo = lfo
    this.depthGain = depthGain
    this.feedbackGain = feedbackGain
  }

  /** Sweep speed in Hz. */
  setRate(hz: number): void {
    this.lfo.frequency.setTargetAtTime(hz, this.input.context.currentTime, 0.01)
  }

  /** Sweep width in Hz around the center frequency. */
  setDepth(hz: number): void {
    this.depthGain.gain.setTargetAtTime(hz, this.input.context.currentTime, 0.01)
  }

  /** Resonance / regeneration amount, [0, ~0.9]. */
  setFeedback(amount: number): void {
    this.feedbackGain.gain.setTargetAtTime(amount, this.input.context.currentTime, 0.01)
  }

  getParams(): EffectParams {
    return {
      ...this.baseParams(),
      rate: this.lfo.frequency.value,
      depth: this.depthGain.gain.value,
      feedback: this.feedbackGain.gain.value,
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
    this.input.disconnect()
    this.lfo.stop()
    this.lfo.disconnect()
    this.depthGain.disconnect()
    this.feedbackGain.disconnect()
    for (const stage of this.stages) stage.disconnect()
  }
}
