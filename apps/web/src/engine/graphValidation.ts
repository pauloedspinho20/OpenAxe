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

/**
 * Highest valid port index for a jack on the given side. Inputs default to
 * a single port 0, except a Mixer's several independent input jacks;
 * outputs are always a single port 0, now that the Splitter - the one kind
 * that had several independent output jacks - has been removed.
 *
 * Send/Return (issue #274) break the "every block has a single port-0 on
 * both sides" default: a Send is input-only (no output jack - its signal
 * leaves via the implicit link to its Return, never a cable) and a Return is
 * output-only (no input jack - its signal arrives via the implicit link). The
 * implicit links are never drawn or validated as cables, so a negative max
 * simply makes every cable on that side fail the port check below.
 */
function maxPortFor(
  blocks: ReadonlyMap<string, ValidatableBlock>,
  blockId: string,
  side: 'from' | 'to',
): number {
  if (side === 'to') {
    if (blockId === OUT_RAIL) return 0
    const kind = blocks.get(blockId)?.kind
    if (kind === 'return-1' || kind === 'return-2') return -1
    return kind === 'mixer' ? MIXER_INPUT_COUNT - 1 : 0
  }
  if (blockId === IN_RAIL) return 0
  const kind = blocks.get(blockId)?.kind
  if (kind === 'send-1' || kind === 'send-2') return -1
  // No kind has a second output port since the splitter was removed.
  void kind
  return 0
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
  const maxToPort = maxPortFor(blocks, to.blockId, 'to')
  if (to.port < 0 || to.port > maxToPort) return { ok: false, reason: 'Invalid input jack' }
  const maxFromPort = maxPortFor(blocks, from.blockId, 'from')
  if (from.port < 0 || from.port > maxFromPort) return { ok: false, reason: 'Invalid output jack' }
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

/**
 * True if moving `blockId` to column `newCol` keeps every cable touching it
 * left-to-right. A block with an incoming cable must stay to the right of its
 * source, and one with an outgoing cable must stay to the left of its target,
 * so the block is only free to move within that column band (rows are
 * unconstrained - ordering is column-based). Used both to reject invalid moves
 * and to drive the drag-drop validity highlight.
 */
export function canMoveTo(
  blocks: ReadonlyMap<string, ValidatableBlock>,
  edges: Iterable<ValidatableEdge>,
  blockId: string,
  newCol: number,
): ConnectResult {
  for (const edge of edges) {
    if (edge.from.blockId === blockId) {
      if (!(newCol < columnOf(blocks, edge.to.blockId))) {
        return { ok: false, reason: 'Moving here would break a cable to the right of this block' }
      }
    } else if (edge.to.blockId === blockId) {
      if (!(columnOf(blocks, edge.from.blockId) < newCol)) {
        return { ok: false, reason: 'Moving here would break a cable from the left of this block' }
      }
    }
  }
  return { ok: true }
}
