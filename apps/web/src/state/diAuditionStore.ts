import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DISampleId } from '../diSamples'

interface DIAuditionState {
  selectedId: DISampleId | null
}

interface DIAuditionActions {
  setSelectedId: (id: DISampleId | null) => void
}

type DIAuditionStore = DIAuditionState & DIAuditionActions

export const useDIAuditionStore = create<DIAuditionStore>()(
  persist(
    (set) => ({
      selectedId: 'guitar-clean' as DISampleId,
      setSelectedId: (selectedId) => set({ selectedId }),
    }),
    {
      name: 'openaxe-di-audition',
      partialize: (s) => ({ selectedId: s.selectedId }),
    },
  ),
)
