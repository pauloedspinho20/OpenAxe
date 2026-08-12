import { BaseEffect } from './Effect'

/**
 * Freeverb (Jezar at Dreampoint, public domain): 8 parallel damped feedback
 * comb filters summed together, feeding 4 series Schroeder allpass filters
 * for diffusion. Built here from native DelayNode/BiquadFilterNode/GainNode
 * per the algorithm's well-documented structure - not a port of any
 * particular codebase, just the classic DSP math on Web Audio's node graph.
 *
 * Delay lengths are Freeverb's original constants, specified in samples at
 * its reference 44100 Hz and converted to seconds so the room size sounds
 * the same regardless of the AudioContext's actual sample rate.
 */

const REFERENCE_SAMPLE_RATE = 44100
const COMB_DELAYS_SAMPLES = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116]
const ALLPASS_DELAYS_SAMPLES = [225, 556, 441, 341]
const ALLPASS_FEEDBACK = 0.5

interface Comb {
  readonly delay: DelayNode
  readonly damping: BiquadFilterNode
  readonly feedbackGain: GainNode
}

function createComb(context: BaseAudioContext, delaySeconds: number): Comb {
  const delay = new DelayNode(context, {
    delayTime: delaySeconds,
    maxDelayTime: delaySeconds + 0.01,
  })
  const damping = new BiquadFilterNode(context, { type: 'lowpass', frequency: 8000 })
  const feedbackGain = new GainNode(context, { gain: 0.84 })

  delay.connect(damping)
  damping.connect(feedbackGain)
  feedbackGain.connect(delay)

  return { delay, damping, feedbackGain }
}

interface Allpass {
  readonly delay: DelayNode
  readonly input: GainNode
  readonly output: GainNode
  readonly feedbackGain: GainNode
  readonly feedforwardGain: GainNode
  readonly compensationGain: GainNode
}

/** Schroeder allpass: y = -g*x + (1-g^2)*delayed(x + g*delayed), built from native nodes. */
function createAllpass(context: BaseAudioContext, delaySeconds: number, g: number): Allpass {
  const input = new GainNode(context)
  const output = new GainNode(context)
  const delay = new DelayNode(context, {
    delayTime: delaySeconds,
    maxDelayTime: delaySeconds + 0.01,
  })
  const feedbackGain = new GainNode(context, { gain: g })
  const feedforwardGain = new GainNode(context, { gain: -g })
  const compensationGain = new GainNode(context, { gain: 1 - g * g })

  input.connect(delay)
  delay.connect(feedbackGain)
  feedbackGain.connect(delay)

  input.connect(feedforwardGain)
  feedforwardGain.connect(output)
  delay.connect(compensationGain)
  compensationGain.connect(output)

  return { delay, input, output, feedbackGain, feedforwardGain, compensationGain }
}

export class Freeverb extends BaseEffect {
  private readonly input: GainNode
  private readonly combSum: GainNode
  private readonly combs: Comb[]
  private readonly allpasses: Allpass[]
  private roomSize = 0.84
  private damping = 0.5

  constructor(context: BaseAudioContext) {
    const input = new GainNode(context)
    const combSum = new GainNode(context, { gain: 1 / 8 })
    const combs = COMB_DELAYS_SAMPLES.map((samples) =>
      createComb(context, samples / REFERENCE_SAMPLE_RATE),
    )
    for (const comb of combs) {
      input.connect(comb.delay)
      comb.delay.connect(combSum)
    }

    const allpasses = ALLPASS_DELAYS_SAMPLES.map((samples) =>
      createAllpass(context, samples / REFERENCE_SAMPLE_RATE, ALLPASS_FEEDBACK),
    )
    let previous: AudioNode = combSum
    for (const allpass of allpasses) {
      previous.connect(allpass.input)
      previous = allpass.output
    }

    super(context, 'Reverb', input, previous)
    this.input = input
    this.combSum = combSum
    this.combs = combs
    this.allpasses = allpasses
    this.setRoomSize(this.roomSize)
    this.setDamping(this.damping)
  }

  /** Decay length, [0, 1]. Higher rings out longer (feedback approaches 1). */
  setRoomSize(size: number): void {
    this.roomSize = Math.min(0.97, Math.max(0, size))
    const now = this.combs[0]!.feedbackGain.context.currentTime
    for (const comb of this.combs) comb.feedbackGain.gain.setTargetAtTime(this.roomSize, now, 0.01)
  }

  /** High-frequency damping in the tail, [0, 1]. Higher = darker decay. */
  setDamping(damping: number): void {
    this.damping = Math.min(1, Math.max(0, damping))
    const cutoff = 12000 - this.damping * 11000
    const now = this.combs[0]!.damping.context.currentTime
    for (const comb of this.combs) comb.damping.frequency.setTargetAtTime(cutoff, now, 0.01)
  }

  dispose(): void {
    this.disposeBase()
    this.input.disconnect()
    this.combSum.disconnect()
    for (const comb of this.combs) {
      comb.delay.disconnect()
      comb.damping.disconnect()
      comb.feedbackGain.disconnect()
    }
    for (const allpass of this.allpasses) {
      allpass.input.disconnect()
      allpass.output.disconnect()
      allpass.delay.disconnect()
      allpass.feedbackGain.disconnect()
      allpass.feedforwardGain.disconnect()
      allpass.compensationGain.disconnect()
    }
  }
}
