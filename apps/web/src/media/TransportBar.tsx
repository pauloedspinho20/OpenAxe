import { ButtonGroup, HardwareButton, Select, Stepper } from '@openaxe/ui'
import { formatTime } from './decode'
import { BackGlyph, ForwardGlyph, LoopGlyph, PauseGlyph, PlayGlyph, ToStartGlyph } from './icons'
import styles from './MediaCenter.module.css'
import { SPEED_PRESETS, useMediaStore } from './mediaStore'

const pctLabel = (v: number) => `${Math.round(v * 100)}%`

/** Play/seek row: shared by the Media Center and the dock. */
export function TransportButtons({ compact = false }: { compact?: boolean }) {
  const playing = useMediaStore((s) => s.playing)
  // A score has no audio until rendered; play triggers that render (prepare).
  const ready = useMediaStore(
    (s) => s.loadState === 'ready' || (s.prepare !== null && s.transport !== null),
  )
  const position = useMediaStore((s) => s.position)
  const duration = useMediaStore((s) => s.duration)
  const loopStart = useMediaStore((s) => s.practice.loopStart)
  const loopEnabled = useMediaStore((s) => s.practice.loopEnabled)
  const counting = useMediaStore((s) => s.counting)
  const { toggle, seek, skip } = useMediaStore.getState()
  const iconSize = compact ? 14 : 18

  return (
    <div className={styles.transportButtons}>
      {!compact && (
        <button
          type="button"
          className={styles.tbtn}
          disabled={!ready}
          onClick={() => void seek(loopEnabled && loopStart !== null ? loopStart : 0)}
          title={loopEnabled ? 'Back to loop start (Home)' : 'Back to start (Home)'}
          aria-label="Back to start"
        >
          <ToStartGlyph size={iconSize} />
        </button>
      )}
      <button
        type="button"
        className={styles.tbtn}
        disabled={!ready}
        onClick={() => void skip(-5)}
        title="Back 5 s (←)"
        aria-label="Back 5 seconds"
      >
        <BackGlyph size={iconSize} />
      </button>
      <button
        type="button"
        className={`${styles.tbtn} ${styles.tbtnPlay}`}
        disabled={!ready}
        onClick={() => void toggle()}
        title={playing ? 'Pause (Space)' : 'Play (Space)'}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? <PauseGlyph size={iconSize + 2} /> : <PlayGlyph size={iconSize + 2} />}
      </button>
      <button
        type="button"
        className={styles.tbtn}
        disabled={!ready}
        onClick={() => void skip(5)}
        title="Forward 5 s (→)"
        aria-label="Forward 5 seconds"
      >
        <ForwardGlyph size={iconSize} />
      </button>
      <span className={styles.time} aria-live="off">
        {formatTime(position)} <span className={styles.timeDim}>/ {formatTime(duration)}</span>
      </span>
      {counting && <span className={styles.countBadge}>count-in…</span>}
    </div>
  )
}

