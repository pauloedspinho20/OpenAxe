import { BaseEffect, type EffectParams } from './Effect'

export type DelayCharacter = 'clean' | 'tape'

const SATURATION_CURVE_SIZE = 1024

/** Gentle, fixed saturation for the tape-delay feedback loop - repeats warm up as they build. */
function tapeSaturationCurve(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(SATURATION_CURVE_SIZE)
  for (let i = 0; i < SATURATION_CURVE_SIZE; i++) {
    const x = (i * 2) / SATURATION_CURVE_SIZE - 1
    curve[i] = Math.tanh(1.5 * x) / Math.tanh(1.5)
  }
  return curve as Float32Array<ArrayBuffer>
}

/**
 * Feedback delay with a tone-shaping filter in the loop. 'tape' character
 * adds a lower cutoff and gentle saturation so repeats darken and warm up
 * over time, like a tape echo; 'clean' is a standard digital delay.
 */
export class Delay extends BaseEffect {
  private readonly delayNode: DelayNode
  private readonly feedbackGain: GainNode
  private readonly toneFilter: BiquadFilterNode
  private readonly wetOut: GainNode
  private readonly saturator: WaveShaperNode | null
  private readonly character: DelayCharacter

  constructor(context: BaseAudioContext, character: DelayCharacter = 'clean') {
    const delayNode = new DelayNode(context, { delayTime: 0.35, maxDelayTime: 5 })
    const feedbackGain = new GainNode(context, { gain: 0.35 })
    const toneFilter = new BiquadFilterNode(context, {
      type: 'lowpass',
      frequency: character === 'tape' ? 3500 : 12000,
    })
    const wetOut = new GainNode(context)

    delayNode.connect(wetOut)
    delayNode.connect(toneFilter)
    let saturator: WaveShaperNode | null = null
    if (character === 'tape') {
      saturator = new WaveShaperNode(context, {
        curve: tapeSaturationCurve(),
        oversample: '2x',
      })
      toneFilter.connect(saturator)
      saturator.connect(feedbackGain)
    } else {
      toneFilter.connect(feedbackGain)
    }
    feedbackGain.connect(delayNode)

    super(context, 'delay', character === 'tape' ? 'Tape Delay' : 'Delay', delayNode, wetOut)
    this.delayNode = delayNode
    this.feedbackGain = feedbackGain
    this.toneFilter = toneFilter
    this.wetOut = wetOut
    this.saturator = saturator
    this.character = character
  }

  setTime(seconds: number): void {
    this.delayNode.delayTime.setTargetAtTime(seconds, this.delayNode.context.currentTime, 0.01)
  }

  setFeedback(amount: number): void {
    this.feedbackGain.gain.setTargetAtTime(amount, this.delayNode.context.currentTime, 0.01)
  }

  setTone(hz: number): void {
    this.toneFilter.frequency.setTargetAtTime(hz, this.delayNode.context.currentTime, 0.01)
  }

  /** `character` is fixed at construction (it changes the node topology) - reported so a preset can reconstruct with the right one, but setParams() can't change it on a live instance. */
  getParams(): EffectParams {
    return {
      ...this.baseParams(),
      character: this.character,
      time: this.delayNode.delayTime.value,
      feedback: this.feedbackGain.gain.value,
      tone: this.toneFilter.frequency.value,
    }
  }

  setParams(params: EffectParams): void {
    this.applyBaseParams(params)
    if (typeof params.time === 'number') this.setTime(params.time)
    if (typeof params.feedback === 'number') this.setFeedback(params.feedback)
    if (typeof params.tone === 'number') this.setTone(params.tone)
  }

  dispose(): void {
    this.disposeBase()
    this.delayNode.disconnect()
    this.feedbackGain.disconnect()
    this.toneFilter.disconnect()
    this.wetOut.disconnect()
    this.saturator?.disconnect()
  }
}
