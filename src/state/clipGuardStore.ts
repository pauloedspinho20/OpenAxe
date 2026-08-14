import { create } from 'zustand'
import { useGraphStore } from './graphStore'

export interface ClipGuardState {
  /** Explanation dialog open - the master was auto-muted for sustained clipping. */
  open: boolean
  /** Mute the master output and surface the explanation dialog. */
  trigger: () => void
  /** Un-mute the master and dismiss the dialog. */
  dismiss: () => void
}

/** Open state + the mute it controls for the clip guard - see useAudioEngine. */
export const useClipGuardStore = create<ClipGuardState>()((set) => ({
  open: false,
  trigger: () => {
    useGraphStore.getState().setClipMuted(true)
    set({ open: true })
  },
  dismiss: () => {
    useGraphStore.getState().setClipMuted(false)
    set({ open: false })
  },
}))
