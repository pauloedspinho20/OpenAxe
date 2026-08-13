import { HardwareButton } from './primitives/HardwareButton'
import type { EngineStatus } from '../hooks/useAudioEngine'
import type { LatencyHint } from '../state/ioStore'
import styles from './PowerGate.module.css'

export interface PowerGateProps {
  status: EngineStatus
  error: string | null
  latencyHint: LatencyHint
  onLatencyChange: (hint: LatencyHint) => void
  onPowerOn: () => void
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
  onPowerOn,
}: PowerGateProps) {
  if (status === 'ready') return null

  const starting = status === 'starting'

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Power on">
      <div className={styles.panel}>
        <div className={styles.wordmark}>
          <span className={styles.dot} />
          NAM WEB STUDIO
        </div>
        <p className={styles.description}>
          Starts the audio engine and asks for microphone access for your instrument input. Your
          browser remembers that permission across visits, but starting audio itself needs a fresh
          click every time you open this page - that's a browser autoplay restriction, not something
          this app can skip.
        </p>

        {status === 'error' && error && <p className={styles.error}>{error}</p>}

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
          label={starting ? 'Starting…' : 'POWER ON'}
          onClick={onPowerOn}
          disabled={starting}
        />
      </div>
    </div>
  )
}
