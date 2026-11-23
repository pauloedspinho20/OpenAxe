import { useEffect } from 'react'
import { isEditableTarget } from './useSceneHotkeys'
import { getActiveViewHistory } from '../state/viewHistoryStore'

export function useUndoRedoHotkeys(enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.isComposing) return
      if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return

      const key = e.key.toLowerCase()
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return

      const active = getActiveViewHistory()
      if (!active) return

      // Undo: Mod+Z without Shift (Cmd+Z / Ctrl+Z)
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        void active.undo()
        return
      }

      // Redo: Mod+Shift+Z (Cmd+Shift+Z / Ctrl+Shift+Z) or Mod+Y (Ctrl+Y / Cmd+Y)
      if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        void active.redo()
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}
