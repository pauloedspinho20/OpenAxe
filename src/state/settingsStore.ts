/**
 * Settings dialog open state, plus the one setting that isn't already owned
 * by another store: NAM model quality (a slim-size fraction applied as the
 * default for newly-loaded models - see AssetScreenButton.tsx and
 * useTone3000Target.ts - and live to already-loaded ones from the dialog).
 * Device/channel/latency settings stay in ioStore; this store only adds what
 * that one doesn't already cover.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface SettingsState {
  open: boolean
  /** Slim-size fraction in [0.01, 1] - 1 is full quality/fidelity. */
  namQuality: number
  openSettings: () => void
  closeSettings: () => void
  setNamQuality: (quality: number) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      open: false,
      namQuality: 1,
      openSettings: () => set({ open: true }),
      closeSettings: () => set({ open: false }),
      setNamQuality: (quality) => set({ namQuality: Math.min(1, Math.max(0.01, quality)) }),
    }),
    {
      name: 'nam-web-studio-settings',
      partialize: (state) => ({ namQuality: state.namQuality }),
    },
  ),
)
