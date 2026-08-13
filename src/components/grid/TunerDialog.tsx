import { useEffect } from 'react'
import { useGraphStore } from '../../state/graphStore'
import { Tuner } from '../Tuner'
import styles from './TunerDialog.module.css'

export interface TunerDialogProps {
  open: boolean
  onClose: () => void
  analyser: AnalyserNode | null
}

/**
 * Full-size tuner dialog opened from the tuner block section in the shelf.
 * While it's open the app output is muted (via the rig's `tunerMuted`, which
 * is separate from the user's saved master mute) so the instrument can be
 * tuned silently - the tuner taps the raw pre-graph input, so muting the
 * output doesn't affect its reading.
 */
export function TunerDialog({ open, onClose, analyser }: TunerDialogProps) {
  // Silence the app's output for the duration of the dialog only.
  useEffect(() => {
    useGraphStore.getState().setTunerMuted(open)
    return () => {
      if (open) useGraphStore.getState().setTunerMuted(false)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className={styles.overlay} onClick={onClose} role="presentation">
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Tuner"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <span className={`label ${styles.title}`}>Tuner</span>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close tuner">
            ×
          </button>
        </div>
        <Tuner analyser={analyser} size="full" />
        <p className={`label ${styles.hint}`}>Output muted while tuning</p>
      </div>
    </div>
  )
}
