import { NamAmpNode, type NamModelInfo } from '../NamAmpNode'
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
/** ±12dB, matching the core ToneStack's own clamp and the UI's knob range. */
const TONE_GAIN_LIMIT = 12
/** Headroom above unity, matching the Mix/Level convention used everywhere else (master, mixer, effects). */
const MAX_LEVEL = 1.5

export class AmpBlock implements Block {
  readonly kind: NamModelBlockKind
  private readonly namNode: NamAmpNode
  private readonly context: BaseAudioContext
  private disposed = false
  private loadedModel: LoadedAssetInfo | null = null
  private modelJson: string | null = null
  private slimmable: SlimmableInfo | null = null

  /** True input/output jacks - a trim before the model and a level after the tone stack, both just this block's own gain stages. */
  private readonly inputGain: GainNode
  private readonly outputGain: GainNode

  /**
   * True bypass: when engaged, the raw input passes straight through
   * unprocessed instead of through the model/tone stack - there's no
   * continuous mix like an effect's, just a binary switch (like a real
   * amp's bypass footswitch). `input`/`output` are the external jacks;
   * `inputGain`/`outputGain` keep their existing trim role inside the wet
   * path, which `dryGain`/`wetMuteGain` crossfade around.
   */
  private readonly input: GainNode
  private readonly output: GainNode
  private readonly dryGain: GainNode
  private readonly wetMuteGain: GainNode
  private bypassed = false

  /**
   * 4-band tone stack (Bass low-shelf, Mid peaking, Treble high-shelf, Presence
   * peaking), applied after the model. The DSP lives in the core alongside the
   * inference (`packages/core/src/dsp/tone_stack.cpp`) and is driven through the
   * worklet's AudioParams; these fields are just the mirrored knob values the UI
   * reads back. It used to be four Web Audio BiquadFilterNodes here, which meant
   * the desktop app - driving the same core - had no tone controls at all.
   */
  private bassGain = 0
  private midGain = 0
  private trebleGain = 0
  private presenceGain = 0
  private inputLevel = 1
  private outputLevel = 1

  private constructor(context: BaseAudioContext, namNode: NamAmpNode, kind: NamModelBlockKind) {
    this.context = context
    this.namNode = namNode
    this.kind = kind

    this.inputGain = new GainNode(context)
    this.outputGain = new GainNode(context)
    this.inputGain.connect(namNode.node)
    namNode.node.connect(this.outputGain)

    this.input = new GainNode(context)
    this.output = new GainNode(context)
    this.dryGain = new GainNode(context, { gain: 0 })
    this.wetMuteGain = new GainNode(context, { gain: 1 })

    this.input.connect(this.inputGain)
    this.input.connect(this.dryGain)
    this.outputGain.connect(this.wetMuteGain)
    this.wetMuteGain.connect(this.output)
    this.dryGain.connect(this.output)
  }

  // The NAM inference itself runs in packages/core (see NamAmpNode); this class
  // owns the Web Audio staging around it - the trims, the tone stack and true
  // bypass. Those three are the web path's remaining local DSP; the desktop
  // path gets trims and bypass from the core instead, and the tone stack not at
  // all (see ARCHITECTURE.md).
  static async create(
    context: BaseAudioContext,
    kind: NamModelBlockKind = 'amp',
  ): Promise<AmpBlock> {
    const namNode = await NamAmpNode.create(context)
    return new AmpBlock(context, namNode, kind)
  }

  get inputNode(): AudioNode {
    return this.input
  }

  /** After the tone stack's output level trim - colours the model output the same way a real amp's tone controls sit before the speaker. */
  get outputNode(): AudioNode {
    return this.output
  }

  /** True bypass - the model/tone stack is silenced and the raw input passes straight through. */
  setBypass(bypassed: boolean): void {
    if (bypassed === this.bypassed) return
    this.bypassed = bypassed
    const now = this.context.currentTime
    this.wetMuteGain.gain.setTargetAtTime(bypassed ? 0 : 1, now, 0.01)
    this.dryGain.gain.setTargetAtTime(bypassed ? 1 : 0, now, 0.01)
  }

  isBypassed(): boolean {
    return this.bypassed
  }

