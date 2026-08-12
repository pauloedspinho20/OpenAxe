/**
 * Common interface every pedal/rack effect implements, so EffectsChain can
 * wire them together and expose bypass/wet-dry uniformly without knowing
 * anything about each effect's internal DSP.
 */
export interface Effect {
  readonly name: string
  readonly inputNode: AudioNode
  readonly outputNode: AudioNode
  /** Wet mix in [0, 1]. 0 = fully dry (identical to bypass), 1 = fully processed. */
  setMix(wet: number): void
  getMix(): number
  /** Bypass forces the mix to 0 without discarding the previous mix value. */
  setBypass(bypassed: boolean): void
  isBypassed(): boolean
  dispose(): void | Promise<void>
}

const clampUnit = (value: number) => Math.min(1, Math.max(0, value))

/**
 * Handles the dry/wet crossfade and bypass plumbing shared by every effect,
 * so each concrete effect only has to build its own "wet" processing
 * subgraph (a chain from wetInput to wetOutput) instead of reimplementing
 * mix/bypass every time.
 */
export abstract class BaseEffect implements Effect {
  readonly name: string
  readonly inputNode: GainNode
  readonly outputNode: GainNode

  private readonly dryGain: GainNode
  private readonly wetGain: GainNode
  private mix = 1
  private bypassed = false
  private preBypassMix = 1

  protected constructor(
    context: BaseAudioContext,
    name: string,
    wetInput: AudioNode,
    wetOutput: AudioNode,
  ) {
    this.name = name
    this.inputNode = new GainNode(context)
    this.outputNode = new GainNode(context)
    this.dryGain = new GainNode(context)
    this.wetGain = new GainNode(context, { gain: 0 })

    this.inputNode.connect(this.dryGain)
    this.dryGain.connect(this.outputNode)
    this.inputNode.connect(wetInput)
    wetOutput.connect(this.wetGain)
    this.wetGain.connect(this.outputNode)
  }

  setMix(wet: number): void {
    this.mix = clampUnit(wet)
    if (!this.bypassed) this.applyMix(this.mix)
  }

  getMix(): number {
    return this.mix
  }

  setBypass(bypassed: boolean): void {
    if (bypassed === this.bypassed) return
    this.bypassed = bypassed
    if (bypassed) {
      this.preBypassMix = this.mix
      this.applyMix(0)
    } else {
      this.applyMix(this.preBypassMix)
      this.mix = this.preBypassMix
    }
  }

  isBypassed(): boolean {
    return this.bypassed
  }

  private applyMix(wet: number): void {
    const context = this.inputNode.context
    this.wetGain.gain.setTargetAtTime(wet, context.currentTime, 0.01)
    this.dryGain.gain.setTargetAtTime(1 - wet, context.currentTime, 0.01)
  }

  /** Disconnects the shared crossfade nodes. Subclasses must dispose their own wet subgraph. */
  protected disposeBase(): void {
    this.inputNode.disconnect()
    this.outputNode.disconnect()
    this.dryGain.disconnect()
    this.wetGain.disconnect()
  }

  abstract dispose(): void | Promise<void>
}
