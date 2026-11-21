import { useEffect } from 'react'

import { useMediaStore } from './mediaStore'

/** Global media shortcuts while the Media Center is open (not while typing). */
export function useMediaShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      // The tab editor owns the keyboard while it has focus (see TabWorkspace).
      if (t?.closest?.('[data-tab-editor]')) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const s = useMediaStore.getState()
      switch (e.key) {
        case ' ':
          void s.toggle()
          break
        case 'Home':
          void s.seek(
            s.practice.loopEnabled && s.practice.loopStart !== null ? s.practice.loopStart : 0,
          )
          break
        case 'ArrowLeft':
          void s.skip(e.shiftKey ? -15 : -5)
          break
        case 'ArrowRight':
          void s.skip(e.shiftKey ? 15 : 5)
          break
        case '[':
          s.setLoopPoint('start', s.position)
          break
        case ']':
          s.setLoopPoint('end', s.position)
          break
        case 'l':
        case 'L':
          s.toggleLoop()
          break
        case '-':
          s.setSpeed(s.practice.speed - 0.05)
          break
        case '=':
        case '+':
          s.setSpeed(s.practice.speed + 0.05)
          break
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}
