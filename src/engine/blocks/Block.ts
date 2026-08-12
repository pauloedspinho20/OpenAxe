import type { EffectKind, EffectParams } from '../../effects/Effect'

export type { EffectParams } from '../../effects/Effect'

/** Every placeable grid block kind: the 11 effects, plus the 4 new block types. */
export type BlockKind = EffectKind | 'amp' | 'cab' | 'tone-stack' | 'mixer'

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
