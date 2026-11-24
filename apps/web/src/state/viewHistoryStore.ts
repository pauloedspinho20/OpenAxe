import { create } from 'zustand'
import type { AppViewId } from '../appViews'

export interface ViewHistoryController {
  /** Owner token so a stale unmount cleanup never clears a newly mounted owner. */
  id: symbol
  /** Context phrase for tooltips, e.g. "rig change" or "tab edit". */
  label?: string | undefined
  canUndo: boolean
  canRedo: boolean
  undo: () => void | Promise<void>
  redo: () => void | Promise<void>
}

interface ViewHistoryState {
  activeView: AppViewId
  controllers: Partial<Record<AppViewId, ViewHistoryController>>
  setActiveView: (view: AppViewId) => void
  register: (view: AppViewId, controller: ViewHistoryController) => void
  unregister: (view: AppViewId, id: symbol) => void
}

/**
 * View-scoped undo/redo controller registry so the shared header buttons and
 * global Mod+Z / Mod+Y shortcuts always drive whichever top-level view is
 * active while keeping each view's history stack isolated.
 */
export const useViewHistoryStore = create<ViewHistoryState>((set) => ({
  activeView: 'rig',
  controllers: {},
  setActiveView: (view) =>
    set((state) => (state.activeView === view ? state : { activeView: view })),
  register: (view, controller) =>
    set((state) => ({
      controllers: { ...state.controllers, [view]: controller },
    })),
  unregister: (view, id) =>
    set((state) => {
      if (state.controllers[view]?.id !== id) return state
      const next = { ...state.controllers }
      delete next[view]
      return { controllers: next }
    }),
}))

export function getActiveViewHistory(): ViewHistoryController | null {
  const state = useViewHistoryStore.getState()
  return state.controllers[state.activeView] ?? null
}

export function resetViewHistoryForTests(): void {
  useViewHistoryStore.setState({ activeView: 'rig', controllers: {} })
}
