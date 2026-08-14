import { BaseEffect, type EffectParams } from './Effect'

export interface EqBandConfig {
  type: BiquadFilterType
  frequency: number
  gain?: number
  q?: number
}

/** Guitar/bass-oriented default: low-shelf, two sweepable mid peaks, high-shelf. */
const DEFAULT_BANDS: EqBandConfig[] = [
  { type: 'lowshelf', frequency: 100, gain: 0 },
  { type: 'peaking', frequency: 500, gain: 0, q: 1 },
  { type: 'peaking', frequency: 2000, gain: 0, q: 1 },
  { type: 'highshelf', frequency: 6000, gain: 0 },
]

/** A chain of BiquadFilterNodes in series - no third-party DSP needed, native nodes are already good EQ. */
export class ParametricEQ extends BaseEffect {
  private readonly bands: BiquadFilterNode[]

  constructor(context: BaseAudioContext, bandConfigs: EqBandConfig[] = DEFAULT_BANDS) {
    if (bandConfigs.length === 0) {
      throw new RangeError('ParametricEQ needs at least one band')
    }
    const bands = bandConfigs.map(
      (config) =>
        new BiquadFilterNode(context, {
          type: config.type,
          frequency: config.frequency,
          gain: config.gain ?? 0,
          Q: config.q ?? 1,
        }),
    )
    for (let i = 0; i < bands.length - 1; i++) bands[i]!.connect(bands[i + 1]!)

    super(context, 'eq', 'EQ', bands[0]!, bands[bands.length - 1]!)
    this.bands = bands
  }

  get bandCount(): number {
    return this.bands.length
  }

  setBandFrequency(index: number, hz: number): void {
    this.band(index).frequency.setTargetAtTime(hz, this.context().currentTime, 0.01)
  }

  setBandGain(index: number, dB: number): void {
    this.band(index).gain.setTargetAtTime(dB, this.context().currentTime, 0.01)
  }

  setBandQ(index: number, q: number): void {
    this.band(index).Q.setTargetAtTime(q, this.context().currentTime, 0.01)
  }

  private band(index: number): BiquadFilterNode {
    const band = this.bands[index]
    if (!band) throw new RangeError(`EQ band ${index} out of range (${this.bands.length} bands)`)
    return band
  }

  private context(): BaseAudioContext {
    return this.bands[0]!.context
  }

  /**
   * Flattened per-band keys (`band0_frequency`, `band0_gain`, `band0_q`, `band1_...`) rather than
   * a nested structure, since EffectParams is a flat record shared by every effect kind.
   */
  getParams(): EffectParams {
    const params: EffectParams = { ...this.baseParams(), bandCount: this.bands.length }
    this.bands.forEach((band, i) => {
      params[`band${i}_frequency`] = band.frequency.value
      params[`band${i}_gain`] = band.gain.value
      params[`band${i}_q`] = band.Q.value
    })
    return params
  }

  setParams(params: EffectParams): void {
    this.applyBaseParams(params)
    this.bands.forEach((_, i) => {
      const frequency = params[`band${i}_frequency`]
      const gain = params[`band${i}_gain`]
      const q = params[`band${i}_q`]
      if (typeof frequency === 'number') this.setBandFrequency(i, frequency)
      if (typeof gain === 'number') this.setBandGain(i, gain)
      if (typeof q === 'number') this.setBandQ(i, q)
    })
  }

  dispose(): void {
    this.disposeBase()
    for (const band of this.bands) band.disconnect()
  }
}
