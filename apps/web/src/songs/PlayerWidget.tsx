import { useEffect, useRef } from 'react'
import { usePlayerStore, SPEED_TRAINER_PRESETS } from './playerStore'
import { useSongsStore } from './songsStore'
import { openSongsLibrary } from './SongsLibrary'
import { HardwareButton } from '@openaxe/ui'
import { ticksForBars } from '@openaxe/songbook'
import styles from './PlayerWidget.module.css'

function formatTime(ticks: number, ticksPerBeat = 960, bpm = 120): string {
  const beats = ticks / ticksPerBeat
  const secs = Math.floor((beats * 60) / bpm) % 60
  const mins = Math.floor((beats * 60) / bpm / 60)
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

export function PlayerWidget() {
  const currentSong = usePlayerStore((s) => s.currentSong)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const positionTicks = usePlayerStore((s) => s.positionTicks)
  const tempoScale = usePlayerStore((s) => s.tempoScale)
  const loopStart = usePlayerStore((s) => s.loopStartTick)
  const loopEnd = usePlayerStore((s) => s.loopEndTick)
  const trackMutes = usePlayerStore((s) => s.trackMutes)
  const setPlaying = usePlayerStore((s) => s.setPlaying)
  const setPositionTicks = usePlayerStore((s) => s.setPositionTicks)
  const setTempoScale = usePlayerStore((s) => s.setTempoScale)
  const setLoop = usePlayerStore((s) => s.setLoop)
  const clearLoop = usePlayerStore((s) => s.clearLoop)
  const toggleTrackMute = usePlayerStore((s) => s.toggleTrackMute)
  const songs = useSongsStore((s) => s.songs)

  const positionRef = useRef<HTMLInputElement>(null)

  // Keyboard shortcuts: Space = play/pause, L = set loop from selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && (e.target as HTMLElement)?.tagName !== 'INPUT') {
        e.preventDefault()
        setPlaying(!isPlaying)
      }
      if (e.code === 'KeyL' && !e.repeat) {
        e.preventDefault()
        // Set loop to current bar (bar-granular)
        const barTicks = ticksForBars(1)
        const start = Math.floor(positionTicks / barTicks) * barTicks
        setLoop(start, start + barTicks)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isPlaying, positionTicks, setPlaying, setLoop])

  if (!currentSong) {
    return (
      <div className={styles.widget} role="region" aria-label="Song player">
        <div className={styles.empty}>
          <span>No song selected</span>
          <HardwareButton label="Browse Songs" onClick={openSongsLibrary} />
          {songs.length === 0 && (
            <span className={styles.hint}>
              Import a .gp, .musicxml, .mid or .atex file to start
            </span>
          )}
        </div>
      </div>
    )
  }

  const durationTicks = currentSong.durationTicks
  const progress = durationTicks > 0 ? (positionTicks / durationTicks) * 100 : 0
  const hasLoop = loopStart !== null && loopEnd !== null

  return (
    <div className={styles.widget} role="region" aria-label="Song player">
      <div className={styles.header}>
        <div
          className={styles.title}
          onClick={openSongsLibrary}
          role="button"
          tabIndex={0}
          title="Open song library"
        >
          {currentSong.title} {currentSong.artist ? `— ${currentSong.artist}` : ''}
        </div>
        <div className={styles.transport}>
          <HardwareButton
            label={isPlaying ? 'Pause' : 'Play'}
            active={isPlaying}
            onClick={() => setPlaying(!isPlaying)}
            aria-pressed={isPlaying}
            title="Space"
          />
          <HardwareButton
            label="Stop"
            onClick={() => {
              setPlaying(false)
              setPositionTicks(0)
            }}
          />
        </div>
      </div>

      <div className={styles.positionRow}>
        <span className={styles.time}>{formatTime(positionTicks)}</span>
        <input
          ref={positionRef}
          type="range"
          className={styles.positionBar}
          min={0}
          max={durationTicks}
          value={Math.min(positionTicks, durationTicks)}
          onChange={(e) => setPositionTicks(Number(e.target.value))}
          aria-label="Position"
        />
        <span className={styles.time}>{formatTime(durationTicks)}</span>
        <div className={styles.progress} style={{ width: `${progress}%` }} aria-hidden />
      </div>

      <div className={styles.controls}>
        <label className={styles.control}>
          Tempo
          <input
            type="range"
            min={0.25}
            max={2}
            step={0.05}
            value={tempoScale}
            onChange={(e) => setTempoScale(Number(e.target.value))}
            aria-label="Tempo"
          />
          <span>{Math.round(tempoScale * 100)}%</span>
        </label>

        <div className={styles.presets}>
          {SPEED_TRAINER_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className={`${styles.presetBtn} ${tempoScale === p.scale ? styles.active : ''}`}
              onClick={() => setTempoScale(p.scale)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className={styles.loopRow}>
          <HardwareButton
            label={hasLoop ? 'Clear Loop' : 'Set Loop'}
            onClick={() =>
              hasLoop ? clearLoop() : setLoop(positionTicks, positionTicks + ticksForBars(1))
            }
            title="L"
          />
          {hasLoop && (
            <span className={styles.hint}>
              Loop {Math.floor(loopStart! / 3840) + 1}–{Math.floor(loopEnd! / 3840)}
            </span>
          )}
        </div>
      </div>

      <div className={styles.tracks}>
        {currentSong.tracks.map((track) => (
          <label key={track.id} className={styles.trackToggle}>
            <input
              type="checkbox"
              checked={!trackMutes[track.id]}
              onChange={() => toggleTrackMute(track.id)}
              aria-label={`Mute ${track.name}`}
            />
            {track.name} ({track.instrument})
          </label>
        ))}
      </div>
    </div>
  )
}
