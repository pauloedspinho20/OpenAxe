import type { StoreApi, UseBoundStore } from 'zustand'
import type { DualChainState } from '../state/dualChainStore'
import type { ChainId } from './DualChainRig'

/**
 * The subset of DualChainRig's imperative API bindDualChainRig needs. Kept
 * narrow (rather than importing DualChainRig itself) so tests can pass a
 * plain mock instead of standing up a real AudioContext.
 */
export interface DualChainRigControls {
  setLevel(chain: ChainId, level: number): void
  setPan(chain: ChainId, pan: number): void
  setEffectivelyMuted(chain: ChainId, muted: boolean): void
  setMasterLevel(level: number): void
}

function applyState(rig: DualChainRigControls, state: DualChainState): void {
  rig.setLevel('A', state.chainA.level)
  rig.setPan('A', state.chainA.pan)
  rig.setEffectivelyMuted('A', state.isEffectivelyMuted('A'))

  rig.setLevel('B', state.chainB.level)
  rig.setPan('B', state.chainB.pan)
  rig.setEffectivelyMuted('B', state.isEffectivelyMuted('B'))

  rig.setMasterLevel(state.masterLevel)
}

/**
 * Keep a DualChainRig's live audio params in sync with the reactive
 * dualChainStore. Applies the current state immediately, then re-applies on
 * every store change. Call the returned function to stop syncing (e.g. when
 * disposing the rig).
 */
export function bindDualChainRig(
  store: UseBoundStore<StoreApi<DualChainState>>,
  rig: DualChainRigControls,
): () => void {
  applyState(rig, store.getState())
  return store.subscribe((state) => applyState(rig, state))
}
