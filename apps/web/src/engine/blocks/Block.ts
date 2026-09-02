import type { Gear } from '@/tone3000/types'
import type { EffectKind, EffectParams } from '../../effects/Effect'

export type { EffectParams } from '../../effects/Effect'

/**
 * Every placeable grid block kind: the 10 synthetic effects, `mixer`,
 * the Tone3000 gear categories (`amp`/`amp-cab`/`pedal`/
 * `outboard`/`space`/`cab`) - these 6 gear kinds are named to match
 * Tone3000's own `Gear` enum exactly (see tone3000/types.ts), so a block's
 * `kind` doubles as the gear filter for browsing. Only `cab` is a genuinely
 * different asset type (an IR, convolved); the other 5 are all NAM model
 * captures, structurally identical - see AmpBlock's doc comment.
 *
 * The four Send/Return kinds (issue #274) are routing relays, not effects:
 * a Send N is input-only and hops its signal implicitly (no cable) to the
 * Return N, which is output-only. They carry no params, bypass or asset.
 */
export type BlockKind = EffectKind | Gear | 'mixer' | 'send-1' | 'return-1' | 'send-2' | 'return-2'

/**
 * The minimal shape the graph engine needs from any block - a strict subset
 * of the existing `Effect` interface (no bypass/mix, which is an
 * effect-specific concept). `Effect` already satisfies this shape as-is, so
 * none of the 10 existing effect classes need to change to participate in
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
