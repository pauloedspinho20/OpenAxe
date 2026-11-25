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

/** Anything with an optional `setBypass` - the 11 effect kinds and the 5 NAM model kinds have one; Cab/Tone Stack/Mixer don't. */
interface MaybeBypassable {
  setBypass?(bypassed: boolean): void
}

/**
 * What reconcile last applied to each live block. `instance` is the live block
 * object the params/bypass went to: a block replaced under the same id (a
 * staged preset commit) is a new instance and gets everything re-applied.
 */
interface AppliedBlockState {
  row: number
  col: number
  params?: EffectParams
  bypass?: boolean | undefined
  instance?: Block | null
}

async function reconcile(
  rig: GraphRigControls,
  state: GraphState,
  positions: Map<string, AppliedBlockState>,
): Promise<void> {
  // Whether this pass changed anything a component reading live block state
  // could observe. A pure param change must not bump: the bump re-renders App
  // and every card, which made knob drags lag.
  let structural = false
  let bypassChanged = false
  const liveBlockIds = new Set(rig.listBlockIds())
  const storeBlockIds = new Set(state.blocks.map((b) => b.id))

  for (const id of liveBlockIds) {
    if (!storeBlockIds.has(id)) {
      await rig.removeBlock(id)
      structural = true
      positions.delete(id)
    }
  }
  for (const block of state.blocks) {
    if (!liveBlockIds.has(block.id)) {
      await rig.addBlock(block.kind, block.row, block.col, block.id)
      structural = true
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
      structural = true
      // Keep what was applied (params/bypass/instance): a move changes only
      // the cell, and dropping it would re-apply and spuriously bump below.
      positions.set(block.id, { ...prev, row: block.row, col: block.col })
    }
    const applied = positions.get(block.id)!
    // Skip blocks whose params object is unchanged (the store replaces it on
    // every write) and whose live instance is the same: a knob drag on one
    // block must not re-send every other block's params on each tick - on
    // the native path each one is a bridge call.
    const instance = rig.getBlock(block.id)
    const sameInstance = 'instance' in applied && applied.instance === instance
    if (!sameInstance || applied.params !== block.params) {
      rig.setBlockParams(block.id, block.params)
      applied.params = block.params
    }
    if (block.bypass !== undefined && (!sameInstance || applied.bypass !== block.bypass)) {
      ;(instance as MaybeBypassable | null)?.setBypass?.(block.bypass)
    }
    // A block seen for the first time has no earlier bypass anyone observed.
    if ('instance' in applied && applied.bypass !== block.bypass) bypassChanged = true
    applied.bypass = block.bypass
    applied.instance = instance
  }

  const liveEdgeIds = new Set(rig.listEdgeIds())
  const storeEdgeIds = new Set(state.edges.map((e) => e.id))

  for (const id of liveEdgeIds) {
    if (!storeEdgeIds.has(id)) {
      rig.disconnect(id)
      structural = true
    }
  }
  for (const edge of state.edges) {
    if (!liveEdgeIds.has(edge.id)) {
      rig.connect(edge.from, edge.to, edge.id)
      structural = true
    }
  }

  rig.setMasterLevel(state.masterLevel)
  rig.setMasterMuted(state.masterMuted)
  rig.setTunerMuted(state.tunerMuted)

  // Block creation above is async - components that read live block state
  // imperatively during render (BlockCard) have nothing else to subscribe
  // to that would tell them it just finished. Bump when blocks/edges changed;
  // bypass flips also change what those components show.
  if (structural || bypassChanged) useEngineVersion.getState().bump()
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
  const positions = new Map<string, AppliedBlockState>()
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
