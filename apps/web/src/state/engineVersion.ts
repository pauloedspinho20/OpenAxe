import { create } from 'zustand'

interface EngineVersionState {
  version: number
  bump: () => void
}

/**
 * A pure re-render trigger, bumped by bindGraphRig after each reconcile
 * pass. graphStore only holds serializable graph shape (blocks/edges); it
 * has no way to reflect when the underlying async block creation (e.g. a
 * NAM WASM node) actually finishes. Components that read live block state
 * imperatively via `rig.getBlock(id)` during render (e.g. BlockCard, for
 * things like the loaded model name that only exist on the live instance)
 * need something to subscribe to so they re-render once that async work
 * finishes - this is that something.
 */
export const useEngineVersion = create<EngineVersionState>()((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
}))

/**
 * Run a model/IR load and bump once it settles. Loads go straight to the
 * live block (not through graphStore), so nothing else tells components that
 * read the loaded asset name imperatively (BlockCard, BlockInspector) to
 * re-render. Reconcile only bumps on structural changes.
 */
export function bumpAfterLoad<T>(result: T): T {
  const bump = () => useEngineVersion.getState().bump()
  if (result instanceof Promise) {
    return result.finally(bump) as T
  }
  bump()
  return result
}
