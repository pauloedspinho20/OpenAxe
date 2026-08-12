import { create } from 'zustand'

interface PresetManagerState {
  open: boolean
  openManager: () => void
  closeManager: () => void
}

/** Transient UI-only state for the preset manager modal - not persisted. */
export const usePresetManager = create<PresetManagerState>()((set) => ({
  open: false,
  openManager: () => set({ open: true }),
  closeManager: () => set({ open: false }),
}))
