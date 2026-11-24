import { useEffect, useState } from 'react'
import type { AppViewId } from '../appViews'
import { useViewHistoryStore } from '../state/viewHistoryStore'

export interface RegisterViewHistoryInput {
  label?: string | undefined
  canUndo: boolean
  canRedo: boolean
  undo: () => void | Promise<void>
  redo: () => void | Promise<void>
}

/**
 * Bind an editor's undo/redo controller to a top-level app view while mounted
 * (pass `null` while no undoable item is active).
 */
export function useRegisterViewHistory(
  view: AppViewId,
  input: RegisterViewHistoryInput | null,
): void {
  const [ownerId] = useState(() => Symbol(view))
  const enabled = input !== null
  const label = input?.label
  const canUndo = input?.canUndo ?? false
  const canRedo = input?.canRedo ?? false
  const undo = input?.undo
  const redo = input?.redo

  useEffect(() => {
    const store = useViewHistoryStore.getState()
    if (!enabled || !undo || !redo) {
      store.unregister(view, ownerId)
      return
    }
    store.register(view, { id: ownerId, label, canUndo, canRedo, undo, redo })
  }, [view, ownerId, enabled, label, canUndo, canRedo, undo, redo])

  useEffect(
    () => () => {
      useViewHistoryStore.getState().unregister(view, ownerId)
    },
    [view, ownerId],
  )
}
