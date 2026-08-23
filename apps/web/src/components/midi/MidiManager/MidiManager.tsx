import { useEffect, useState } from 'react'
import { useMidiManager } from '../../../state/midiManager'
import { useMidiStore } from '../../../state/midiStore'
import { armLearn, requestMidiAccess } from '../../../midi/midiAccess'
import { actionKey, actionLabel, type MidiAction } from '../../../midi/actions'
import { formatMidiMatch, messageMatches } from '../../../midi/message'
import { SCENE_COUNT, SLOTS_PER_SCENE } from '../../../scenes/types'
import { Dialog, HardwareButton } from '@openaxe/ui'
import styles from './MidiManager.module.css'

export function MidiManager() {
  const open = useMidiManager((s) => s.open)
  if (!open) return null
  return <MidiManagerBody />
}

function MappingRow({ action, label }: { action: MidiAction; label?: string }) {
  const key = actionKey(action)
  const mapping = useMidiStore((s) => s.mappings.find((m) => actionKey(m.action) === key))
  const learningKey = useMidiStore((s) => s.learning?.actionKey)
  const lastMessage = useMidiStore((s) => s.lastMessage)
  const isLearning = learningKey === key
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    if (!mapping || !lastMessage || !messageMatches(lastMessage, mapping.match)) return
    setFlash(true)
    const timeout = setTimeout(() => setFlash(false), 300)
    return () => clearTimeout(timeout)
  }, [lastMessage, mapping])

  return (
    <div className={`${styles.row} ${flash ? styles.rowFlash : ''}`}>
      <span className={styles.rowLabel}>{label ?? actionLabel(action)}</span>
      <span className={mapping ? styles.binding : styles.bindingUnbound}>
        {mapping ? formatMidiMatch(mapping.match) : 'Unbound'}
      </span>
      <HardwareButton
        label={isLearning ? 'Listening…' : 'Learn'}
        active={isLearning}
        onClick={() => (isLearning ? useMidiStore.getState().cancelLearn(key) : armLearn(action))}
      />
      <button
        type="button"
        className={styles.clearBtn}
        onClick={() => useMidiStore.getState().clearMappingForAction(key)}
        disabled={!mapping}
        aria-label={`Clear ${label ?? actionLabel(action)}`}
      >
        Clear
      </button>
    </div>
  )
}

function MidiManagerBody() {
  const closeManager = useMidiManager((s) => s.closeManager)
  const supported = useMidiStore((s) => s.supported)
  const permission = useMidiStore((s) => s.permission)
  const error = useMidiStore((s) => s.error)
  const inputs = useMidiStore((s) => s.inputs)
  const selectedInputId = useMidiStore((s) => s.selectedInputId)
  const selectInput = useMidiStore((s) => s.selectInput)
  const lastMessage = useMidiStore((s) => s.lastMessage)
  const mappings = useMidiStore((s) => s.mappings)
  const [jumpSceneInput, setJumpSceneInput] = useState('1')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeManager()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeManager])

  const connected = supported && permission === 'granted'
  const sceneMappings = mappings
    .flatMap((m) => (m.action.kind === 'scene' ? [{ ...m, scene: m.action.scene }] : []))
    .sort((a, b) => a.scene - b.scene)

  return (
    <Dialog
      open={true}
      onClose={closeManager}
      title="MIDI CONTROL"
      width="min(560px, 90vw)"
      zIndex={300}
    >
      <div className={styles.section}>
        {!supported && (
          <p className={styles.hint}>
            This browser doesn't support the Web MIDI API. Try Chrome or Edge.
          </p>
        )}
        {supported && permission !== 'granted' && (
          <>
            <p className={styles.hint}>Enable MIDI to learn footswitch/controller mappings.</p>
            {error && <p className={styles.error}>{error}</p>}
            <HardwareButton label="Enable MIDI" onClick={() => void requestMidiAccess()} />
          </>
        )}
        {connected && (
          <>
            <select
              className={styles.select}
              value={selectedInputId ?? ''}
              onChange={(e) => selectInput(e.target.value || null)}
              aria-label="MIDI input"
            >
              <option value="">All inputs</option>
              {inputs.map((input) => (
                <option key={input.id} value={input.id}>
                  {input.name}
                </option>
              ))}
            </select>
            <p className={styles.hint}>
              {inputs.length} device{inputs.length === 1 ? '' : 's'} connected
            </p>
            <p className={styles.hint}>
              Last received: {lastMessage ? formatMidiMatch(lastMessage) : '—'}
            </p>
          </>
        )}
      </div>

      {connected && (
        <>
          <div className={styles.section}>
            <span className={styles.sectionTitle}>Preset Slot Triggers</span>
            {Array.from({ length: SLOTS_PER_SCENE }, (_, i) => (
              <MappingRow key={i} action={{ kind: 'slot', slot: i }} />
            ))}
          </div>

          <div className={styles.section}>
            <span className={styles.sectionTitle}>Navigation</span>
            <MappingRow action={{ kind: 'nextScene' }} />
            <MappingRow action={{ kind: 'prevScene' }} />
          </div>

          <div className={styles.section}>
            <span className={styles.sectionTitle}>Scene Jump Triggers</span>
            <div className={styles.addRow}>
              <input
                type="number"
                min={1}
                max={SCENE_COUNT}
                value={jumpSceneInput}
                onChange={(e) => setJumpSceneInput(e.target.value)}
                className={styles.numberInput}
                aria-label="Scene number"
              />
              <HardwareButton
                label="Add & Learn"
                onClick={() => {
                  const n = Math.min(SCENE_COUNT, Math.max(1, Number(jumpSceneInput) || 1))
                  armLearn({ kind: 'scene', scene: n - 1 })
                }}
              />
            </div>
            {sceneMappings.map((m) => (
              <MappingRow key={m.id} action={m.action} />
            ))}
          </div>
        </>
      )}

      <p className={styles.hint}>
        Only Note On, Control Change, and Program Change are used. Clock, note-off, and other
        messages are ignored. Presses are detected on CC values 64 and above.
      </p>
      <button
        type="button"
        className={styles.dangerBtn}
        onClick={() => useMidiStore.getState().resetAll()}
      >
        Reset all mappings
      </button>
    </Dialog>
  )
}
