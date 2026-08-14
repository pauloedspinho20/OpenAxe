import { create } from 'zustand'

interface SceneManagerState {
  open: boolean
  openManager: () => void
  closeManager: () => void
}

/** Transient UI-only state for the scene manager modal - not persisted. */
export const useSceneManager = create<SceneManagerState>()((set) => ({
  open: false,
  openManager: () => set({ open: true }),
  closeManager: () => set({ open: false }),
}))
