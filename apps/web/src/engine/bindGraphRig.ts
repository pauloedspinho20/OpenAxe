import type { StoreApi, UseBoundStore } from 'zustand'
import type { GraphState } from '../state/graphStore'
import { useEngineVersion } from '../state/engineVersion'
import type { Block, BlockKind, EffectParams } from './blocks/Block'
import type { Jack } from './gridConfig'
import type { ConnectResult } from './GraphRig'
import type { ConnectResult as ValidatableConnectResult } from './graphValidation'

/**
 * The subset of GraphRig's imperative API bindGraphRig needs, kept narrow
 * (rather than importing GraphRig itself) so tests can pass a plain mock
 * instead of standing up a real AudioContext - same reasoning as
 * bindDualChainRig's GraphRigControls-equivalent.
 */
export interface GraphRigControls {
  addBlock(kind: BlockKind, row: number, col: number, id?: string): Promise<string>
  removeBlock(id: string): Promise<void>
  moveBlock(id: string, row: number, col: number): ValidatableConnectResult
  setBlockParams(id: string, params: EffectParams): void
  getBlock(id: string): Block | null
  connect(from: Jack, to: Jack, id?: string): ConnectResult
  disconnect(edgeId: string): void
  setMasterLevel(level: number): void
  setMasterMuted(muted: boolean): void
  setTunerMuted(muted: boolean): void
  listBlockIds(): string[]
  listEdgeIds(): string[]
}

/** Anything with an optional `setBypass` - the 11 effect kinds and the 5 NAM model kinds have one; Cab/Tone Stack/Mixer/Splitter don't. */
interface MaybeBypassable {
  setBypass?(bypassed: boolean): void
}

async function reconcile(
  rig: GraphRigControls,
  state: GraphState,
  positions: Map<string, { row: number; col: number }>,
): Promise<void> {
  const liveBlockIds = new Set(rig.listBlockIds())
  const storeBlockIds = new Set(state.blocks.map((b) => b.id))

  for (const id of liveBlockIds) {
    if (!storeBlockIds.has(id)) {
      await rig.removeBlock(id)
      positions.delete(id)
    }
  }
  for (const block of state.blocks) {
    if (!liveBlockIds.has(block.id)) {
      await rig.addBlock(block.kind, block.row, block.col, block.id)
      positions.set(block.id, { row: block.row, col: block.col })
    }
  }

  for (const block of state.blocks) {
    const prev = positions.get(block.id)
    // Only move when the grid cell actually changed. The web path tolerates
    // unconditional moves, but on the native path each moveBlock suspends and
    // resets the whole audio engine (issue #62) - so a single param change
    // that reconciles every block must not move blocks that never moved.
    if (!prev || prev.row !== block.row || prev.col !== block.col) {
      rig.moveBlock(block.id, block.row, block.col)
      positions.set(block.id, { row: block.row, col: block.col })
    }
    rig.setBlockParams(block.id, block.params)
    if (block.bypass !== undefined) {
      ;(rig.getBlock(block.id) as MaybeBypassable | null)?.setBypass?.(block.bypass)
    }
  }

  const liveEdgeIds = new Set(rig.listEdgeIds())
  const storeEdgeIds = new Set(state.edges.map((e) => e.id))

  for (const id of liveEdgeIds) {
    if (!storeEdgeIds.has(id)) rig.disconnect(id)
  }
  for (const edge of state.edges) {
    if (!liveEdgeIds.has(edge.id)) rig.connect(edge.from, edge.to, edge.id)
  }

  rig.setMasterLevel(state.masterLevel)
  rig.setMasterMuted(state.masterMuted)
  rig.setTunerMuted(state.tunerMuted)

  // Block creation above is async - components that read live block state
  // imperatively during render (BlockCard) have nothing else to subscribe
  // to that would tell them it just finished. Bump unconditionally, even on
  // a reconcile pass with nothing to add/remove; it's a cheap re-render.
  useEngineVersion.getState().bump()
}

/**
 * Keep a live GraphRig in sync with the reactive graphStore. Unlike
 * bindDualChainRig (which only ever pushes scalar values onto a fixed
 * topology), reconciliation here can create/destroy blocks and
 * connections, which is inherently async (block creation may need to spin
 * up a NamNode). Store updates are chained onto one promise so overlapping
 * reconciles from rapid edits (e.g. fast dragging) never interleave.
 */
export function bindGraphRig(
  store: UseBoundStore<StoreApi<GraphState>>,
  rig: GraphRigControls,
): () => void {
  const positions = new Map<string, { row: number; col: number }>()
  let chain: Promise<void> = reconcile(rig, store.getState(), positions)
  let unbound = false

  const unsubscribe = store.subscribe((state) => {
    if (unbound) return
    chain = chain.then(() => (unbound ? undefined : reconcile(rig, state, positions)))
  })

  return () => {
    unbound = true
    unsubscribe()
  }
}
