import type { InputRisk } from '@/audio/detectRiskyInput'
import styles from './MicFeedbackGuard.module.css'

export interface MicFeedbackGuardProps {
  risk: Exclude<InputRisk, 'safe'>
  acknowledged: boolean
  onAcknowledge: (acknowledged: boolean) => void
  /**
   * Which safe path to point at: the power gate (pre-power-on, so the DI
   * takes live in the Input dialog) or the Input dialog itself (DI player
   * is on screen below).
   */
  diHint: 'gate' | 'dialog'
  /** Optional extra line (e.g. desktop Settings: a revoke applies on restart). */
  liveNote?: string | null
  /** Unique prefix for the checkbox id — several guards can mount at once. */
  id: string
}

const WARNING_COPY: Record<Exclude<InputRisk, 'safe'>, string> = {
  risky:
    'This looks like a built-in microphone. With speakers as output it will likely feed back — loud howling and noise that can damage hearing and speakers at volume.',
  unknown:
    'We can’t see device names until microphone permission is granted — this may be the built-in microphone, which with speakers can cause loud feedback and damage hearing or speakers.',
}

const DI_COPY = {
  gate: 'Safer: power on without the mic, then play a DI take from the Input dialog (live input stays muted).',
  dialog: 'Safer: play a DI take below — live input stays muted while it plays.',
} as const

/**
 * Shared internal-mic feedback guard (issue #422): identical warning +
 * informed-consent checkbox on every surface that picks an input (PowerGate,
 * InputDeviceDialog, SettingsDialog), so the safe DI path is always offered
 * and a hot mic never goes live unacknowledged.
 */
export function MicFeedbackGuard({
  risk,
  acknowledged,
  onAcknowledge,
  diHint,
  liveNote,
  id,
}: MicFeedbackGuardProps) {
  const checkboxId = `${id}-mic-risk-ack`
  return (
    <div className={styles.guard} role="alert">
      <p className={styles.warning}>⚠️ {WARNING_COPY[risk]}</p>
      <p className={styles.diHint}>{DI_COPY[diHint]}</p>
      <label className={styles.ackRow} htmlFor={checkboxId}>
        <input
          id={checkboxId}
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => onAcknowledge(e.target.checked)}
          className={styles.checkbox}
        />
        <span>
          I understand a microphone as input may cause loud feedback, noise and damage — use it
          anyway
        </span>
      </label>
      {liveNote && <p className={styles.liveNote}>{liveNote}</p>}
    </div>
  )
}
