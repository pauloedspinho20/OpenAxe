import { create } from 'zustand'

export interface PresetPickTarget {
  scene: number
  slot: number
}

interface PresetManagerState {
  open: boolean
  /** Non-null => "pick" mode: rows offer Assign (to this scene slot) instead of Load. */
  pickTarget: PresetPickTarget | null
  openManager: () => void
  /** Opens in pick mode, targeting a specific scene slot - see SceneBar's "Pick…" action. */
  openPicker: (target: PresetPickTarget) => void
  closeManager: () => void
}

/** Transient UI-only state for the preset manager modal - not persisted. */
export const usePresetManager = create<PresetManagerState>()((set) => ({
  open: false,
  pickTarget: null,
  openManager: () => set({ open: true, pickTarget: null }),
  openPicker: (target) => set({ open: true, pickTarget: target }),
  closeManager: () => set({ open: false, pickTarget: null }),
}))
