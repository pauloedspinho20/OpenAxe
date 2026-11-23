/**
 * Drum lane editor (issue #206 / #184): a step grid for the current bar of a
 * percussion track - one row per kit piece, one column per beat. Click a cell
 * to toggle that hit; the grid buttons re-divide the bar into 8ths/16ths.
 */
import { model, type Settings } from '@coderline/alphatab'
import { HardwareButton } from '@openaxe/ui'

import styles from '../MediaCenter.module.css'
import * as edit from './scoreEdit'
import * as ops from './scoreOps'
import tabStyles from './TabWorkspace.module.css'

type Apply = (fn: (score: model.Score, s: Settings) => edit.EditCursor | void) => void

interface DrumLaneProps {
  score: model.Score
  cursor: edit.EditCursor
  apply: Apply
  onCursor: (c: edit.EditCursor) => void
}

export function DrumLane({ score, cursor, apply, onCursor }: DrumLaneProps) {
  const voice = edit.voiceAt(score, cursor)
  if (!voice) return null
  const beats = voice.beats
  const track = score.tracks[cursor.track]
  const c = cursor
  return (
    <div className={tabStyles.drumLane} aria-label="Drum lane">
      <div className={tabStyles.paletteGroup}>
        <span className={styles.dim}>Bar {cursor.bar + 1} grid</span>
        {(
          [
            [model.Duration.Quarter, '1/4'],
            [model.Duration.Eighth, '1/8'],
            [model.Duration.Sixteenth, '1/16'],
          ] as const
        ).map(([d, label]) => (
          <HardwareButton
            key={d}
            size="small"
            label={label}
            onClick={() => apply((sc, s) => ops.setBarGrid(sc, c, d, s))}
          />
        ))}
        <HardwareButton
          size="small"
          label="◀"
          ariaLabel="Previous bar"
          onClick={() => onCursor(edit.moveBar(score, c, -1))}
        />
        <HardwareButton
          size="small"
          label="▶"
          ariaLabel="Next bar"
          onClick={() => {
            if (cursor.bar >= score.masterBars.length - 1)
              apply((sc, s) => ({ ...c, bar: edit.insertBar(sc, c.bar, s), beat: 0 }))
            else onCursor(edit.moveBar(score, c, 1))
          }}
        />
      </div>
      <div
        className={tabStyles.drumGrid}
        style={{ gridTemplateColumns: `110px repeat(${beats.length}, minmax(18px, 1fr))` }}
      >
        {ops.DRUM_KIT.map((piece) => (
          <div key={piece.id} className={tabStyles.drumRow}>
            <span className={tabStyles.drumLabel}>{piece.label}</span>
            {beats.map((b, i) => {
              const on = b.notes.some((n) => track && ops.drumId(track, n) === piece.id)
              return (
                <button
                  key={i}
                  type="button"
                  className={`${tabStyles.drumCell} ${on ? tabStyles.drumOn : ''} ${i === cursor.beat ? tabStyles.drumCursor : ''}`}
                  onClick={() => {
                    onCursor({ ...c, beat: i })
                    apply((sc, s) => void ops.toggleDrumHit(sc, c, i, piece.id, s))
                  }}
                  aria-pressed={on}
                  aria-label={`${piece.label}, step ${i + 1}`}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