  /** Trim before the model - useful for gain-staging a hot DI signal or a quiet pickup. */
  setInputLevel(gain: number): void {
    this.inputLevel = Math.min(MAX_LEVEL, Math.max(0, gain))
    this.inputGain.gain.setTargetAtTime(this.inputLevel, this.context.currentTime, 0.01)
  }

  getInputLevel(): number {
    return this.inputLevel
  }

  /** Trim after the tone stack - independent of the model's own loudness. */
  setOutputLevel(gain: number): void {
    this.outputLevel = Math.min(MAX_LEVEL, Math.max(0, gain))
    this.outputGain.gain.setTargetAtTime(this.outputLevel, this.context.currentTime, 0.01)
  }

  getOutputLevel(): number {
    return this.outputLevel
  }

  /** Set Bass shelf gain in dB (±12). */
  setBass(gain: number): void {
    this.bassGain = Math.min(TONE_GAIN_LIMIT, Math.max(-TONE_GAIN_LIMIT, gain))
    this.namNode.setToneGainDb('bass', this.bassGain)
  }

  getBass(): number {
    return this.bassGain
  }

  /** Set Mid peaking gain in dB (±12). */
  setMid(gain: number): void {
    this.midGain = Math.min(TONE_GAIN_LIMIT, Math.max(-TONE_GAIN_LIMIT, gain))
    this.namNode.setToneGainDb('mid', this.midGain)
  }

  getMid(): number {
    return this.midGain
  }

  /** Set Treble shelf gain in dB (±12). */
  setTreble(gain: number): void {
    this.trebleGain = Math.min(TONE_GAIN_LIMIT, Math.max(-TONE_GAIN_LIMIT, gain))
    this.namNode.setToneGainDb('treble', this.trebleGain)
  }

  getTreble(): number {
    return this.trebleGain
  }

  /** Set Presence peaking gain in dB (±12). */
  setPresence(gain: number): void {
    this.presenceGain = Math.min(TONE_GAIN_LIMIT, Math.max(-TONE_GAIN_LIMIT, gain))
    this.namNode.setToneGainDb('presence', this.presenceGain)
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

  /**
   * Re-slim the currently loaded model. No-op if not slimmable, or if the
   * size hasn't actually changed - bindGraphRig's reconcile reapplies every
   * block's full params on every store change (see its doc comment), so this
   * runs far more often than the user actually touches a slim-size control.
   * Uses NamAmpNode.setSlimSize (a lightweight re-slim), not loadModel, which
   * reparses the whole model and pauses rendering for ~100-300ms - calling
   * that on every reconcile pass was audible as the output cutting out
   * whenever *any* block's params changed, not just this one's.
   */
  async setModelSlimSize(slimSize: number): Promise<void> {
    if (!this.modelJson || !this.slimmable) return
    const clamped = Math.min(1, Math.max(0.01, slimSize))
    if (clamped === this.slimmable.currentSize) return
    await this.namNode.setSlimSize(clamped)
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

  /** Model loading is a separate action, not a continuous "param" - slim size, the tone stack, and the in/out levels are. */
  getParams(): EffectParams {
    return {
      ...(this.slimmable ? { slimSize: this.slimmable.currentSize } : {}),
      bass: this.bassGain,
      mid: this.midGain,
      treble: this.trebleGain,
      presence: this.presenceGain,
      input_level: this.inputLevel,
      output_level: this.outputLevel,
    }
  }

  setParams(params: EffectParams): void {
    if (typeof params.slimSize === 'number') void this.setModelSlimSize(params.slimSize)
    if (typeof params.bass === 'number') this.setBass(params.bass)
    if (typeof params.mid === 'number') this.setMid(params.mid)
    if (typeof params.treble === 'number') this.setTreble(params.treble)
    if (typeof params.presence === 'number') this.setPresence(params.presence)
    if (typeof params.input_level === 'number') this.setInputLevel(params.input_level)
    if (typeof params.output_level === 'number') this.setOutputLevel(params.output_level)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.input.disconnect()
    this.output.disconnect()
    this.dryGain.disconnect()
    this.wetMuteGain.disconnect()
    this.inputGain.disconnect()
    this.outputGain.disconnect()
    await this.namNode.dispose()
  }
}
