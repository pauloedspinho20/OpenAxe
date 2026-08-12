import { BaseEffect } from './Effect'

export type DriveType = 'overdrive' | 'distortion' | 'fuzz'

const CURVE_SIZE = 2048

/** Soft tanh-style saturation - smooth, amp-like breakup. */
function overdriveCurve(amount: number): Float32Array {
  const curve = new Float32Array(CURVE_SIZE)
  const k = 1 + amount * 20
  for (let i = 0; i < CURVE_SIZE; i++) {
    const x = (i * 2) / CURVE_SIZE - 1
    curve[i] = Math.tanh(k * x) / Math.tanh(k)
  }
  return curve
}

/**
 * Classic WaveShaperNode distortion curve (the formula from the Web Audio
 * API spec's own distortion example) - steeper, harder-edged than the
 * tanh overdrive above.
 */
function distortionCurve(amount: number): Float32Array {
  const curve = new Float32Array(CURVE_SIZE)
  const k = amount * 100
  const deg = Math.PI / 180
  for (let i = 0; i < CURVE_SIZE; i++) {
    const x = (i * 2) / CURVE_SIZE - 1
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x))
  }
  return curve
}

/** Asymmetric hard clip - the lopsided clipping of a diode fuzz circuit. */
function fuzzCurve(amount: number): Float32Array {
  const curve = new Float32Array(CURVE_SIZE)
  const gain = 1 + amount * 40
  for (let i = 0; i < CURVE_SIZE; i++) {
    const x = (i * 2) / CURVE_SIZE - 1
    const driven = x * gain
    curve[i] = Math.max(-0.6, Math.min(1, driven))
  }
  return curve
}

const CURVE_BUILDERS: Record<DriveType, (amount: number) => Float32Array> = {
  overdrive: overdriveCurve,
  distortion: distortionCurve,
  fuzz: fuzzCurve,
}

/**
 * Overdrive/distortion/fuzz via WaveShaperNode - our own curve math, not
 * ported from any pedal circuit in particular.
 */
export class Drive extends BaseEffect {
  private readonly shaper: WaveShaperNode
  private readonly tone: BiquadFilterNode
  private readonly makeupGain: GainNode
  private type: DriveType
  private amount = 0.5

  constructor(context: BaseAudioContext, type: DriveType = 'overdrive') {
    const shaper = new WaveShaperNode(context, { oversample: '4x' })
    const tone = new BiquadFilterNode(context, { type: 'lowpass', frequency: 8000 })
    const makeupGain = new GainNode(context, { gain: 0.7 })
    shaper.connect(tone)
    tone.connect(makeupGain)

    super(context, 'Drive', shaper, makeupGain)
    this.shaper = shaper
    this.tone = tone
    this.makeupGain = makeupGain
    this.type = type
    this.applyCurve()
  }

  setType(type: DriveType): void {
    this.type = type
    this.applyCurve()
  }

  /** Drive amount in [0, 1]; regenerates the waveshaping curve. */
  setDrive(amount: number): void {
    this.amount = Math.min(1, Math.max(0, amount))
    this.applyCurve()
  }

  private applyCurve(): void {
    // WaveShaperNode.curve's DOM type is Float32Array<ArrayBuffer>; plain
    // `new Float32Array(n)` infers the more general ArrayBufferLike.
    this.shaper.curve = CURVE_BUILDERS[this.type](this.amount) as Float32Array<ArrayBuffer>
  }

  /** Post-clipping lowpass in Hz, to tame harsh high-order harmonics. */
  setTone(hz: number): void {
    this.tone.frequency.setTargetAtTime(hz, this.tone.context.currentTime, 0.01)
  }

  setOutputLevel(gain: number): void {
    this.makeupGain.gain.setTargetAtTime(gain, this.makeupGain.context.currentTime, 0.01)
  }

  dispose(): void {
    this.disposeBase()
    this.shaper.disconnect()
    this.tone.disconnect()
    this.makeupGain.disconnect()
  }
}
