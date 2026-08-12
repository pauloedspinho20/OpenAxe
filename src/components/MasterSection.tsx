import { Panel } from './primitives/Panel'
import { Knob } from './primitives/Knob'
import { useIOStore } from '../state/ioStore'
import styles from './MasterSection.module.css'

export interface MasterSectionProps {
  outputSelectionSupported: boolean
}

/** Input/output device routing - unrelated to the signal graph, so it carries over unchanged. */
export function MasterSection({ outputSelectionSupported }: MasterSectionProps) {
  const io = useIOStore()
  const inputDevices = io.inputDevices
  const outputDevices = io.outputDevices
  const micError = io.micError

  return (
    <Panel label="I/O">
      <div className={styles.ioSection}>
        <select
          className={styles.ioSelect}
          value={io.inputDeviceId}
          onChange={(e) => io.setInputDevice(e.target.value)}
          aria-label="Input device"
        >
          <option value="">Default input</option>
          {inputDevices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
        <select
          className={styles.ioSelect}
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
        <Knob
          label="Input Trim"
          value={io.inputGain}
          min={0}
          max={2}
          defaultValue={1}
          onChange={io.setInputGain}
          formatValue={(v) => `${Math.round(v * 100)}%`}
        />
        {outputSelectionSupported && (
          <select
            className={styles.ioSelect}
            value={io.outputDeviceId}
            onChange={(e) => io.setOutputDevice(e.target.value)}
            aria-label="Output device"
          >
            <option value="">Default output</option>
            {outputDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        )}
        {!outputSelectionSupported && (
          <span className={`label ${styles.ioNote}`}>
            Output routing not supported in this browser
          </span>
        )}
      </div>

      {micError && (
        <p className={styles.micError}>
          {micError.includes('NotAllowedError') || micError.includes('Permission')
            ? 'Mic access denied. Input will be silent — check browser permissions.'
            : `Mic error: ${micError}`}
        </p>
      )}
    </Panel>
  )
}
