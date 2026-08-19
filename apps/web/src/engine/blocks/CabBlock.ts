import { CabIrNode } from '../CabIrNode'
import type { Block, EffectParams } from './Block'

/** Which IR is currently loaded, for saving into a preset. Null if none is loaded. */
export interface LoadedAssetInfo {
  id: string
  name: string
}

/** Headroom above unity, matching the Mix/Level convention used everywhere else (master, mixer, effects). */
const MAX_LEVEL = 1.5

/**
 * One cabinet IR convolution instance - a standalone grid block, separate from
 * the amp model it used to be fused with.
 *
 * The convolution and its wet/dry blend both run in `packages/core` behind an
 * AudioWorklet (see `CabIrNode`); this class owns only the block's Web Audio
 * staging, the input/output trims. It used to be a Web Audio `ConvolverNode`
 * with parallel wet/dry gains, which is why cab blocks did nothing at all on the
 * desktop app - the core had no convolution to drive.
 *
 * `create` is async now (the worklet has to be registered and the WASM fetched),
 * matching every other core-backed block.
 */
export class CabBlock implements Block {
  readonly kind = 'cab' as const
  private readonly context: BaseAudioContext
  private readonly input: GainNode
  private readonly output: GainNode
  private readonly ir: CabIrNode
  private irMix = 1
  private loadedIr: LoadedAssetInfo | null = null
  private disposed = false
  private inputLevel = 1
  private outputLevel = 1

  private constructor(context: BaseAudioContext, ir: CabIrNode) {
    this.context = context
    this.ir = ir
    this.input = new GainNode(context)
    this.output = new GainNode(context)
    // The core handles the wet/dry blend, so the block is a straight line: trim,
    // convolve, trim.
    this.input.connect(ir.node)
    ir.node.connect(this.output)
  }

  static async create(context: BaseAudioContext): Promise<CabBlock> {
    return new CabBlock(context, await CabIrNode.create(context))
  }

  get inputNode(): AudioNode {
    return this.input
  }

  get outputNode(): AudioNode {
    return this.output
  }

  /**
   * Install a decoded IR. Fire-and-forget for callers that don't care when the
   * core has it (the UI treats loading as immediate); the returned promise
   * rejects if the core refuses the buffer.
   */
  loadIR(audioBuffer: AudioBuffer, mix = 1, info?: LoadedAssetInfo): Promise<number> {
    this.loadedIr = info ?? null
    this.setIrMix(mix)
    return this.ir.loadIr(audioBuffer)
  }

  getLoadedIr(): LoadedAssetInfo | null {
    return this.loadedIr
  }

  setIrMix(mix: number): void {
    this.irMix = Math.min(1, Math.max(0, mix))
    this.ir.setIrMix(this.irMix)
  }

  getIrMix(): number {
    return this.irMix
  }

  clearIR(): void {
    this.loadedIr = null
    void this.ir.unloadIr()
  }

  /** Trim before the convolution, so it scales what the IR sees. */
  setInputLevel(gain: number): void {
    this.inputLevel = Math.min(MAX_LEVEL, Math.max(0, gain))
    this.input.gain.setTargetAtTime(this.inputLevel, this.context.currentTime, 0.01)
  }

  getInputLevel(): number {
    return this.inputLevel
  }

  /** Trim after the convolution - the `output` node's own gain doubles as this. */
  setOutputLevel(gain: number): void {
    this.outputLevel = Math.min(MAX_LEVEL, Math.max(0, gain))
    this.output.gain.setTargetAtTime(this.outputLevel, this.context.currentTime, 0.01)
  }

  getOutputLevel(): number {
    return this.outputLevel
  }

  getParams(): EffectParams {
    return { irMix: this.irMix, input_level: this.inputLevel, output_level: this.outputLevel }
  }

  setParams(params: EffectParams): void {
    if (typeof params.irMix === 'number') this.setIrMix(params.irMix)
    if (typeof params.input_level === 'number') this.setInputLevel(params.input_level)
    if (typeof params.output_level === 'number') this.setOutputLevel(params.output_level)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.ir.dispose()
    this.input.disconnect()
    this.output.disconnect()
  }
}
