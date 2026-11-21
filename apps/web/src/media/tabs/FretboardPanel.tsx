/**
 * Fretboard / piano input panel (issue #459): click a fret (or a piano key)
 * to write that note into the beat at the edit cursor; the notes of the
 * cursor's beat and the beat playing now light up on the neck and the keys.
 */
import { useMemo, useState } from 'react'

import styles from '../MediaCenter.module.css'
import { type FretPos, INLAYS, isBlackKey, noteName, openPitches, pitchAt } from './fretboard'
import t from './TabWorkspace.module.css'

interface FretboardPanelProps {
  /** The staff's tuning as alphaTab lists it (highest string first). */
  tunings: readonly number[]
  capo: number
  frets?: number
  cursorString: number
  /** Notes of the beat at the edit cursor. */
  cursorNotes: FretPos[]
  /** Notes of the beat playing now (empty when stopped). */
  playingNotes: FretPos[]
  onFret: (pos: FretPos) => void
  onPitch: (pitch: number) => void
}

type Mode = 'neck' | 'piano'

const has = (list: FretPos[], s: number, f: number) =>
  list.some((p) => p.string === s && p.fret === f)

export function FretboardPanel({
  tunings,
  capo,
  frets = 24,
  cursorString,
  cursorNotes,
  playingNotes,
  onFret,
  onPitch,
}: FretboardPanelProps) {
  const [mode, setMode] = useState<Mode>('neck')
  const open = useMemo(() => openPitches(tunings), [tunings])
  const strings = tunings.length
  // Top row = highest string, as on the tab.
  const rows = Array.from({ length: strings }, (_, i) => strings - i)
  return (
    <div className={t.fretPanel}>
      <div className={t.fretHead}>
        <div className={t.segmented} role="radiogroup" aria-label="Input">
          {(
            [
              ['neck', 'Fretboard'],
              ['piano', 'Piano'],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              className={mode === m ? t.segOn : ''}
              onClick={() => setMode(m)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className={styles.dim}>
          Click to add a note to the beat at the cursor · click it again to remove
          {capo > 0 && ` · capo ${capo}`}
        </span>
        <span className={t.fretLegend}>
          <i className={t.fretDotCursor} /> cursor beat <i className={t.fretDotPlay} /> playing
        </span>
      </div>

      {mode === 'neck' ? (
        <div className={t.neckScroll}>
          <div
            className={t.neck}
            style={{ gridTemplateColumns: `34px repeat(${frets}, minmax(30px, 1fr))` }}
            role="grid"
            aria-label="Fretboard"
          >
            {rows.map((s) => (
              <div key={s} className={t.neckRow} role="row">
                {Array.from({ length: frets + 1 }, (_, f) => {
                  const cur = has(cursorNotes, s, f)
                  const play = has(playingNotes, s, f)
                  const pitch = open[s]! + f
                  return (
                    <button
                      key={f}
                      type="button"
                      role="gridcell"
                      className={`${t.fret} ${f === 0 ? t.fretOpen : ''} ${s === cursorString ? t.fretRowOn : ''} ${f > 0 && f <= capo ? t.fretCapo : ''}`}
                      title={`${noteName(pitch)} — string ${strings - s + 1}, fret ${f}`}
                      aria-label={`String ${strings - s + 1} fret ${f} (${noteName(pitch)})${cur ? ', in the beat' : ''}`}
                      aria-pressed={cur}
                      onClick={() => onFret({ string: s, fret: f })}
                    >
                      <span className={t.fretString} style={{ height: 1 + (s - 1) * 0.35 }} />
                      {(cur || play) && (
                        <span
                          className={`${t.fretDot} ${play ? t.fretDotPlay : ''} ${cur ? t.fretDotCursor : ''}`}
                        >
                          {f}
                        </span>
                      )}
                      {f === 0 && !cur && !play && (
                        <span className={t.fretOpenName}>{noteName(open[s]!, false)}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
            <div className={t.neckRow} aria-hidden>
              {Array.from({ length: frets + 1 }, (_, f) => (
                <span key={f} className={t.fretNumber}>
                  {INLAYS.includes(f) ? (f % 12 === 0 ? `${f}••` : `${f}•`) : f === 0 ? '' : f}
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <Piano
          low={Math.min(...open.slice(1))}
          high={Math.max(...open.slice(1)) + frets}
          cursor={cursorNotes.map((p) => pitchAt(tunings, p))}
          playing={playingNotes.map((p) => pitchAt(tunings, p))}
          onPitch={onPitch}
        />
      )}
    </div>
  )
}

function Piano({
  low,
  high,
  cursor,
  playing,
  onPitch,
}: {
  low: number
  high: number
  cursor: number[]
  playing: number[]
  onPitch: (pitch: number) => void
}) {
  // Start and end on white keys so the black keys have neighbours.
  const from = isBlackKey(low) ? low - 1 : low
  const to = isBlackKey(high) ? high + 1 : high
  const keys = Array.from({ length: to - from + 1 }, (_, i) => from + i)
  const whites = keys.filter((k) => !isBlackKey(k))
  const W = 22
  const key = (p: number, black: boolean, left?: number) => {
    const cur = cursor.includes(p)
    const play = playing.includes(p)
    return (
      <button
        key={p}
        type="button"
        className={`${black ? t.keyBlack : t.keyWhite} ${cur ? t.keyCursor : ''} ${play ? t.keyPlay : ''}`}
        style={black ? { left } : undefined}
        title={noteName(p)}
        aria-label={`${noteName(p)}${cur ? ', in the beat' : ''}`}
        aria-pressed={cur}
        onClick={() => onPitch(p)}
      >
        {!black && p % 12 === 0 && <span>{noteName(p)}</span>}
      </button>
    )
  }
  return (
    <div className={t.neckScroll}>
      <div className={t.piano} style={{ width: whites.length * W }} aria-label="Piano">
        {whites.map((p) => key(p, false))}
        {keys.filter(isBlackKey).map((p) => key(p, true, whites.indexOf(p - 1) * W + W - 7))}
      </div>
    </div>
  )
}
