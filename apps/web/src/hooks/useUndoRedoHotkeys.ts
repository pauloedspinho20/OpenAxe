import { useEffect } from 'react'
import { isEditableTarget } from './useSceneHotkeys'
import { useHistoryStore } from '../state/historyStore'

export function useUndoRedoHotkeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.isComposing) return
      if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return

      const key = e.key.toLowerCase()
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return

      // Undo: Mod+Z without Shift (Cmd+Z / Ctrl+Z)
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        void useHistoryStore.getState().undo()
        return
      }

      // Redo: Mod+Shift+Z (Cmd+Shift+Z / Ctrl+Shift+Z) or Mod+Y (Ctrl+Y / Cmd+Y)
      if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        void useHistoryStore.getState().redo()
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
