import { BaseEffect, type EffectParams } from './Effect'

/** LFO-modulated gain - the amp-tremolo "volume wobble" effect. */
export class Tremolo extends BaseEffect {
  private readonly lfo: OscillatorNode
  private readonly depthGain: GainNode
  private readonly ampGain: GainNode
  private depth = 0.5

  constructor(context: BaseAudioContext) {
    const ampGain = new GainNode(context, { gain: 1 - 0.5 / 2 })
    const lfo = new OscillatorNode(context, { type: 'sine', frequency: 5 })
    const depthGain = new GainNode(context, { gain: 0.5 / 2 })

    lfo.connect(depthGain)
    depthGain.connect(ampGain.gain)
    lfo.start()

    super(context, 'tremolo', 'Tremolo', ampGain, ampGain)
    this.lfo = lfo
    this.depthGain = depthGain
    this.ampGain = ampGain
  }

  /** Wobble speed in Hz. */
  setRate(hz: number): void {
    this.lfo.frequency.setTargetAtTime(hz, this.ampGain.context.currentTime, 0.01)
  }

  /** How far volume dips on each cycle, [0, 1]. 0 = no effect, 1 = full silence at the trough. */
  setDepth(depth: number): void {
    this.depth = Math.min(1, Math.max(0, depth))
    const now = this.ampGain.context.currentTime
    this.ampGain.gain.setTargetAtTime(1 - this.depth / 2, now, 0.01)
    this.depthGain.gain.setTargetAtTime(this.depth / 2, now, 0.01)
  }

  getParams(): EffectParams {
    return {
      ...this.baseParams(),
      rate: this.lfo.frequency.value,
      depth: this.depth,
    }
  }

  setParams(params: EffectParams): void {
    this.applyBaseParams(params)
    if (typeof params.rate === 'number') this.setRate(params.rate)
    if (typeof params.depth === 'number') this.setDepth(params.depth)
  }

  dispose(): void {
    this.disposeBase()
    this.lfo.stop()
    this.lfo.disconnect()
    this.depthGain.disconnect()
    this.ampGain.disconnect()
  }
}
