import { useEffect, useRef, useState } from 'react'
import { Fader, HardwareButton, Stepper } from '@openaxe/ui'
import { Metronome } from '../../../audio/metronome'
import { MAX_BPM, MIN_BPM, useTempoStore } from '../../../state/tempoStore'
import styles from './TempoControl.module.css'

const formatBpm = (bpm: number) => (Number.isInteger(bpm) ? String(bpm) : bpm.toFixed(1))

/**
 * Typeable BPM readout. Edits a local draft and commits on Enter or blur
 * (clamped to the tempo range); Escape discards it. While not focused it just
 * mirrors the store, so a tap, a stepper click or another screen's change shows
 * immediately.
 */
function BpmField() {
  const bpm = useTempoStore((s) => s.bpm)
  const [draft, setDraft] = useState<string | null>(null)

  const commit = () => {
    if (draft !== null) {
      const parsed = Number.parseFloat(draft.replace(',', '.'))
      if (Number.isFinite(parsed)) useTempoStore.getState().setBpm(parsed)
    }
    setDraft(null)
  }

  return (
    <input
      className={styles.bpmInput}
      type="text"
      inputMode="decimal"
      aria-label="BPM"
      title={`Type a tempo (${MIN_BPM}–${MAX_BPM}) and press Enter`}
      value={draft ?? formatBpm(bpm)}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9.,]/g, '').slice(0, 5))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit()
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          setDraft(null)
          e.currentTarget.blur()
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          setDraft(null)
          useTempoStore.getState().nudgeBpm((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1))
        }
      }}
    />
  )
}

/**
 * Header tempo control: BPM stepper, tap tempo, metronome toggle and click
 * volume. Mounted once in the app header, so it is present on every view; all
 * state lives in tempoStore, which is what keeps every screen in sync.
 */
export function TempoControl() {
  const bpm = useTempoStore((s) => s.bpm)
  const metronomeOn = useTempoStore((s) => s.metronomeOn)
  const volume = useTempoStore((s) => s.metronomeVolume)
  const { nudgeBpm, tap, setMetronomeOn, setMetronomeVolume } = useTempoStore.getState()

  const metronomeRef = useRef<Metronome | null>(null)
  useEffect(() => {
    const metronome = new Metronome({
      getBpm: () => useTempoStore.getState().bpm,
      getVolume: () => useTempoStore.getState().metronomeVolume,
    })
    metronomeRef.current = metronome
    return () => {
      metronome.dispose()
      metronomeRef.current = null
    }
  }, [])

  useEffect(() => {
    const metronome = metronomeRef.current
    if (!metronome) return
    if (metronomeOn) metronome.start()
    else metronome.stop()
  }, [metronomeOn])

  return (
    <div className={styles.tempo} role="group" aria-label="Tempo">
      <Stepper
        label="BPM"
        size="small"
        className={styles.bpmStepper}
        value={<BpmField />}
        onDecrement={() => nudgeBpm(-1)}
        onIncrement={() => nudgeBpm(1)}
        decrementLabel="Decrease tempo"
        incrementLabel="Increase tempo"
        decrementText="−"
        incrementText="+"
        decrementDisabled={bpm <= MIN_BPM}
        incrementDisabled={bpm >= MAX_BPM}
      />
      <HardwareButton
        label="Tap"
        size="small"
        title="Tap tempo — tap at least twice in rhythm"
        onClick={() => tap(performance.now())}
      />
      <HardwareButton
        label="Metro"
        size="small"
        active={metronomeOn}
        title={metronomeOn ? 'Stop metronome' : 'Start metronome'}
        onClick={() => setMetronomeOn(!metronomeOn)}
      />
      <Fader
        label="Metronome volume"
        orientation="horizontal"
        hideLabel
        value={volume}
        min={0}
        max={1}
        step={0.01}
        length={64}
        onChange={setMetronomeVolume}
      />
    </div>
  )
}
