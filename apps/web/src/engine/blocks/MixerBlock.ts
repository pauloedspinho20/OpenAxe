import type { Block, EffectParams } from './Block'

/** @deprecated Web Audio staging replaced by `engine.cpp` per-input level/pan (issue #263). Kept for tests only. */
/** Fixed number of independent input jacks - covers 3 grid rows plus one spare. */
export const MIXER_INPUT_COUNT = 4

interface MixerInput {
  readonly gain: GainNode
  readonly panner: StereoPannerNode
}

/**
 * The explicit merge point: every other block accepts at most one incoming
 * cable, so combining two or more parallel signal paths always means
 * routing them into a Mixer's several independent input jacks (each with
 * its own level/pan), summed to one output.
 */
export class MixerBlock implements Block {
  readonly kind = 'mixer' as const
  private readonly context: BaseAudioContext
  private readonly output: GainNode
  private readonly inputs: MixerInput[]
  private disposed = false

  constructor(context: BaseAudioContext) {
    this.context = context
    this.output = new GainNode(context)
    this.inputs = Array.from({ length: MIXER_INPUT_COUNT }, () => {
      const gain = new GainNode(context)
      const panner = new StereoPannerNode(context)
      gain.connect(panner)
      panner.connect(this.output)
      return { gain, panner }
    })
  }

  /** The jack for input slot `index` (0-based) - connect a source into this directly. */
  inputNodeAt(index: number): AudioNode {
    return this.inputs[index]!.gain
  }

  /** Block-shaped single input - slot 0, for contexts that only expect one `inputNode`. */
  get inputNode(): AudioNode {
    return this.inputNodeAt(0)
  }

  get outputNode(): AudioNode {
    return this.output
  }

  setInputLevel(index: number, level: number): void {
    this.inputs[index]!.gain.gain.setTargetAtTime(level, this.context.currentTime, 0.01)
  }

  setInputPan(index: number, pan: number): void {
    this.inputs[index]!.panner.pan.setTargetAtTime(pan, this.context.currentTime, 0.01)
  }

  getParams(): EffectParams {
    const params: EffectParams = {}
    for (let i = 0; i < MIXER_INPUT_COUNT; i++) {
      params[`in${i}_level`] = this.inputs[i]!.gain.gain.value
      params[`in${i}_pan`] = this.inputs[i]!.panner.pan.value
    }
    return params
  }

  setParams(params: EffectParams): void {
    for (let i = 0; i < MIXER_INPUT_COUNT; i++) {
      const level = params[`in${i}_level`]
      const pan = params[`in${i}_pan`]
      if (typeof level === 'number') this.setInputLevel(i, level)
      if (typeof pan === 'number') this.setInputPan(i, pan)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const input of this.inputs) {
      input.gain.disconnect()
      input.panner.disconnect()
    }
    this.output.disconnect()
  }
}
