import { create } from 'zustand'
import type { Preset } from '../presets/types'

interface CurrentPresetState {
  /**
   * The last-known-persisted snapshot of whatever preset is loaded into the
   * active scene slot - null when the slot is empty, points at a deleted
   * preset, or nothing has loaded yet. This is the baseline the always-
   * visible Save button diffs the live rig against to decide whether
   * there's anything to save (see SceneBar.tsx).
   */
  saved: Preset | null
  setSaved: (preset: Preset | null) => void
}

export const useCurrentPresetStore = create<CurrentPresetState>()((set) => ({
  saved: null,
  setSaved: (preset) => set({ saved: preset }),
}))
