import { usePlayerStore, SPEED_TRAINER_PRESETS } from './playerStore'
import { ticksForBars } from '@openaxe/songbook'
import { HardwareButton } from '@openaxe/ui'
import styles from './PracticeToolkit.module.css'

export function PracticeToolkit() {
  const tempoScale = usePlayerStore((s) => s.tempoScale)
  const setTempoScale = usePlayerStore((s) => s.setTempoScale)
  const loopStart = usePlayerStore((s) => s.loopStartTick)
  const loopEnd = usePlayerStore((s) => s.loopEndTick)
  const setLoop = usePlayerStore((s) => s.setLoop)
  const clearLoop = usePlayerStore((s) => s.clearLoop)
  const metronome = usePlayerStore((s) => s.metronome)
  const setMetronome = usePlayerStore((s) => s.setMetronome)
  const countInBars = usePlayerStore((s) => s.countInBars)
  const setCountIn = usePlayerStore((s) => s.setCountIn)
  const transpose = usePlayerStore((s) => s.transposeSemitones)
  const setTranspose = usePlayerStore((s) => s.setTranspose)
  const positionTicks = usePlayerStore((s) => s.positionTicks)
  const setPositionTicks = usePlayerStore((s) => s.setPositionTicks)
  const currentSong = usePlayerStore((s) => s.currentSong)

  const sections = currentSong ? Math.ceil(currentSong.barCount / 4) : 0

  return (
    <div className={styles.toolkit} role="region" aria-label="Practice toolkit">
      <div className={styles.row}>
        <span className={styles.label}>Speed trainer</span>
        <div className={styles.presets}>
          {SPEED_TRAINER_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className={`${styles.presetBtn} ${tempoScale === p.scale ? styles.active : ''}`}
              onClick={() => setTempoScale(p.scale)}
            >
              {p.label} {Math.round(p.scale * 100)}%
            </button>
          ))}
        </div>
        <label className={styles.sliderLabel}>
          Custom
          <input
            type="range"
            min={0.25}
            max={2}
            step={0.05}
            value={tempoScale}
            onChange={(e) => setTempoScale(Number(e.target.value))}
          />
          <span>{Math.round(tempoScale * 100)}%</span>
        </label>
      </div>

      <div className={styles.row}>
        <span className={styles.label}>Sections</span>
        <div className={styles.sections}>
          {Array.from({ length: sections }, (_, i) => {
            const start = i * ticksForBars(4)
            const end = start + ticksForBars(4)
            const isActive = positionTicks >= start && positionTicks < end
            return (
              <button
                key={i}
                type="button"
                className={`${styles.sectionBtn} ${isActive ? styles.active : ''}`}
                onClick={() => setPositionTicks(start)}
                aria-label={`Go to section ${i + 1}`}
              >
                {i + 1}
              </button>
            )
          })}
        </div>
        <HardwareButton label="Clear Loop" onClick={clearLoop} disabled={loopStart === null} />
        <button
          type="button"
          className={styles.actionBtn}
          onClick={() => {
            const barTicks = ticksForBars(1)
            const start = Math.floor(positionTicks / barTicks) * barTicks
            setLoop(start, start + barTicks)
          }}
        >
          Set loop to bar
        </button>
        {loopStart !== null && (
          <span className={styles.hint}>
            Loop {Math.floor(loopStart / 3840) + 1}–{Math.floor((loopEnd ?? 0) / 3840)}
          </span>
        )}
      </div>

      <div className={styles.row}>
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={metronome}
            onChange={(e) => setMetronome(e.target.checked)}
          />
          Metronome
        </label>
        <label className={styles.control}>
          Count-in
          <select
            value={countInBars}
            onChange={(e) => setCountIn(Number(e.target.value))}
            aria-label="Count-in bars"
          >
            <option value={0}>Off</option>
            <option value={1}>1 bar</option>
            <option value={2}>2 bars</option>
            <option value={4}>4 bars</option>
          </select>
        </label>
        <label className={styles.control}>
          Transpose
          <input
            type="range"
            min={-12}
            max={12}
            step={1}
            value={transpose}
            onChange={(e) => setTranspose(Number(e.target.value))}
          />
          <span>{transpose > 0 ? `+${transpose}` : transpose} st</span>
        </label>
      </div>
    </div>
  )
}
