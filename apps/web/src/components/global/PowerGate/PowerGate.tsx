import { HardwareButton, Wordmark } from '@openaxe/ui'
import type { AudioEnginePowerOnOptions, EngineStatus } from '@/hooks/useAudioEngine'
import { useIOStore, type LatencyHint } from '@/state/ioStore'
import { getOpenAxe } from '@/native/openaxe'
import { useTone3000Auth } from '@/tone3000/authStore'
import styles from './PowerGate.module.css'

export interface PowerGateProps {
  status: EngineStatus
  error: string | null
  latencyHint: LatencyHint
  onLatencyChange: (hint: LatencyHint) => void
  /** Output device selection isn't supported by every browser (no setSinkId) -
   * and is never applicable in the desktop shell, where output routing is
   * owned by the native RtAudio device picker below instead. */
  outputSelectionSupported: boolean
  onPowerOn: (opts?: AudioEnginePowerOnOptions) => void
}

const LATENCY_OPTIONS: Array<{ value: LatencyHint; label: string }> = [
  { value: 'interactive', label: 'Low latency' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'playback', label: 'Safe' },
]

/**
 * Full-screen gate shown until the engine is 'ready' - the power button and
 * a short explanation are the only things on screen, everything else (grid,
 * shelf, inspector, header controls) stays mounted underneath but hidden.
 * Starting the AudioContext needs a user gesture every page load regardless
 * of whether microphone permission is already granted (a browser autoplay-
 * policy restriction, not something this app can store its way out of) -
 * the copy here says so plainly instead of implying one click should be
 * enough forever.
 */
export function PowerGate({
  status,
  error,
  latencyHint,
  onLatencyChange,
  outputSelectionSupported,
  onPowerOn,
}: PowerGateProps) {
  const auth = useTone3000Auth()
  const io = useIOStore()
  const isNative = getOpenAxe() !== null

  if (status === 'ready') return null

  const starting = status === 'starting'

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Power on">
      <div className={styles.panel}>
        <Wordmark variant="hero" />
        <p className={styles.description}>
          Starts the audio engine and asks for microphone access for your instrument input. Your
          browser remembers that permission across visits, but starting audio itself needs a fresh
          click every time you open this page - that's a browser autoplay restriction, not something
          this app can skip.
        </p>

        {status === 'error' && error && <p className={styles.error}>{error}</p>}

        <div className={styles.tone3000Row}>
          <span className={styles.tone3000Text}>
            {auth.status === 'connected'
              ? `Tone3000: connected${auth.user ? ` as ${auth.user.username}` : ''}`
              : 'Tone3000: not connected (optional - browsing works without it)'}
          </span>
          {auth.status === 'connected' ? (
            <HardwareButton label="Disconnect" onClick={() => auth.disconnect()} />
          ) : (
            <HardwareButton
              label={auth.pendingFlow ? 'Connecting…' : 'Connect Tone3000'}
              disabled={auth.pendingFlow}
              onClick={() => void auth.connect()}
            />
          )}
        </div>
        {auth.status === 'error' && auth.error && (
          <p className={styles.tone3000Hint}>
            Couldn't connect to Tone3000 ({auth.error}) - you can still power on and browse the
            catalog anonymously, or try connecting again above.
          </p>
        )}

        {isNative ? (
          <div className={styles.deviceRow}>
            <select
              className={styles.latencySelect}
              value={io.inputDeviceId}
              onChange={(e) => io.setInputDevice(e.target.value)}
              disabled={starting}
              aria-label="Input device"
            >
              <option value="">Default input</option>
              {io.inputDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
            <select
              className={styles.latencySelect}
              value={io.outputDeviceId}
              onChange={(e) => io.setOutputDevice(e.target.value)}
              disabled={starting}
              aria-label="Output device"
            >
              <option value="">Default output</option>
              {io.outputDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
            {io.inputDevices.length === 0 && io.outputDevices.length === 0 && (
              <p className={styles.deviceHint}>
                No audio interface found - plug one in, or continue without sound below.
              </p>
            )}
          </div>
        ) : (
          <div className={styles.deviceRow}>
            <select
              className={styles.latencySelect}
              value={io.inputDeviceId}
              onChange={(e) => io.setInputDevice(e.target.value)}
              disabled={starting}
              aria-label="Input device"
            >
              <option value="">Default input</option>
              {io.inputDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
            {outputSelectionSupported && (
              <select
                className={styles.latencySelect}
                value={io.outputDeviceId}
                onChange={(e) => io.setOutputDevice(e.target.value)}
                disabled={starting}
                aria-label="Output device"
              >
                <option value="">Default output</option>
                {io.outputDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        <select
          className={styles.latencySelect}
          value={latencyHint}
          onChange={(e) => onLatencyChange(e.target.value as LatencyHint)}
          disabled={starting}
          aria-label="Latency mode"
        >
          {LATENCY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <HardwareButton
          variant="accent"
          label={starting ? 'Starting…' : 'POWER ON'}
          onClick={() => onPowerOn()}
          disabled={starting}
          fullWidth
        />
        <HardwareButton
          label="Continue without sound"
          onClick={() => onPowerOn({ noSound: true })}
          disabled={starting}
          fullWidth
        />
        <p className={styles.tone3000Hint}>
          No sound mode skips the audio device entirely - the grid, presets, and editing all still
          work. The app switches back to normal audio automatically the moment a usable device is
          available.
        </p>
      </div>
    </div>
  )
}
