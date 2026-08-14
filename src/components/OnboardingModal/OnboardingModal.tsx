import { useEffect } from 'react'
import { HardwareButton } from '../primitives/HardwareButton/HardwareButton'
import { Dialog } from '../shared'
import styles from './OnboardingModal.module.css'

export interface OnboardingModalProps {
  open: boolean
  onDismiss: () => void
}

interface Step {
  title: string
  body: string
}

const STEPS: Step[] = [
  {
    title: '1. Place blocks',
    body: 'Drag a block from the shelf onto the grid, or click an empty cell and pick one. Amp/Amp+Cab/Pedal/Outboard/Space load a model, Cab loads a cabinet IR, and the rest are effects.',
  },
  {
    title: '2. Wiring is semi-automatic',
    body: 'The first block you place is wired straight from IN to OUT. Drop a new block between two already-connected blocks and it splices itself into that cable. Every cable has its own × to unhook it, and dragging an already-wired input jack lets you re-route that cable instead of deleting and redrawing it.',
  },
  {
    title: '3. Power on',
    body: 'Click "Power on" to start the audio engine - your browser will ask for microphone access, which is what lets your instrument\'s input reach the rig.',
  },
  {
    title: '4. Load a sound',
    body: "Click a core block's screen to browse the Tone3000 catalog for a model or cabinet IR - it opens automatically the moment you place a new core block.",
  },
  {
    title: '5. Tune up',
    body: 'Click the tuner in the top-left of the shelf for a full-size, high-definition tuner - it mutes the output while open so you can tune silently.',
  },
  {
    title: '6. Save your rig',
    body: 'Use Presets in the header to save and recall your whole grid - blocks, cables, and every parameter.',
  },
]

export function OnboardingModal({ open, onDismiss }: OnboardingModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onDismiss])

  return (
    <Dialog
      open={open}
      onClose={onDismiss}
      title="Welcome to NAM Web Studio"
      width="min(520px, 90vw)"
      zIndex={120}
    >
      <ol className={styles.steps}>
        {STEPS.map((step) => (
          <li key={step.title} className={styles.step}>
            <span className={styles.stepTitle}>{step.title}</span>
            <p className={styles.stepBody}>{step.body}</p>
          </li>
        ))}
      </ol>

      <div className={styles.footer}>
        <HardwareButton label="Let's go" onClick={onDismiss} />
      </div>
    </Dialog>
  )
}
