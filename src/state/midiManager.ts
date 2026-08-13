import { create } from 'zustand'

interface MidiManagerState {
  open: boolean
  openManager: () => void
  closeManager: () => void
}

/** Transient UI-only state for the MIDI manager modal - not persisted. */
export const useMidiManager = create<MidiManagerState>()((set) => ({
  open: false,
  openManager: () => set({ open: true }),
  closeManager: () => set({ open: false }),
}))
