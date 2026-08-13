import { useEffect } from 'react'
import { SceneNavigator } from '../scenes/sceneNavigator'

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/** True if focus/typing here would make a global "digit switches slot" shortcut a footgun. */
export function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (EDITABLE_TAGS.has(el.tagName)) return true
  if (el.isContentEditable) return true
  return el.getAttribute('role') === 'textbox'
}

/**
 * Global keyboard shortcut: digits 1-8 switch to that preset slot in the
 * current scene, mirroring the always-visible SceneBar's 8 buttons. Follows
 * the same useEffect+window.addEventListener('keydown', ...) shape as
 * OnboardingModal/TunerDialog's Escape handlers, just unconditional (no
 * `open` gate) since this shortcut is meant to work anywhere in the app.
 */
export function useSceneHotkeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      if (e.repeat || e.isComposing) return
      if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return
      if (e.key < '1' || e.key > '8') return
      e.preventDefault()
      void SceneNavigator.goToSlot(Number(e.key) - 1, { source: 'keyboard' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
