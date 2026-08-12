import { NamEngine, NamNode, type NamModelInfo } from 'neural-amp-modeler-wasm/engine'
import type { Block, EffectParams } from './Block'

/** Which model is currently loaded, for saving into a preset. Null if none is loaded. */
export interface LoadedAssetInfo {
  id: string
  name: string
}

/** Slimming options returned by a loaded slimmable model. */
export interface SlimmableInfo {
  breakpoints: number[]
  currentSize: number
}

/** Every gear category that's a NAM model capture rather than an IR - see CabBlock for the IR case. */
export type NamModelBlockKind = 'amp' | 'amp-cab' | 'pedal' | 'outboard' | 'space'

/**
 * One NAM model instance - a standalone grid block. Structurally identical
 * regardless of gear category: on Tone3000, `amp`/`amp-cab`/`pedal`/
 * `outboard`/`space` are all model-format captures (an "amp-cab" entry is a
 * single combo-unit capture with the speaker baked in, not a separate amp
 * + IR pairing - see the engine README/plan notes). `kind` only changes
 * which gear filter Tone3000 browsing uses and how the block is labeled;
 * one class covers all five rather than four near-duplicate ones.
 * `inputNode`/`outputNode` are the underlying `NamNode` itself, which is
 * already mono-in/mono-out and stays the same instance across model swaps.
 */
export class AmpBlock implements Block {
  readonly kind: NamModelBlockKind
  private readonly namNode: NamNode
  private disposed = false
  private loadedModel: LoadedAssetInfo | null = null
  private modelJson: string | null = null
  private slimmable: SlimmableInfo | null = null

  private constructor(namNode: NamNode, kind: NamModelBlockKind) {
    this.namNode = namNode
    this.kind = kind
  }

  static async create(engine: NamEngine, kind: NamModelBlockKind = 'amp'): Promise<AmpBlock> {
    const namNode = await engine.createNode()
    return new AmpBlock(namNode, kind)
  }

  get inputNode(): AudioNode {
    return this.namNode
  }

  get outputNode(): AudioNode {
    return this.namNode
  }

  async loadModel(json: string, slimSize?: number, info?: LoadedAssetInfo): Promise<NamModelInfo> {
    const modelInfo = await this.namNode.loadModel(
      json,
      slimSize === undefined ? undefined : { slimSize },
    )
    this.modelJson = json
    this.loadedModel = info ?? null
    if (modelInfo.slimmable && modelInfo.slimmableBreakpoints) {
      this.slimmable = {
        breakpoints: modelInfo.slimmableBreakpoints,
        currentSize: slimSize ?? 1,
      }
    } else {
      this.slimmable = null
    }
    return modelInfo
  }

  /** Re-load the currently loaded model with a different slim size. No-op if not slimmable. */
  async setModelSlimSize(slimSize: number): Promise<void> {
    if (!this.modelJson || !this.slimmable) return
    const clamped = Math.min(1, Math.max(0.01, slimSize))
    await this.namNode.loadModel(this.modelJson, { slimSize: clamped })
    this.slimmable.currentSize = clamped
  }

  getSlimmableInfo(): SlimmableInfo | null {
    return this.slimmable
  }

  async unloadModel(): Promise<void> {
    await this.namNode.unloadModel()
    this.loadedModel = null
    this.modelJson = null
    this.slimmable = null
  }

  getLoadedModel(): LoadedAssetInfo | null {
    return this.loadedModel
  }

  /** Only the slim size is a continuous "param" - model loading is a separate action. */
  getParams(): EffectParams {
    return this.slimmable ? { slimSize: this.slimmable.currentSize } : {}
  }

  setParams(params: EffectParams): void {
    if (typeof params.slimSize === 'number') void this.setModelSlimSize(params.slimSize)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await this.namNode.dispose()
  }
}
