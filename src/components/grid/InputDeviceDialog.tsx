import { useEffect } from 'react'
import { useIOStore, type InputChannelMode } from '../../state/ioStore'
import styles from './InputDeviceDialog.module.css'

export interface InputDeviceDialogProps {
  open: boolean
  onClose: () => void
}

/** Opened from the IN rail's label button - picks the audio input device and channel routing. */
export function InputDeviceDialog({ open, onClose }: InputDeviceDialogProps) {
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
        aria-label="Input device"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <span className={`label ${styles.title}`}>Input</span>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close input settings"
          >
            ×
          </button>
        </div>

        <label className={styles.field}>
          <span className="label">Device</span>
          <select
            className={styles.select}
            value={io.inputDeviceId}
            onChange={(e) => io.setInputDevice(e.target.value)}
            aria-label="Input device"
          >
            <option value="">Default input</option>
            {io.inputDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span className="label">Channel</span>
          <select
            className={styles.select}
            value={io.inputChannel}
            onChange={(e) => io.setInputChannel(e.target.value as InputChannelMode)}
            aria-label="Input channel"
          >
            <option value="l">Ch 1</option>
            <option value="r">Ch 2</option>
            <option value="stereo">Stereo</option>
            <option value="sum">Ch 1+2</option>
          </select>
        </label>

        {io.micError && <p className={styles.hint}>{io.micError}</p>}
      </div>
    </div>
  )
}
