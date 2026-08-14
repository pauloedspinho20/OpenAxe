import type { Block, EffectParams } from './Block'

/** Which IR is currently loaded, for saving into a preset. Null if none is loaded. */
export interface LoadedAssetInfo {
  id: string
  name: string
}

/** Headroom above unity, matching the Mix/Level convention used everywhere else (master, mixer, effects). */
const MAX_LEVEL = 1.5

/**
 * One cabinet IR convolution instance - a standalone grid block, separate
 * from the amp model it used to be fused with. Parallel wet/dry via
 * ConvolverNode, same as the old fused AmpCabChain's IR handling.
 */
export class CabBlock implements Block {
  readonly kind = 'cab' as const
  private readonly context: BaseAudioContext
  private readonly input: GainNode
  private readonly output: GainNode
  private readonly wetGain: GainNode
  private readonly dryGain: GainNode
  private irNode: ConvolverNode | null = null
  private irMix = 1
  private loadedIr: LoadedAssetInfo | null = null
  private disposed = false
  private inputLevel = 1
  private outputLevel = 1

  constructor(context: BaseAudioContext) {
    this.context = context
    this.input = new GainNode(context)
    this.output = new GainNode(context)
    this.wetGain = new GainNode(context, { gain: 1 })
    this.dryGain = new GainNode(context, { gain: 0 })
    this.input.connect(this.dryGain)
    this.dryGain.connect(this.output)
    this.wetGain.connect(this.output)
  }

  static create(context: BaseAudioContext): CabBlock {
    return new CabBlock(context)
  }

  get inputNode(): AudioNode {
    return this.input
  }

  get outputNode(): AudioNode {
    return this.output
  }

  loadIR(audioBuffer: AudioBuffer, mix = 1, info?: LoadedAssetInfo): void {
    const newIrNode = new ConvolverNode(this.context, { buffer: audioBuffer })
    this.input.connect(newIrNode)
    newIrNode.connect(this.wetGain)

    this.irNode?.disconnect()
    this.irNode = newIrNode
    this.loadedIr = info ?? null
    this.setIrMix(mix)
  }

  getLoadedIr(): LoadedAssetInfo | null {
    return this.loadedIr
  }

  setIrMix(mix: number): void {
    this.irMix = Math.min(1, Math.max(0, mix))
    const now = this.context.currentTime
    this.wetGain.gain.setTargetAtTime(this.irMix, now, 0.01)
    this.dryGain.gain.setTargetAtTime(1 - this.irMix, now, 0.01)
  }

  getIrMix(): number {
    return this.irMix
  }

  clearIR(): void {
    this.irNode?.disconnect()
    this.irNode = null
    this.loadedIr = null
    this.setIrMix(0)
  }

  /** Trim before the IR convolution - scales both the dry and wet paths equally, ahead of the mix. */
  setInputLevel(gain: number): void {
    this.inputLevel = Math.min(MAX_LEVEL, Math.max(0, gain))
    this.input.gain.setTargetAtTime(this.inputLevel, this.context.currentTime, 0.01)
  }

  getInputLevel(): number {
    return this.inputLevel
  }

  /** Trim after the dry/wet sum - the `output` node is already that summing point, so its own gain doubles as this. */
  setOutputLevel(gain: number): void {
    this.outputLevel = Math.min(MAX_LEVEL, Math.max(0, gain))
    this.output.gain.setTargetAtTime(this.outputLevel, this.context.currentTime, 0.01)
  }

  getOutputLevel(): number {
    return this.outputLevel
  }

  getParams(): EffectParams {
    return { irMix: this.irMix, inputLevel: this.inputLevel, outputLevel: this.outputLevel }
  }

  setParams(params: EffectParams): void {
    if (typeof params.irMix === 'number') this.setIrMix(params.irMix)
    if (typeof params.inputLevel === 'number') this.setInputLevel(params.inputLevel)
    if (typeof params.outputLevel === 'number') this.setOutputLevel(params.outputLevel)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.irNode?.disconnect()
    this.input.disconnect()
    this.output.disconnect()
    this.wetGain.disconnect()
    this.dryGain.disconnect()
  }
}
