/** A serializable snapshot of one effect's tunable parameters, for presets. */
export type EffectParams = Record<string, number | string | boolean>

/**
 * Stable machine-readable identifiers for each effect kind - distinct from
 * `name` (a display label, which can vary). Presets store `kind`, never
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
 *
 * Note (issue #55): the web audio path no longer constructs these - all DSP
 * lives in the core behind the single rig worklet. This interface and
 * EffectsChain are kept only as the UI's param-plumbing type surface; the
 * concrete effect classes (and their wet/dry staging, the old BaseEffect) were
 * deleted once nothing used them.
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
