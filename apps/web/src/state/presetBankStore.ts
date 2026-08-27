/**
 * In-memory zustand mirror of the persisted preset bank (see
 * presetBankStore.ts), the scene store's sibling for the 512 preset slots.
 * Everything that reads "what's in preset slot N" or writes a placement goes
 * through this store so the UI re-renders and persistence stays centralized.
 */
import { create } from 'zustand'
import { createAutosaveScheduler } from '../presets/autosave'
import { createEmptyPresetBank, loadPresetBank, savePresetBank } from '../presets/presetBankStore'
import { PRESET_SLOT_COUNT, type PresetBank } from '../presets/presetBank'

export interface PresetBankStoreState {
  /** Exactly PRESET_SLOT_COUNT entries; a value is a presetStore id, null is empty. */
  slots: (string | null)[]
  /** False until the bank has been read from IndexedDB - gates persistence and boot restore. */
  hydrated: boolean

  hydrate: (bank: PresetBank) => void
  /** Place (or unplace, with null) a preset into a specific bank slot. */
  setSlot: (index: number, presetId: string | null) => void
  reset: () => void
}

function inRange(n: number, max: number): boolean {
  return Number.isInteger(n) && n >= 0 && n < max
}

export const usePresetBankStore = create<PresetBankStoreState>()((set) => ({
  slots: [],
  hydrated: false,

  hydrate: (bank) =>
    set({
      slots: bank.slots,
      hydrated: true,
    }),

  setSlot: (index, presetId) => {
    if (!inRange(index, PRESET_SLOT_COUNT)) return
    set((s) => {
      const slots = [...s.slots]
      slots[index] = presetId
      return { slots }
    })
  },

  reset: () => set({ slots: [], hydrated: false }),
}))

function toBank(state: PresetBankStoreState): PresetBank {
  return {
    id: 'default',
    version: 1,
    slots: state.slots,
    updatedAt: Date.now(),
  }
}

const scheduler = createAutosaveScheduler<PresetBank>((bank) => savePresetBank(bank), 250)

usePresetBankStore.subscribe((state) => {
  if (state.hydrated) scheduler.schedule(toBank(state))
})

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => flushPresetBank())
}

/** Forces any pending debounced write immediately - tests, or before the page unloads. */
export function flushPresetBank(): void {
  const state = usePresetBankStore.getState()
  if (state.hydrated) scheduler.flush(toBank(state))
}

/** Loads the bank into the store, seeding a fresh one first if none exists yet. Call once on boot. */
export async function hydratePresetBankStore(): Promise<void> {
  const bank = (await loadPresetBank()) ?? createEmptyPresetBank()
  usePresetBankStore.getState().hydrate(bank)
}
