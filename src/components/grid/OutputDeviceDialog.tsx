import { useEffect } from 'react'
import { useIOStore } from '../../state/ioStore'
import styles from './OutputDeviceDialog.module.css'

export interface OutputDeviceDialogProps {
  open: boolean
  onClose: () => void
  /** AudioContext.setSinkId support - Chrome 110+/Edge only, see useAudioIO.ts. */
  outputSelectionSupported: boolean
}

/** Opened from the OUT rail's label button - picks the audio output device. */
export function OutputDeviceDialog({
  open,
  onClose,
  outputSelectionSupported,
}: OutputDeviceDialogProps) {
  const io = useIOStore()

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
        aria-label="Output device"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <span className={`label ${styles.title}`}>Output</span>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close output settings"
          >
            ×
          </button>
        </div>

        {outputSelectionSupported ? (
          <label className={styles.field}>
            <span className="label">Device</span>
            <select
              className={styles.select}
              value={io.outputDeviceId}
              onChange={(e) => io.setOutputDevice(e.target.value)}
              aria-label="Output device"
            >
              <option value="">Default output</option>
              {io.outputDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className={`label ${styles.hint}`}>
            Output device selection isn't supported in this browser.
          </p>
        )}
      </div>
    </div>
  )
}