/** Speed, transpose, volume, A-B loop and the speed trainer. */
export function PracticeControls() {
  const practice = useMediaStore((s) => s.practice)
  const position = useMediaStore((s) => s.position)
  const trainer = useMediaStore((s) => s.trainer)
  const loopCount = useMediaStore((s) => s.loopCount)
  const lastPass = useMediaStore((s) => s.lastPass)
  const cleanStreak = useMediaStore((s) => s.cleanStreak)
  const tempoHint = useMediaStore((s) => s.tempoHint)
  const s = useMediaStore.getState()
  const hasRegion =
    practice.loopStart !== null &&
    practice.loopEnd !== null &&
    practice.loopEnd > practice.loopStart

  return (
    <div className={styles.practice}>
      <fieldset className={styles.group}>
        <legend>Count-in</legend>
        <div className={styles.row}>
          <ButtonGroup
            label="Count-in bars"
            value={String(practice.countInBars)}
            onChange={(v) => s.setCountIn({ countInBars: Number(v) })}
            items={[0, 1, 2, 4].map((b) => ({
              value: String(b),
              label: b === 0 ? 'Off' : `${b} bar${b > 1 ? 's' : ''}`,
            }))}
          />
          {tempoHint ? (
            <div className={styles.dim}>
              From the score: {tempoHint.bpm} BPM, {tempoHint.beatsPerBar} beats per bar
            </div>
          ) : (
            <div className={styles.inlineGroup}>
              <label className={styles.check}>
                <input
                  className={styles.numInput}
                  type="number"
                  min={20}
                  max={400}
                  value={practice.bpm}
                  onChange={(e) => s.setCountIn({ bpm: Number(e.target.value) })}
                  aria-label="Count-in tempo (BPM)"
                />
                BPM
              </label>
              <label className={styles.check}>
                <input
                  className={styles.numInput}
                  type="number"
                  min={1}
                  max={16}
                  value={practice.beatsPerBar}
                  onChange={(e) => s.setCountIn({ beatsPerBar: Number(e.target.value) })}
                  aria-label="Beats per bar"
                />
                beats/bar
              </label>
            </div>
          )}
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend>Speed</legend>
        <div className={styles.row}>
          <HardwareButton
            size="small"
            label="−"
            ariaLabel="Slower"
            onClick={() => s.setSpeed(practice.speed - 0.05)}
          />
          <input
            type="range"
            min={25}
            max={200}
            step={1}
            value={Math.round(practice.speed * 100)}
            onChange={(e) => s.setSpeed(Number(e.target.value) / 100)}
            onDoubleClick={() => s.setSpeed(1)}
            aria-label="Playback speed"
            className={styles.slider}
          />
          <HardwareButton
            size="small"
            label="+"
            ariaLabel="Faster"
            onClick={() => s.setSpeed(practice.speed + 0.05)}
          />
          <output className={styles.value}>{pctLabel(practice.speed)}</output>
        </div>
        <ButtonGroup
          label="Speed presets"
          className={styles.presetStrip}
          value={
            SPEED_PRESETS.find((p) => Math.abs(practice.speed - p) < 0.001)?.toString() ?? null
          }
          onChange={(v) => s.setSpeed(Number(v))}
          items={SPEED_PRESETS.map((p) => ({ value: String(p), label: pctLabel(p) }))}
        />
      </fieldset>

      <fieldset className={styles.group}>
        <legend>Pitch</legend>
        <div className={styles.row}>
          <div className={styles.inlineGroup}>
            <Stepper
              label="Pitch"
              value={`${practice.semitones > 0 ? '+' : ''}${practice.semitones} st`}
              decrementLabel="Transpose down"
              incrementLabel="Transpose up"
              onDecrement={() => s.setSemitones(practice.semitones - 1)}
              onIncrement={() => s.setSemitones(practice.semitones + 1)}
              onReset={() => s.setSemitones(0)}
              resetLabel="Reset transpose"
              resetTitle="Reset transpose"
            />
            <HardwareButton
              size="small"
              label="Reset"
              disabled={practice.semitones === 0}
              onClick={() => s.setSemitones(0)}
            />
          </div>
          <div className={styles.volumeRow}>
            <span className={styles.dim}>Volume</span>
            <input
              type="range"
              min={0}
              max={200}
              value={Math.round(practice.volume * 100)}
              onChange={(e) => s.setVolume(Number(e.target.value) / 100)}
              onDoubleClick={() => s.setVolume(1)}
              aria-label="Track volume"
              className={styles.slider}
            />
            <output className={styles.value}>{pctLabel(practice.volume)}</output>
          </div>
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend>Loop</legend>
        <div className={styles.row}>
          <HardwareButton
            size="small"
            label={`A ${practice.loopStart !== null ? formatTime(practice.loopStart) : '—'}`}
            title="Set loop start here ([)"
            onClick={() => s.setLoopPoint('start', position)}
          />
          <HardwareButton
            size="small"
            label={`B ${practice.loopEnd !== null ? formatTime(practice.loopEnd) : '—'}`}
            title="Set loop end here (])"
            onClick={() => s.setLoopPoint('end', position)}
          />
          <HardwareButton
            size="small"
            label="Loop"
            icon={<LoopGlyph size={12} />}
            active={practice.loopEnabled && hasRegion}
            disabled={!hasRegion}
            title="Loop on/off (L)"
            onClick={() => s.toggleLoop()}
          />
          <HardwareButton
            size="small"
            label="Clear"
            disabled={!hasRegion}
            onClick={() => s.setLoop(null, null, false)}
          />
        </div>
        <div className={styles.row}>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={trainer.enabled}
              onChange={(e) => s.setTrainer({ enabled: e.target.checked })}
            />
            Speed trainer
          </label>
          <span className={styles.dim}>+</span>
          <Select
            value={trainer.step}
            onChange={(e) => s.setTrainer({ step: Number(e.target.value) })}
            aria-label="Trainer step"
          >
            {[0.02, 0.05, 0.1].map((v) => (
              <option key={v} value={v}>
                {pctLabel(v)}
              </option>
            ))}
          </Select>
          <span className={styles.dim}>every</span>
          <Select
            value={trainer.every}
            onChange={(e) => s.setTrainer({ every: Number(e.target.value) })}
            aria-label="Loops per step"
          >
            {[1, 2, 3, 4].map((v) => (
              <option key={v} value={v}>
                {v} {v === 1 ? 'loop' : 'loops'}
              </option>
            ))}
          </Select>
          <span className={styles.dim}>to</span>
          <Select
            value={trainer.target}
            onChange={(e) => s.setTrainer({ target: Number(e.target.value) })}
            aria-label="Trainer target speed"
          >
            {[0.8, 0.9, 1, 1.1, 1.25].map((v) => (
              <option key={v} value={v}>
                {pctLabel(v)}
              </option>
            ))}
          </Select>
          {practice.loopEnabled && <span className={styles.dim}>pass {loopCount}</span>}
        </div>
        <div className={styles.row}>
          <label
            className={styles.check}
            title="With Listen mode on, only passes you play at 90% or better count toward the next speed step"
          >
            <input
              type="checkbox"
              checked={trainer.clean}
              onChange={(e) => s.setTrainer({ clean: e.target.checked })}
            />
            Only clean passes (≥90%, needs Listen)
          </label>
          {lastPass !== null && (
            <span className={styles.dim}>
              last pass {Math.round(lastPass * 100)}%
              {trainer.clean ? ` · ${cleanStreak} clean in a row` : ''}
            </span>
          )}
        </div>
      </fieldset>
    </div>
  )
}
