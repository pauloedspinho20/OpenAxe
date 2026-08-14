import type { Block, EffectParams } from './Block'

/** Fixed number of independent output jacks. */
export const SPLITTER_OUTPUT_COUNT = 4

/**
 * The inverse of Mixer: one input fanned out to several independent output
 * jacks (each with its own level), so a single signal path can feed
 * multiple parallel downstream chains at different volumes.
 */
export class SplitterBlock implements Block {
  readonly kind = 'splitter' as const
  private readonly context: BaseAudioContext
  private readonly input: GainNode
  private readonly outputs: GainNode[]
  private disposed = false

  constructor(context: BaseAudioContext) {
    this.context = context
    this.input = new GainNode(context)
    this.outputs = Array.from({ length: SPLITTER_OUTPUT_COUNT }, () => {
      const gain = new GainNode(context)
      this.input.connect(gain)
      return gain
    })
  }

  /** The jack for output slot `index` (0-based) - connect this directly into a downstream block. */
  outputNodeAt(index: number): AudioNode {
    return this.outputs[index]!
  }

  get inputNode(): AudioNode {
    return this.input
  }

  /** Block-shaped single output - slot 0, for contexts that only expect one `outputNode`. */
  get outputNode(): AudioNode {
    return this.outputNodeAt(0)
  }

  setOutputLevel(index: number, level: number): void {
    this.outputs[index]!.gain.setTargetAtTime(level, this.context.currentTime, 0.01)
  }

  getParams(): EffectParams {
    const params: EffectParams = {}
    for (let i = 0; i < SPLITTER_OUTPUT_COUNT; i++) {
      params[`out${i}_level`] = this.outputs[i]!.gain.value
    }
    return params
  }

  setParams(params: EffectParams): void {
    for (let i = 0; i < SPLITTER_OUTPUT_COUNT; i++) {
      const level = params[`out${i}_level`]
      if (typeof level === 'number') this.setOutputLevel(i, level)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.input.disconnect()
    for (const output of this.outputs) output.disconnect()
  }
}
