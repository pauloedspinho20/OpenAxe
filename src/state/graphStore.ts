import { create } from 'zustand'
import type { BlockKind, EffectParams } from '../engine/blocks/Block'
import type { Jack } from '../engine/gridConfig'
import { canConnect, isEdgeOrderValid, type ValidatableBlock } from '../engine/graphValidation'

export interface BlockInstance {
  id: string
  kind: BlockKind
  row: number
  col: number
  /** Only meaningful for the 11 effect kinds - Amp/Cab/Tone Stack/Mixer have no bypass concept. */
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

  addBlock: (kind: BlockKind, row: number, col: number) => string
  removeBlock: (id: string) => void
  moveBlock: (id: string, row: number, col: number) => { droppedEdgeIds: string[] }
  setBlockParams: (id: string, params: EffectParams) => void
  setBlockBypass: (id: string, bypass: boolean) => void
  connect: (from: Jack, to: Jack) => GraphConnectResult
  disconnect: (edgeId: string) => void
  setMasterLevel: (level: number) => void
  setMasterMuted: (muted: boolean) => void
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

  addBlock: (kind, row, col) => {
    const id = crypto.randomUUID()
    set((state) => ({ blocks: [...state.blocks, { id, kind, row, col, params: {} }] }))
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

  setMasterLevel: (level) => set({ masterLevel: level }),
  setMasterMuted: (muted) => set({ masterMuted: muted }),

  loadGraph: (blocks, edges, masterLevel, masterMuted) =>
    set({ blocks, edges, masterLevel, masterMuted }),
}))
