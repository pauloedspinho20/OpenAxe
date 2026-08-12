import type { Block, EffectParams } from './Block'

/** Which IR is currently loaded, for saving into a preset. Null if none is loaded. */
export interface LoadedAssetInfo {
  id: string
  name: string
}

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

  getParams(): EffectParams {
    return { irMix: this.irMix }
  }

  setParams(params: EffectParams): void {
    if (typeof params.irMix === 'number') this.setIrMix(params.irMix)
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
