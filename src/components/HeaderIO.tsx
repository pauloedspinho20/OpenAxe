import { useIOStore } from '../state/ioStore'
import styles from './HeaderIO.module.css'

export interface HeaderIOProps {
  outputSelectionSupported: boolean
}

/**
 * Input/output device routing, compact enough to live in the header - see
 * App.tsx. Unrelated to the signal graph, so it carries over unchanged
 * regardless of what's on the grid. The mic-denied state has its own banner
 * in App.tsx already, so this stays silent about it rather than repeating it.
 */
export function HeaderIO({ outputSelectionSupported }: HeaderIOProps) {
  const io = useIOStore()

  return (
    <div className={styles.io}>
      <select
        className={styles.select}
        value={io.inputDeviceId}
        onChange={(e) => io.setInputDevice(e.target.value)}
        aria-label="Input device"
        title="Input device"
      >
        <option value="">Default input</option>
        {io.inputDevices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label}
          </option>
        ))}
      </select>
      <select
        className={styles.select}
        value={io.inputChannel}
        onChange={(e) => io.setInputChannel(e.target.value as 'l' | 'r' | 'stereo' | 'sum')}
        aria-label="Input channel"
        title={
          io.inputChannel === 'l'
            ? 'First channel only (mono)'
            : io.inputChannel === 'r'
              ? 'Second channel only (mono)'
              : io.inputChannel === 'stereo'
                ? 'Both channels (stereo)'
                : 'Both channels summed to mono'
        }
      >
        <option value="l">Ch 1</option>
        <option value="r">Ch 2</option>
        <option value="stereo">Stereo</option>
        <option value="sum">Ch 1+2</option>
      </select>
      {outputSelectionSupported ? (
        <select
          className={styles.select}
          value={io.outputDeviceId}
          onChange={(e) => io.setOutputDevice(e.target.value)}
          aria-label="Output device"
          title="Output device"
        >
          <option value="">Default output</option>
          {io.outputDevices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
      ) : (
        <span
          className={`label ${styles.note}`}
          title="Output routing not supported in this browser"
        >
          Output: default
        </span>
      )}
    </div>
  )
}
