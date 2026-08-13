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
/** ±12dB, matching the old AmpCabChain tone stack's range. */
const TONE_GAIN_LIMIT = 12

export class AmpBlock implements Block {
  readonly kind: NamModelBlockKind
  private readonly namNode: NamNode
  private readonly context: BaseAudioContext
  private disposed = false
  private loadedModel: LoadedAssetInfo | null = null
  private modelJson: string | null = null
  private slimmable: SlimmableInfo | null = null

  /** 4-band tone stack (Bass low-shelf, Mid peaking, Treble high-shelf, Presence peaking), wired after the model. */
  private readonly bassFilter: BiquadFilterNode
  private readonly midFilter: BiquadFilterNode
  private readonly trebleFilter: BiquadFilterNode
  private readonly presenceFilter: BiquadFilterNode
  private bassGain = 0
  private midGain = 0
  private trebleGain = 0
  private presenceGain = 0

  private constructor(context: BaseAudioContext, namNode: NamNode, kind: NamModelBlockKind) {
    this.context = context
    this.namNode = namNode
    this.kind = kind

    this.bassFilter = new BiquadFilterNode(context, { type: 'lowshelf', frequency: 100, gain: 0 })
    this.midFilter = new BiquadFilterNode(context, {
      type: 'peaking',
      frequency: 1000,
      Q: 0.7,
      gain: 0,
    })
    this.trebleFilter = new BiquadFilterNode(context, {
      type: 'highshelf',
      frequency: 5000,
      gain: 0,
    })
    this.presenceFilter = new BiquadFilterNode(context, {
      type: 'peaking',
      frequency: 8000,
      Q: 0.5,
      gain: 0,
    })

    namNode.connect(this.bassFilter)
    this.bassFilter.connect(this.midFilter)
    this.midFilter.connect(this.trebleFilter)
    this.trebleFilter.connect(this.presenceFilter)
  }

  static async create(engine: NamEngine, kind: NamModelBlockKind = 'amp'): Promise<AmpBlock> {
    const namNode = await engine.createNode()
    return new AmpBlock(engine.context, namNode, kind)
  }

  get inputNode(): AudioNode {
    return this.namNode
  }

  /** The tone stack's tail - colours the model output the same way a real amp's tone controls sit before the speaker. */
  get outputNode(): AudioNode {
    return this.presenceFilter
  }

  /** Set Bass shelf gain in dB (±12). */
  setBass(gain: number): void {
    this.bassGain = Math.min(TONE_GAIN_LIMIT, Math.max(-TONE_GAIN_LIMIT, gain))
    this.bassFilter.gain.setTargetAtTime(this.bassGain, this.context.currentTime, 0.01)
  }

  getBass(): number {
    return this.bassGain
  }

  /** Set Mid peaking gain in dB (±12). */
  setMid(gain: number): void {
    this.midGain = Math.min(TONE_GAIN_LIMIT, Math.max(-TONE_GAIN_LIMIT, gain))
    this.midFilter.gain.setTargetAtTime(this.midGain, this.context.currentTime, 0.01)
  }

  getMid(): number {
    return this.midGain
  }

  /** Set Treble shelf gain in dB (±12). */
  setTreble(gain: number): void {
    this.trebleGain = Math.min(TONE_GAIN_LIMIT, Math.max(-TONE_GAIN_LIMIT, gain))
    this.trebleFilter.gain.setTargetAtTime(this.trebleGain, this.context.currentTime, 0.01)
  }

  getTreble(): number {
    return this.trebleGain
  }

  /** Set Presence peaking gain in dB (±12). */
  setPresence(gain: number): void {
    this.presenceGain = Math.min(TONE_GAIN_LIMIT, Math.max(-TONE_GAIN_LIMIT, gain))
    this.presenceFilter.gain.setTargetAtTime(this.presenceGain, this.context.currentTime, 0.01)
  }

  getPresence(): number {
    return this.presenceGain
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

  /** Model loading is a separate action, not a continuous "param" - slim size and the tone stack are. */
  getParams(): EffectParams {
    return {
      ...(this.slimmable ? { slimSize: this.slimmable.currentSize } : {}),
      bass: this.bassGain,
      mid: this.midGain,
      treble: this.trebleGain,
      presence: this.presenceGain,
    }
  }

  setParams(params: EffectParams): void {
    if (typeof params.slimSize === 'number') void this.setModelSlimSize(params.slimSize)
    if (typeof params.bass === 'number') this.setBass(params.bass)
    if (typeof params.mid === 'number') this.setMid(params.mid)
    if (typeof params.treble === 'number') this.setTreble(params.treble)
    if (typeof params.presence === 'number') this.setPresence(params.presence)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.bassFilter.disconnect()
    this.midFilter.disconnect()
    this.trebleFilter.disconnect()
    this.presenceFilter.disconnect()
    await this.namNode.dispose()
  }
}
