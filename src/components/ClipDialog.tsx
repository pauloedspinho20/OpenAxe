import { useEffect } from 'react'
import { useClipGuardStore } from '../state/clipGuardStore'
import { HardwareButton } from './primitives/HardwareButton'
import styles from './ClipDialog.module.css'

/**
 * Explanation dialog shown when the clip guard auto-mutes the master output
 * (see useAudioEngine). Dismissing un-mutes; the guard re-arms after a short
 * cooldown so the player has a moment to lower the level.
 */
export function ClipDialog() {
  const open = useClipGuardStore((s) => s.open)
  const dismiss = useClipGuardStore((s) => s.dismiss)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, dismiss])

  if (!open) return null

  return (
    <div className={styles.overlay} onClick={dismiss} role="presentation">
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Output clipping"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <span className={`label ${styles.title}`}>Output Clipping</span>
          <button type="button" className={styles.close} onClick={dismiss} aria-label="Close">
            ×
          </button>
        </div>
        <p className={styles.body}>
          The master output was clipping, so the audio was muted to protect your speakers and ears.
          Lower the master level (or the gain feeding it) and then unmute to keep playing.
        </p>
        <div className={styles.actions}>
          <HardwareButton label="Unmute" onClick={dismiss} title="Un-mute the master output" />
        </div>
        <p className={`label ${styles.hint}`}>
          This protection can be turned off in Settings → Output Protection.
        </p>
      </div>
    </div>
  )
}
