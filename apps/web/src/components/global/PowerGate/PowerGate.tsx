import { HardwareButton, Panel, PowerIcon, Select, Wordmark } from '@openaxe/ui'
import pkg from '../../../../package.json'
import type { AudioEnginePowerOnOptions, EngineStatus } from '@/hooks/useAudioEngine'
import { useIOStore, type LatencyHint } from '@/state/ioStore'
import { getShellKind, shellOwnsAudioDevice } from '@/native/openaxe'
import { useTone3000Auth } from '@/tone3000/authStore'
import { useUpdateCheck } from '@/hooks/useUpdateCheck'
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
  // Three shells, not two (issue #300 E1). The desktop shell picks devices
  // through the native bridge; the browser picks them through MediaDevices;
  // a plugin picks nothing at all, because the DAW already chose the device,
  // sample rate and buffer size. Branching on "is there a bridge?" collapsed
  // plugin into desktop, and branching on ownsAudioDevice alone would have
  // collapsed it into web - either way the user got pickers that do nothing.
  const ownsAudioDevice = shellOwnsAudioDevice()
  const isPluginShell = getShellKind() === 'plugin'
  const hostOwnsTransport = isPluginShell
  const { latest: updateLatest, dismiss: dismissUpdate } = useUpdateCheck()

  if (status === 'ready') return null

  // A plugin has no power switch to offer: the DAW owns the transport, it is
  // already calling ProcessBlock, and App powers the engine on automatically
  // when the editor opens. Showing the gate meant a panel that flashed up and
  // dismissed itself, with a button that did nothing a user would want.
  //
  // Failures still surface — silently rendering nothing when the engine could
  // not start would leave a blank editor with no explanation — but with a
  // retry rather than a power button, since retrying is the only action that
  // means anything here.
  if (isPluginShell && status !== 'error') return null

  const starting = status === 'starting'

  const tone3000Text =
    auth.status === 'connected'
      ? `TONE3000 - Connected${auth.user ? ` as ${auth.user.username}` : ''}`
      : 'TONE3000 - Not connected'
  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Power on">
      <div className={styles.heroWrapper}>
        <Wordmark variant="hero" version={pkg.version} />

        {status === 'error' && error && <p className={styles.error}>{error}</p>}

        <Panel label={tone3000Text}>
          {auth.status === 'connected' ? (
            <HardwareButton label="Disconnect" onClick={() => auth.disconnect()} />
          ) : (
            <HardwareButton
              label={auth.pendingFlow ? 'Connecting…' : 'Connect'}
              disabled={auth.pendingFlow}
              onClick={() => void auth.connect()}
            />
          )}
        </Panel>
        {auth.status === 'error' && auth.error && (
          <p className={styles.tone3000Hint}>
            Couldn't connect to Tone3000 ({auth.error}) - you can still power on and browse the
            catalog anonymously, or try connecting again above.
          </p>
        )}

        {hostOwnsTransport ? null : ownsAudioDevice ? (
          <div className={styles.deviceRow}>
            <Select
              label="Input"
              id="powergate-input-device"
              value={io.inputDeviceId}
              onChange={(e) => io.setInputDevice(e.target.value)}
              disabled={starting}
              aria-label="Input device"
              className={styles.deviceField}
            >
              <option value="">Default input</option>
              {io.inputDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </Select>
            <Select
              label="Output"
              id="powergate-output-device"
              value={io.outputDeviceId}
              onChange={(e) => io.setOutputDevice(e.target.value)}
              disabled={starting}
              aria-label="Output device"
              className={styles.deviceField}
            >
              <option value="">Default output</option>
              {io.outputDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </Select>
            {io.inputDevices.length === 0 && io.outputDevices.length === 0 && (
              <p className={styles.deviceHint}>No audio interface found - plug one in</p>
            )}
          </div>
        ) : (
          <div className={styles.deviceRow}>
            <Select
              label="Input"
              id="powergate-input-device"
              value={io.inputDeviceId}
              onChange={(e) => io.setInputDevice(e.target.value)}
              disabled={starting}
              aria-label="Input device"
              className={styles.deviceField}
            >
              <option value="">Default input</option>
              {io.inputDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </Select>
            {outputSelectionSupported && (
              <Select
                label="Output"
                id="powergate-output-device"
                value={io.outputDeviceId}
                onChange={(e) => io.setOutputDevice(e.target.value)}
                disabled={starting}
                aria-label="Output device"
                className={styles.deviceField}
              >
                <option value="">Default output</option>
                {io.outputDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </Select>
            )}
            <Select
              label="Latency"
              id="powergate-latency"
              value={latencyHint}
              onChange={(e) => onLatencyChange(e.target.value as LatencyHint)}
              disabled={starting}
              aria-label="Latency mode"
              className={styles.deviceField}
            >
              {LATENCY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>
        )}

        {isPluginShell ? (
          <HardwareButton
            label="Retry"
            onClick={() => onPowerOn()}
            disabled={starting}
            size="large"
          />
        ) : (
          <HardwareButton
            label={starting ? 'Starting…' : 'POWER ON'}
            iconOnly
            icon={<PowerIcon />}
            onClick={() => onPowerOn()}
            disabled={starting}
            size="large"
          />
        )}
        {updateLatest && (
          <div className={styles.updateBanner} role="status" aria-live="polite">
            <span className={styles.updateText}>New version {updateLatest.tag} available</span>
            <span className={styles.updateActions}>
              <a
                className={styles.updateLink}
                href="https://openaxe-site.pages.dev/#download"
                target="_blank"
                rel="noopener"
              >
                Download
              </a>
              <button
                type="button"
                className={styles.updateDismiss}
                onClick={dismissUpdate}
                aria-label="Dismiss update notification"
              >
                Dismiss
              </button>
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
