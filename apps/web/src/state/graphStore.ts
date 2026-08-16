import { create } from 'zustand'
import type { BlockKind, EffectParams } from '../engine/blocks/Block'
import { GRID_COLS, IN_RAIL, OUT_RAIL, jack, jackKey, type Jack } from '../engine/gridConfig'
import {
  canConnect,
  canMoveTo,
  type ConnectResult,
  type ValidatableBlock,
} from '../engine/graphValidation'

export interface BlockInstance {
  id: string
  kind: BlockKind
  row: number
  col: number
  /** Meaningful for the 11 effect kinds and the 5 NAM model kinds - Cab/Tone Stack/Mixer/Splitter have no bypass concept. */
  bypass?: boolean
  params: EffectParams
}

export interface EdgeInstance {
  id: string
  from: Jack
  to: Jack
}

export type GraphConnectResult = { ok: true; id: string } | { ok: false; reason: string }

export interface GraphState {
  blocks: BlockInstance[]
  edges: EdgeInstance[]
  masterLevel: number
  masterMuted: boolean
  /** Programmatic output silence while the tuner dialog is open - separate from the user's saved mute. */
  tunerMuted: boolean

  addBlock: (kind: BlockKind, row: number, col: number) => string
  removeBlock: (id: string) => void
  moveBlock: (id: string, row: number, col: number) => ConnectResult
  setBlockParams: (id: string, params: EffectParams) => void
  setBlockBypass: (id: string, bypass: boolean) => void
  connect: (from: Jack, to: Jack) => GraphConnectResult
  disconnect: (edgeId: string) => void
  disconnectConnections: (jack: Jack, side: 'in' | 'out') => void
  setMasterLevel: (level: number) => void
  setMasterMuted: (muted: boolean) => void
  setTunerMuted: (muted: boolean) => void
  /** Replace the whole graph at once - preset load. */
  loadGraph: (
    blocks: BlockInstance[],
    edges: EdgeInstance[],
    masterLevel: number,
    masterMuted: boolean,
  ) => void
}

function toValidatable(blocks: BlockInstance[]): Map<string, ValidatableBlock> {
  const map = new Map<string, ValidatableBlock>()
  for (const b of blocks) map.set(b.id, { id: b.id, kind: b.kind, col: b.col })
  return map
}

function newEdgeId(): string {
  return crypto.randomUUID()
}

function blockTo(blockId: string, port = 0): Jack {
  return { blockId, port }
}

/**
 * Semi-auto wiring for a freshly placed block (see addBlock). Rules, applied
 * in order:
 *
 * 1. First block ever - anchor it to both rails: IN -> block -> OUT.
 * 2. Input: connect to the nearest preceding block's *unconnected* output,
 *    prioritizing the block in the same row, then the closest column. This
 *    is what keeps a new block chained after its neighbour instead of being
 *    anchored to the grid's IN rail - IN is only used when no such
 *    unconnected output exists to the left.
 * 3. Otherwise splice: a cable that straddles the new cell's column gets cut
 *    in half so the new block sits between its endpoints (this also extends a
 *    chain left/right of the ends, since the IN/OUT rails count as
 *    endpoints). Best candidate is the one with endpoints nearest the new
 *    cell's row, ties broken by the tightest column span.
 * 4. Output: anchor to the OUT rail, each add validated so an OUT jack
 *    already taken by another chain never breaks the add.
 *
 * Returns the complete next edge list; addBlock applies it in one `set`.
 */
