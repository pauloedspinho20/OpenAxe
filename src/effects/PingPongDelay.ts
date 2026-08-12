import { BaseEffect, type EffectParams } from './Effect'

/**
 * Stereo delay that alternates repeats left/right: input feeds the left
 * delay line, whose output pans hard left AND feeds the right delay line,
 * which pans hard right and feeds back into the left line, and so on.
 */
export class PingPongDelay extends BaseEffect {
  private readonly input: GainNode
  private readonly wetOut: GainNode
  private readonly delayL: DelayNode
  private readonly delayR: DelayNode
  private readonly feedbackLtoR: GainNode
  private readonly feedbackRtoL: GainNode
  private readonly pannerL: StereoPannerNode
  private readonly pannerR: StereoPannerNode

  constructor(context: BaseAudioContext) {
    const input = new GainNode(context)
    const wetOut = new GainNode(context)
    const delayL = new DelayNode(context, { delayTime: 0.3, maxDelayTime: 5 })
    const delayR = new DelayNode(context, { delayTime: 0.3, maxDelayTime: 5 })
    const feedbackLtoR = new GainNode(context, { gain: 0.35 })
    const feedbackRtoL = new GainNode(context, { gain: 0.35 })
    const pannerL = new StereoPannerNode(context, { pan: -1 })
    const pannerR = new StereoPannerNode(context, { pan: 1 })

    input.connect(delayL)
    delayL.connect(pannerL)
    pannerL.connect(wetOut)
    delayL.connect(feedbackLtoR)
    feedbackLtoR.connect(delayR)

    delayR.connect(pannerR)
    pannerR.connect(wetOut)
    delayR.connect(feedbackRtoL)
    feedbackRtoL.connect(delayL)

    super(context, 'ping-pong-delay', 'Ping-Pong Delay', input, wetOut)
    this.input = input
    this.wetOut = wetOut
    this.delayL = delayL
    this.delayR = delayR
    this.feedbackLtoR = feedbackLtoR
    this.feedbackRtoL = feedbackRtoL
    this.pannerL = pannerL
    this.pannerR = pannerR
  }

  /** Time between the left and right repeats, in seconds. */
  setTime(seconds: number): void {
    const now = this.delayL.context.currentTime
    this.delayL.delayTime.setTargetAtTime(seconds, now, 0.01)
    this.delayR.delayTime.setTargetAtTime(seconds, now, 0.01)
  }

  setFeedback(amount: number): void {
    const now = this.delayL.context.currentTime
    this.feedbackLtoR.gain.setTargetAtTime(amount, now, 0.01)
    this.feedbackRtoL.gain.setTargetAtTime(amount, now, 0.01)
  }

  getParams(): EffectParams {
    return {
      time: this.delayL.delayTime.value,
      feedback: this.feedbackLtoR.gain.value,
    }
  }

  setParams(params: EffectParams): void {
    if (typeof params.time === 'number') this.setTime(params.time)
    if (typeof params.feedback === 'number') this.setFeedback(params.feedback)
  }

  dispose(): void {
    this.disposeBase()
    this.input.disconnect()
    this.wetOut.disconnect()
    this.delayL.disconnect()
    this.delayR.disconnect()
    this.feedbackLtoR.disconnect()
    this.feedbackRtoL.disconnect()
    this.pannerL.disconnect()
    this.pannerR.disconnect()
  }
}
