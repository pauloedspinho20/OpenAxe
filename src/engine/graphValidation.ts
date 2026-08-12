import { GRID_COLS, IN_RAIL, OUT_RAIL, jackKey, type Jack } from './gridConfig'
import { MIXER_INPUT_COUNT } from './blocks/MixerBlock'
import type { BlockKind } from './blocks/Block'

export type ConnectResult = { ok: true } | { ok: false; reason: string }

/** The minimal block shape validation needs - satisfied by both live BlockEntry and plain BlockInstance. */
export interface ValidatableBlock {
  id: string
  kind: BlockKind
  col: number
}

export interface ValidatableEdge {
  from: Jack
  to: Jack
}

function columnOf(blocks: ReadonlyMap<string, ValidatableBlock>, blockId: string): number {
  if (blockId === IN_RAIL) return -1
  if (blockId === OUT_RAIL) return GRID_COLS
  return blocks.get(blockId)?.col ?? GRID_COLS
}

function maxPortFor(blocks: ReadonlyMap<string, ValidatableBlock>, blockId: string): number {
  if (blockId === OUT_RAIL) return 0
  return blocks.get(blockId)?.kind === 'mixer' ? MIXER_INPUT_COUNT - 1 : 0
}

/**
 * Shared connection rules, used identically by the live GraphRig and the
 * plain-data graphStore so a UI-level connect and an engine-level connect
 * can never disagree: left-to-right by column only (no cycles possible by
 * construction), and at most one cable per input jack (a Mixer's several
 * ports each count separately).
 */
export function canConnect(
  blocks: ReadonlyMap<string, ValidatableBlock>,
  edges: Iterable<ValidatableEdge>,
  from: Jack,
  to: Jack,
): ConnectResult {
  if (jackKey(from) === jackKey(to)) return { ok: false, reason: 'Cannot connect a jack to itself' }
  if (from.blockId !== IN_RAIL && !blocks.has(from.blockId)) {
    return { ok: false, reason: 'Unknown source block' }
  }
  if (to.blockId !== OUT_RAIL && !blocks.has(to.blockId)) {
    return { ok: false, reason: 'Unknown target block' }
  }
  if (!(columnOf(blocks, from.blockId) < columnOf(blocks, to.blockId))) {
    return { ok: false, reason: 'Connections must go left to right' }
  }
  const maxPort = maxPortFor(blocks, to.blockId)
  if (to.port < 0 || to.port > maxPort) return { ok: false, reason: 'Invalid input jack' }
  for (const edge of edges) {
    if (jackKey(edge.to) === jackKey(to))
      return { ok: false, reason: 'That input is already connected' }
  }
  return { ok: true }
}

/** True if this edge's ordering is still valid given blocks' current columns. */
export function isEdgeOrderValid(
  blocks: ReadonlyMap<string, ValidatableBlock>,
  edge: ValidatableEdge,
): boolean {
  return columnOf(blocks, edge.from.blockId) < columnOf(blocks, edge.to.blockId)
}
