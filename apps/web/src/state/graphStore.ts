import { create } from 'zustand'
import type { BlockKind, EffectParams } from '../engine/blocks/Block'
import { GRID_COLS, IN_RAIL, OUT_RAIL, jack, jackKey, type Jack } from '../engine/gridConfig'
import { canConnect, isEdgeOrderValid, type ValidatableBlock } from '../engine/graphValidation'

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
  moveBlock: (id: string, row: number, col: number) => { droppedEdgeIds: string[] }
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
 * Semi-auto wiring for a freshly placed block (see addBlock). Three rules,
 * applied in order:
 *
 * 1. First block ever - anchor it to both rails: IN -> block -> OUT.
 * 2. A cable that straddles the new cell's column gets spliced in half so
 *    the new block sits between its endpoints. Rails count as endpoints, so
 *    placing left of the first block or right of the last block in a chain
 *    extends the chain too. The best candidate is the one with endpoints on
 *    the row nearest the new cell (rails match any row), ties broken by the
 *    tightest column span.
 * 3. Nothing straddles (e.g. a previously-disconnected grid) - anchor to the
 *    rails, each add individually validated so an OUT jack already taken by
 *    another chain never breaks the add.
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

  let best: EdgeInstance | null = null
  let bestScore = Infinity
  for (const edge of edges) {
    if (!(colOf(edge.from.blockId) < col && col < colOf(edge.to.blockId))) continue
    const fromRow = rowOf(edge.from.blockId)
    const toRow = rowOf(edge.to.blockId)
    const rowDist =
      (fromRow < 0 ? 0 : Math.abs(fromRow - row)) + (toRow < 0 ? 0 : Math.abs(toRow - row))
    const score = rowDist * 1000 + (colOf(edge.to.blockId) - colOf(edge.from.blockId))
    if (score < bestScore) {
      bestScore = score
      best = edge
    }
  }

  if (best) {
    return edges
      .filter((e) => e.id !== best!.id)
      .concat(
        { id: newEdgeId(), from: best.from, to: blockTo(newId) },
        { id: newEdgeId(), from: blockTo(newId), to: best.to },
      )
  }

  const validatable = toValidatable(nextBlocks)
  const next: EdgeInstance[] = [...edges]
  const mayConnect = (from: Jack, to: Jack) => canConnect(validatable, next, from, to).ok
  if (mayConnect(jack(IN_RAIL), blockTo(newId))) {
    next.push({ id: newEdgeId(), from: jack(IN_RAIL), to: blockTo(newId) })
  }
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
    const nextBlocks = state.blocks.map((b) => (b.id === id ? { ...b, row, col } : b))
    const validatable = toValidatable(nextBlocks)
    const dropped: string[] = []
    const nextEdges = state.edges.filter((edge) => {
      if (edge.from.blockId !== id && edge.to.blockId !== id) return true
      const valid = isEdgeOrderValid(validatable, edge)
      if (!valid) dropped.push(edge.id)
      return valid
    })
    set({ blocks: nextBlocks, edges: nextEdges })
    return { droppedEdgeIds: dropped }
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
