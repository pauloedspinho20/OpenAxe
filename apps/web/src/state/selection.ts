import { create } from 'zustand'

interface SelectionState {
  selectedBlockId: string | null
  select: (id: string) => void
  clear: () => void
}

/** Which block's full parameters/options are shown in the BlockInspector panel. */
export const useSelection = create<SelectionState>()((set) => ({
  selectedBlockId: null,
  select: (id) => set({ selectedBlockId: id }),
  clear: () => set({ selectedBlockId: null }),
}))
