/** A serializable snapshot of one effect's tunable parameters, for presets. */
export type EffectParams = Record<string, number | string | boolean>

/**
 * Stable machine-readable identifiers for each effect class - distinct from
 * `name` (a display label, which can vary: e.g. Delay's name changes to
 * "Tape Delay" depending on its character). Presets store `kind`, never
 * `name`, so renaming a display label never breaks saved presets.
 */
export type EffectKind =
  | 'noise-gate'
  | 'compressor'
  | 'eq'
  | 'chorus'
  | 'flanger'
  | 'phaser'
  | 'tremolo'
  | 'delay'
  | 'ping-pong-delay'
  | 'reverb'

/**
 * Common interface every pedal/rack effect implements, so EffectsChain can
 * wire them together and expose bypass/wet-dry uniformly without knowing
 * anything about each effect's internal DSP.
 */
export interface Effect {
  readonly kind: EffectKind
  readonly name: string
  readonly inputNode: AudioNode
  readonly outputNode: AudioNode
  /** Wet mix in [0, 1]. 0 = fully dry (identical to bypass), 1 = fully processed. */
  setMix(wet: number): void
  getMix(): number
  /** Bypass forces the mix to 0 without discarding the previous mix value. */
  setBypass(bypassed: boolean): void
  isBypassed(): boolean
  /** Output trim, applied to the wet signal only - like Mix, has no audible effect while bypassed. */
  setLevel(gain: number): void
  getLevel(): number
  /** This effect's current tunable parameters, for saving into a preset. */
  getParams(): EffectParams
  /** Restore parameters previously returned by getParams(), e.g. when loading a preset. */
  setParams(params: EffectParams): void
  dispose(): void | Promise<void>
}

const clampUnit = (value: number) => Math.min(1, Math.max(0, value))
/** Matches the Knob convention used for other post-gain trims (e.g. the master/mixer levels) - +3.5dB of headroom, not just unity. */
const MAX_LEVEL = 1.5
const clampLevel = (value: number) => Math.min(MAX_LEVEL, Math.max(0, value))

/**
 * Handles the dry/wet crossfade and bypass plumbing shared by every effect,
 * so each concrete effect only has to build its own "wet" processing
 * subgraph (a chain from wetInput to wetOutput) instead of reimplementing
 * mix/bypass every time.
 */
export abstract class BaseEffect implements Effect {
  readonly kind: EffectKind
  readonly name: string
  readonly inputNode: GainNode
  readonly outputNode: GainNode

  private readonly dryGain: GainNode
  private readonly wetGain: GainNode
  private mix = 1
  private bypassed = false
  private level = 1

  protected constructor(
    context: BaseAudioContext,
    kind: EffectKind,
    name: string,
    wetInput: AudioNode,
    wetOutput: AudioNode,
  ) {
    this.kind = kind
    this.name = name
    this.inputNode = new GainNode(context)
    this.outputNode = new GainNode(context)
    // Mirrors the default `mix = 1` (fully wet) below - GainNode's own
    // default gain is 1, so without this the dry path would carry the full
    // signal and the wet path none, silently bypassing every effect no
    // matter what its params were set to until something called setMix().
    this.dryGain = new GainNode(context, { gain: 0 })
    this.wetGain = new GainNode(context, { gain: 1 })

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
    // `this.mix` is already kept current by setMix regardless of bypass
    // state (only the graph write is gated on it below) - un-bypassing just
    // re-applies whatever it currently is, correctly picking up any Mix/
    // Level change made while bypassed instead of reverting it.
    this.applyMix(bypassed ? 0 : this.mix)
  }

  isBypassed(): boolean {
    return this.bypassed
  }

  /**
   * Output trim - folded into the wet path's own gain (wetGain = mix *
   * level) rather than the shared outputNode, which is also where the dry
   * bypass signal sums in. Applying it there would mean Level (and Mix)
   * still audibly scaled a bypassed pedal's passthrough - a real footswitch
   * bypass is a hard, unaffected-by-any-knob unity passthrough, and
   * `applyMix`'s `1 - wet` dry gain has no dependency on `level` at all.
   */
  setLevel(gain: number): void {
    this.level = clampLevel(gain)
    if (!this.bypassed) this.applyMix(this.mix)
  }

  getLevel(): number {
    return this.level
  }

  private applyMix(wet: number): void {
    const context = this.inputNode.context
    this.wetGain.gain.setTargetAtTime(wet * this.level, context.currentTime, 0.01)
    this.dryGain.gain.setTargetAtTime(1 - wet, context.currentTime, 0.01)
  }

  /**
   * Mix and Level are common to every effect kind - concrete subclasses
   * spread `...this.baseParams()` into their own getParams() and call
   * `this.applyBaseParams(params)` from their own setParams(), so both
   * round-trip through presets exactly like any other param instead of
   * needing a bespoke UI path (see paramSchema.ts's MIX_LEVEL_FIELDS).
   */
  protected baseParams(): EffectParams {
    return { mix: this.mix, level: this.level }
  }

  protected applyBaseParams(params: EffectParams): void {
    if (typeof params.mix === 'number') this.setMix(params.mix)
    if (typeof params.level === 'number') this.setLevel(params.level)
  }

  /** Disconnects the shared crossfade nodes. Subclasses must dispose their own wet subgraph. */
  protected disposeBase(): void {
    this.inputNode.disconnect()
    this.outputNode.disconnect()
    this.dryGain.disconnect()
    this.wetGain.disconnect()
  }

  abstract getParams(): EffectParams
  abstract setParams(params: EffectParams): void
  abstract dispose(): void | Promise<void>
}
