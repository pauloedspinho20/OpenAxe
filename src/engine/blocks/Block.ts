import type { EffectKind, EffectParams } from '../../effects/Effect'

export type { EffectParams } from '../../effects/Effect'

/**
 * Every placeable grid block kind: the 10 synthetic effects, `mixer`,
 * `splitter`, and the Tone3000 gear categories (`amp`/`amp-cab`/`pedal`/
 * `outboard`/`space`/`cab`) - these 6 gear kinds are named to match
 * Tone3000's own `Gear` enum exactly (see tone3000/types.ts), so a block's
 * `kind` doubles as the gear filter for browsing. Only `cab` is a genuinely
 * different asset type (an IR, convolved); the other 5 are all NAM model
 * captures, structurally identical - see AmpBlock's doc comment.
 */
export type BlockKind =
  EffectKind | 'amp' | 'amp-cab' | 'pedal' | 'outboard' | 'space' | 'cab' | 'mixer' | 'splitter'

/**
 * The minimal shape the graph engine needs from any block - a strict subset
 * of the existing `Effect` interface (no bypass/mix, which is an
 * effect-specific concept). `Effect` already satisfies this shape as-is, so
 * none of the 11 existing effect classes need to change to participate in
 * the grid.
 */
export interface Block {
  readonly kind: BlockKind
  readonly inputNode: AudioNode
  readonly outputNode: AudioNode
  getParams(): EffectParams
  setParams(params: EffectParams): void
  dispose(): void | Promise<void>
}