function autoWireEdges(
  prevBlocks: BlockInstance[],
  nextBlocks: BlockInstance[],
  edges: EdgeInstance[],
  newId: string,
  row: number,
  col: number,
): EdgeInstance[] {
  const colOf = (blockId: string): number => {
    if (blockId === IN_RAIL) return -1
    if (blockId === OUT_RAIL) return GRID_COLS
    return nextBlocks.find((b) => b.id === blockId)?.col ?? GRID_COLS
  }
  const rowOf = (blockId: string): number => nextBlocks.find((b) => b.id === blockId)?.row ?? -1

  if (prevBlocks.length === 0) {
    return [
      { id: newEdgeId(), from: jack(IN_RAIL), to: blockTo(newId) },
      { id: newEdgeId(), from: blockTo(newId), to: jack(OUT_RAIL) },
    ]
  }

  const validatable = toValidatable(nextBlocks)
  const next: EdgeInstance[] = [...edges]
  const mayConnect = (from: Jack, to: Jack) => canConnect(validatable, next, from, to).ok

  // 2. Preferred input: a preceding block with an unconnected output - same
  //    row first (weight 1000 dominates), then nearest (largest column).
  const usedOut = new Set(edges.map((e) => e.from.blockId))
  let bestIn: string | null = null
  let bestInScore = Infinity
  for (const b of nextBlocks) {
    if (b.id === newId || b.col >= col || usedOut.has(b.id)) continue
    const score = (b.row === row ? 0 : 1) * 1000 - b.col
    if (score < bestInScore) {
      bestInScore = score
      bestIn = b.id
    }
  }

  // 3. Otherwise splice a cable straddling the new column.
  let bestEdge: EdgeInstance | null = null
  let bestEdgeScore = Infinity
  for (const edge of edges) {
    if (!(colOf(edge.from.blockId) < col && col < colOf(edge.to.blockId))) continue
    const fromRow = rowOf(edge.from.blockId)
    const toRow = rowOf(edge.to.blockId)
    const rowDist =
      (fromRow < 0 ? 0 : Math.abs(fromRow - row)) + (toRow < 0 ? 0 : Math.abs(toRow - row))
    const score = rowDist * 1000 + (colOf(edge.to.blockId) - colOf(edge.from.blockId))
    if (score < bestEdgeScore) {
      bestEdgeScore = score
      bestEdge = edge
    }
  }

  if (bestEdge) {
    return next
      .filter((e) => e.id !== bestEdge!.id)
      .concat(
        { id: newEdgeId(), from: bestEdge.from, to: blockTo(newId) },
        { id: newEdgeId(), from: blockTo(newId), to: bestEdge.to },
      )
  }

  // 2b. Wire the input to the chosen preceding block, or the IN rail only if
  //     no unconnected output exists anywhere to the left.
  const inSource = bestIn ? blockTo(bestIn) : jack(IN_RAIL)
  if (mayConnect(inSource, blockTo(newId))) {
    next.push({ id: newEdgeId(), from: inSource, to: blockTo(newId) })
  } else if (!bestIn && mayConnect(jack(IN_RAIL), blockTo(newId))) {
    next.push({ id: newEdgeId(), from: jack(IN_RAIL), to: blockTo(newId) })
  }

  // 4. Output to the OUT rail (validated).
  if (mayConnect(blockTo(newId), jack(OUT_RAIL))) {
    next.push({ id: newEdgeId(), from: blockTo(newId), to: jack(OUT_RAIL) })
  }
  return next
}

/**
 * Plain, serializable graph state: blocks placed on the grid and the cables
 * between them. Runs the same connection rules as the live GraphRig (see
 * graphValidation.ts) so a rejected connect/move here can never silently
 * diverge from what the engine would have allowed - bindGraphRig only ever
 * needs to mirror this store's state, never to second-guess it.
 */
export const useGraphStore = create<GraphState>()((set, get) => ({
  blocks: [],
  edges: [],
  masterLevel: 1,
  masterMuted: false,
  tunerMuted: false,

  addBlock: (kind, row, col) => {
    const state = get()
    const id = crypto.randomUUID()
    const block: BlockInstance = { id, kind, row, col, params: {} }
    const blocks = [...state.blocks, block]
    const edges = autoWireEdges(state.blocks, blocks, state.edges, id, row, col)
    set({ blocks, edges })
    return id
  },

  removeBlock: (id) => {
    set((state) => ({
      blocks: state.blocks.filter((b) => b.id !== id),
      edges: state.edges.filter((e) => e.from.blockId !== id && e.to.blockId !== id),
    }))
  },

  moveBlock: (id, row, col) => {
    const state = get()
    const target = state.blocks.find((b) => b.id === id)
    if (!target) return { ok: false, reason: 'Unknown block' }
    const move = canMoveTo(toValidatable(state.blocks), state.edges, id, col)
    if (!move.ok) return move
    set({
      blocks: state.blocks.map((b) => (b.id === id ? { ...b, row, col } : b)),
    })
    return { ok: true }
  },

  setBlockParams: (id, params) => {
    set((state) => ({
      blocks: state.blocks.map((b) =>
        b.id === id ? { ...b, params: { ...b.params, ...params } } : b,
      ),
    }))
  },

  setBlockBypass: (id, bypass) => {
    set((state) => ({ blocks: state.blocks.map((b) => (b.id === id ? { ...b, bypass } : b)) }))
  },

  connect: (from, to) => {
    const state = get()
    const result = canConnect(toValidatable(state.blocks), state.edges, from, to)
    if (!result.ok) return result
    const id = crypto.randomUUID()
    set({ edges: [...state.edges, { id, from, to }] })
    return { ok: true, id }
  },

  disconnect: (edgeId) => {
    set((state) => ({ edges: state.edges.filter((e) => e.id !== edgeId) }))
  },

  disconnectConnections: (theJack, side) => {
    set((state) => ({
      edges: state.edges.filter((e) => {
        const endpoint = side === 'out' ? e.from : e.to
        return jackKey(endpoint) !== jackKey(theJack)
      }),
    }))
  },

  setMasterLevel: (level) => set({ masterLevel: level }),
  setMasterMuted: (muted) => set({ masterMuted: muted }),
  setTunerMuted: (muted) => set({ tunerMuted: muted }),

  loadGraph: (blocks, edges, masterLevel, masterMuted) =>
    set({ blocks, edges, masterLevel, masterMuted }),
}))
