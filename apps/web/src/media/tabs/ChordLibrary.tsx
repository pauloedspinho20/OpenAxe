/**
 * Chord library (issue #459): pick a root and quality, click a voicing to
 * write it into the beat at the cursor with its diagram; and the name of the
 * chord the beat already holds (capo-aware), one click to label it.
 */
import { model, type Settings } from '@coderline/alphatab'
import { HardwareButton, Select } from '@openaxe/ui'
import { useState } from 'react'

import styles from '../MediaCenter.module.css'
import { nameChord, QUALITIES, ROOTS, voicings } from './chords'
import { openPitches } from './fretboard'
import * as edit from './scoreEdit'
import * as ops from './scoreOps'
import t from './TabWorkspace.module.css'

type Apply = (fn: (score: model.Score, s: Settings) => edit.EditCursor | void) => void

interface ChordLibraryProps {
  score: model.Score
  c: edit.EditCursor
  apply: Apply
}

const pc = (n: number) => ((n % 12) + 12) % 12

export function ChordLibrary({ score, c, apply }: ChordLibraryProps) {
  const staff = score.tracks[c.track]?.staves[c.staff]
  const [root, setRoot] = useState(0)
  const [quality, setQuality] = useState('')
  if (!staff || staff.isPercussion) return null
  const tunings = staff.stringTuning.tunings
  const capo = staff.capo
  const open = openPitches(tunings)
  const beat = edit.beatAt(score, c)
  // Sounding pitches of the beat (the capo raises every string).
  const sounding = (beat?.notes ?? []).map((n) => open[n.string]! + n.fret + capo)
  const detected = nameChord(sounding)
  const shapeName = capo ? nameChord(sounding.map((p) => p - capo)) : null
  const name = `${ROOTS[root]}${quality}`
  // With a capo, finger the shape a capo's worth lower so it sounds as named.
  const list = voicings(tunings, pc(root - capo), quality)
  const shapeOf = capo ? `${ROOTS[pc(root - capo)]}${quality}` : null
  return (
    <div className={t.chordLib}>
      <div className={t.tapRow}>
        <span>
          This beat: <strong>{detected ?? (sounding.length ? 'no chord found' : '—')}</strong>
          {shapeName && detected && (
            <span className={styles.dim}>
              {' '}
              ({shapeName} shape, capo {capo})
            </span>
          )}
        </span>
        {detected && (
          <HardwareButton
            size="small"
            label="Label it"
            title={`Name this beat's chord ${detected}`}
            onClick={() => apply((sc, s) => ops.setChord(sc, c, detected, s))}
          />
        )}
      </div>
      <div className={t.tapRow}>
        <Select value={root} onChange={(e) => setRoot(Number(e.target.value))} aria-label="Root">
          {ROOTS.map((r, i) => (
            <option key={r} value={i}>
              {r}
            </option>
          ))}
        </Select>
        <Select
          value={quality}
          onChange={(e) => setQuality(e.target.value)}
          aria-label="Chord quality"
        >
          {QUALITIES.map((q) => (
            <option key={q.id} value={q.id}>
              {q.label}
            </option>
          ))}
        </Select>
        {shapeOf && (
          <span className={styles.dim}>
            {shapeOf} shapes (capo {capo})
          </span>
        )}
      </div>
      {list.length === 0 ? (
        <p className={t.hint}>
          The library has shapes for 6-string standard tuning (or one tuned evenly up or down).
        </p>
      ) : (
        <div className={t.chordGrid} role="list" aria-label={`${name} voicings`}>
          {list.map((v) => (
            <button
              key={v.frets.join(',')}
              type="button"
              role="listitem"
              className={t.chordCard}
              title={`Write ${name} (${v.shape}) at the cursor`}
              aria-label={`${name}, ${v.shape}: ${v.frets.map((f) => (f < 0 ? 'x' : f)).join(' ')}`}
              onClick={() => apply((sc, s) => ops.insertVoicing(sc, c, v.frets, name, s))}
            >
              <ChordDiagram frets={v.frets} />
              <span>{v.shape}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** A small chord box: strings low to high left to right, 4 frets shown. */
export function ChordDiagram({ frets }: { frets: readonly number[] }) {
  const played = frets.filter((f) => f > 0)
  const top = played.length && Math.max(...played) > 4 ? Math.min(...played) : 1
  const W = 56
  const H = 64
  const n = frets.length
  const x = (i: number) => 13 + (i * (W - 19)) / (n - 1)
  const y = (f: number) => 14 + (f - top + 0.5) * 11
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden className={t.chordSvg}>
      {top === 1 ? (
        <line x1={x(0)} x2={x(n - 1)} y1={14} y2={14} strokeWidth={3} />
      ) : (
        <text x={1} y={22} textAnchor="start" fontSize={8}>
          {top}
        </text>
      )}
      {Array.from({ length: 5 }, (_, i) => (
        <line key={`f${i}`} x1={x(0)} x2={x(n - 1)} y1={14 + i * 11} y2={14 + i * 11} />
      ))}
      {Array.from({ length: n }, (_, i) => (
        <line key={`s${i}`} x1={x(i)} x2={x(i)} y1={14} y2={58} />
      ))}
      {frets.map((f, i) =>
        f < 0 ? (
          <text key={i} x={x(i)} y={10} textAnchor="middle" fontSize={8}>
            ×
          </text>
        ) : f === 0 ? (
          <circle key={i} cx={x(i)} cy={7} r={2.5} fill="none" />
        ) : (
          <circle key={i} cx={x(i)} cy={y(f)} r={3.6} className={t.chordDot} />
        ),
      )}
    </svg>
  )
}
