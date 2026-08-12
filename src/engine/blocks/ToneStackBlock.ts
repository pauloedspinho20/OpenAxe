import type { Block, EffectParams } from './Block'

/**
 * A standalone Bass/Mid/Treble/Presence tone stack - the same 4-band EQ
 * that used to be fused inside AmpCabChain between the amp and the cab, now
 * a placeable block in its own right (same ±12dB ranges and center
 * frequencies as before, just no longer hardcoded to sit between two other
 * specific blocks).
 */
export class ToneStackBlock implements Block {
  readonly kind = 'tone-stack' as const
  private readonly context: BaseAudioContext
  private readonly bassFilter: BiquadFilterNode
  private readonly midFilter: BiquadFilterNode
  private readonly trebleFilter: BiquadFilterNode
  private readonly presenceFilter: BiquadFilterNode
  private bassGain = 0
  private midGain = 0
  private trebleGain = 0
  private presenceGain = 0
  private disposed = false

  constructor(context: BaseAudioContext) {
    this.context = context
    this.bassFilter = new BiquadFilterNode(context, { type: 'lowshelf', frequency: 100, gain: 0 })
    this.midFilter = new BiquadFilterNode(context, {
      type: 'peaking',
      frequency: 1000,
      Q: 0.7,
      gain: 0,
    })
    this.trebleFilter = new BiquadFilterNode(context, {
      type: 'highshelf',
      frequency: 5000,
      gain: 0,
    })
    this.presenceFilter = new BiquadFilterNode(context, {
      type: 'peaking',
      frequency: 8000,
      Q: 0.5,
      gain: 0,
    })
    this.bassFilter.connect(this.midFilter)
    this.midFilter.connect(this.trebleFilter)
    this.trebleFilter.connect(this.presenceFilter)
  }

  get inputNode(): AudioNode {
    return this.bassFilter
  }

  get outputNode(): AudioNode {
    return this.presenceFilter
  }

  setBass(gain: number): void {
    this.bassGain = Math.min(12, Math.max(-12, gain))
    this.bassFilter.gain.setTargetAtTime(this.bassGain, this.context.currentTime, 0.01)
  }

  getBass(): number {
    return this.bassGain
  }

  setMid(gain: number): void {
    this.midGain = Math.min(12, Math.max(-12, gain))
    this.midFilter.gain.setTargetAtTime(this.midGain, this.context.currentTime, 0.01)
  }

  getMid(): number {
    return this.midGain
  }

  setTreble(gain: number): void {
    this.trebleGain = Math.min(12, Math.max(-12, gain))
    this.trebleFilter.gain.setTargetAtTime(this.trebleGain, this.context.currentTime, 0.01)
  }

  getTreble(): number {
    return this.trebleGain
  }

  setPresence(gain: number): void {
    this.presenceGain = Math.min(12, Math.max(-12, gain))
    this.presenceFilter.gain.setTargetAtTime(this.presenceGain, this.context.currentTime, 0.01)
  }

  getPresence(): number {
    return this.presenceGain
  }

  getParams(): EffectParams {
    return {
      bass: this.bassGain,
      mid: this.midGain,
      treble: this.trebleGain,
      presence: this.presenceGain,
    }
  }

  setParams(params: EffectParams): void {
    if (typeof params.bass === 'number') this.setBass(params.bass)
    if (typeof params.mid === 'number') this.setMid(params.mid)
    if (typeof params.treble === 'number') this.setTreble(params.treble)
    if (typeof params.presence === 'number') this.setPresence(params.presence)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.bassFilter.disconnect()
    this.midFilter.disconnect()
    this.trebleFilter.disconnect()
    this.presenceFilter.disconnect()
  }
}
