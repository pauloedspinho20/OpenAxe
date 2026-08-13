import { create } from 'zustand'
import type { MidiAction } from '../midi/actions'
import { actionKey as computeActionKey } from '../midi/actions'
import { matchKey } from '../midi/message'
import { loadMidiConfig, saveMidiConfig, type MidiMapping } from '../midi/midiConfigStore'
import type { MidiInputInfo, MidiMatch, MidiMessage } from '../midi/types'

export type MidiPermission = 'unknown' | 'granted' | 'denied'

export interface MidiLearnTarget {
  actionKey: string
  action: MidiAction
}

export interface MidiState {
  supported: boolean
  permission: MidiPermission
  error: string | null
  inputs: MidiInputInfo[]
  selectedInputId: string | null
  mappings: MidiMapping[]
  learning: MidiLearnTarget | null
  lastMessage: MidiMessage | null
  /** Gates persistence until loadConfig() has run, so hydration can never clobber a fresh config with defaults. */
  loaded: boolean

  loadConfig: () => Promise<void>
  setSupported: (supported: boolean) => void
  setPermission: (permission: MidiPermission, error?: string | null) => void
  setInputs: (inputs: MidiInputInfo[]) => void
  selectInput: (id: string | null) => void
  startLearn: (action: MidiAction) => void
  cancelLearn: (actionKey?: string) => void
  completeLearn: (match: MidiMatch) => void
  clearMapping: (id: string) => void
  clearMappingForAction: (actionKey: string) => void
  setLastMessage: (message: MidiMessage) => void
  resetAll: () => void
}

function persist(state: MidiState): void {
  if (!state.loaded) return
  void saveMidiConfig({
    id: 'midi-config',
    version: 1,
    selectedInputId: state.selectedInputId,
    mappings: state.mappings,
  })
}

export const useMidiStore = create<MidiState>()((set, get) => ({
  supported: false,
  permission: 'unknown',
  error: null,
  inputs: [],
  selectedInputId: null,
  mappings: [],
  learning: null,
  lastMessage: null,
  loaded: false,

  loadConfig: async () => {
    if (get().loaded) return
    const config = await loadMidiConfig()
    set({ selectedInputId: config.selectedInputId, mappings: config.mappings, loaded: true })
  },

  setSupported: (supported) => set({ supported }),
  setPermission: (permission, error = null) => set({ permission, error }),
  setInputs: (inputs) => set({ inputs }),

  selectInput: (id) => {
    set({ selectedInputId: id })
    persist(get())
  },

  startLearn: (action) => set({ learning: { actionKey: computeActionKey(action), action } }),

  cancelLearn: (targetActionKey) => {
    const learning = get().learning
    if (!learning) return
    if (targetActionKey !== undefined && targetActionKey !== learning.actionKey) return
    set({ learning: null })
  },

  completeLearn: (match) => {
    const learning = get().learning
    if (!learning) return
    set((state) => {
      const key = matchKey(match)
      const mappings = state.mappings
        .filter((m) => computeActionKey(m.action) !== learning.actionKey)
        .filter((m) => matchKey(m.match) !== key)
      mappings.push({ id: crypto.randomUUID(), match, action: learning.action })
      return { mappings, learning: null }
    })
    persist(get())
  },

  clearMapping: (id) => {
    set((state) => ({ mappings: state.mappings.filter((m) => m.id !== id) }))
    persist(get())
  },

  clearMappingForAction: (targetActionKey) => {
    set((state) => ({
      mappings: state.mappings.filter((m) => computeActionKey(m.action) !== targetActionKey),
    }))
    persist(get())
  },

  setLastMessage: (message) => set({ lastMessage: message }),

  resetAll: () => {
    set({ mappings: [] })
    persist(get())
  },
}))
