/**
 * Find & replace (issue #459): find notes on the current track by fret,
 * string, technique or rhythm, step through them, and change them all at
 * once - a new fret, a fret shift, a technique removed, a new duration.
 */
import { model, type Settings } from '@coderline/alphatab'
import { HardwareButton, Select } from '@openaxe/ui'
import { useState } from 'react'

import styles from '../MediaCenter.module.css'
import { noteName, openPitches } from './fretboard'
import * as edit from './scoreEdit'
import * as ops from './scoreOps'
import t from './TabWorkspace.module.css'

type Apply = (fn: (score: model.Score, s: Settings) => edit.EditCursor | void) => void

interface FindReplaceProps {
  score: model.Score
  c: edit.EditCursor
  apply: Apply
  onCursor: (c: edit.EditCursor) => void
}

const num = (v: string) => (v === '' ? null : Number(v))

export function FindReplace({ score, c, apply, onCursor }: FindReplaceProps) {
  const [fret, setFret] = useState('')
  const [string, setString] = useState('')
  const [technique, setTechnique] = useState<ops.Technique | ''>('')
  const [duration, setDuration] = useState('')
  const [newFret, setNewFret] = useState(0)
  const [newDuration, setNewDuration] = useState<number>(model.Duration.Eighth)
  const [last, setLast] = useState<string | null>(null)
  const query: ops.FindQuery = {
    fret: num(fret),
    string: num(string),
    technique: technique || null,
    duration: num(duration) as model.Duration | null,
  }
  const any = fret !== '' || string !== '' || technique !== '' || duration !== ''
  const matches = any ? ops.findNotes(score, c, query) : []
  const tunings = score.tracks[c.track]?.staves[c.staff]?.stringTuning.tunings ?? []
  const open = openPitches(tunings)
  const strings = tunings.length
  // Where the cursor sits among the matches (for next / previous).
  const here = matches.findIndex(
    (m) => m.bar === c.bar && m.voice === c.voice && m.beat === c.beat && m.string === c.string,
  )
  const jump = (dir: 1 | -1) => {
    if (!matches.length) return
    let i: number
    if (here >= 0) i = (here + dir + matches.length) % matches.length
    else {
      const after = matches.findIndex((m) => m.bar > c.bar || (m.bar === c.bar && m.beat > c.beat))
      i = dir === 1 ? (after < 0 ? 0 : after) : (after <= 0 ? matches.length : after) - 1
    }
    const m = matches[i]!
    onCursor({ ...c, bar: m.bar, voice: m.voice, beat: m.beat, string: m.string })
  }
  const replace = (action: ops.ReplaceAction, what: string) =>
    apply((sc, s) => {
      const n = ops.replaceNotes(sc, c, ops.findNotes(sc, c, query), action, s)
      setLast(`${what}: ${n} note${n === 1 ? '' : 's'} changed`)
    })

  return (
    <div className={t.findBox}>
      <div className={t.findGrid}>
        <label>
          <span className={styles.dim}>fret</span>
          <input
            type="number"
            min={0}
            max={30}
            value={fret}
            placeholder="any"
            onChange={(e) => setFret(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            aria-label="Find fret"
          />
        </label>
        <label>
          <span className={styles.dim}>string</span>
          <Select
            value={string}
            onChange={(e) => setString(e.target.value)}
            aria-label="Find string"
          >
            <option value="">any</option>
            {Array.from({ length: strings }, (_, i) => strings - i).map((s) => (
              <option key={s} value={s}>
                {strings - s + 1} ({noteName(open[s]!, false)})
              </option>
            ))}
          </Select>
        </label>
        <label>
          <span className={styles.dim}>technique</span>
          <Select
            value={technique}
            onChange={(e) => setTechnique(e.target.value as ops.Technique | '')}
            aria-label="Find technique"
          >
            <option value="">any</option>
            {ops.TECHNIQUES.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </Select>
        </label>
        <label>
          <span className={styles.dim}>rhythm</span>
          <Select
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            aria-label="Find rhythm"
          >
            <option value="">any</option>
            {edit.DURATIONS.map((d) => (
              <option key={d} value={d}>
                {edit.DURATION_LABEL[d]}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <div className={t.tapRow}>
        <strong>
          {!any
            ? 'Pick what to find'
            : `${matches.length} match${matches.length === 1 ? '' : 'es'}${here >= 0 ? ` · ${here + 1}/${matches.length}` : ''}`}
        </strong>
        <HardwareButton
          size="small"
          label="◀"
          title="Previous match"
          disabled={!matches.length}
          onClick={() => jump(-1)}
        />
        <HardwareButton
          size="small"
          label="▶"
          title="Next match"
          disabled={!matches.length}
          onClick={() => jump(1)}
        />
      </div>

      {matches.length > 0 && (
        <div className={t.findActions}>
          <div className={t.tapRow}>
            <label className={t.textField}>
              <span className={styles.dim}>fret →</span>
              <input
                type="number"
                min={0}
                max={30}
                value={newFret}
                onChange={(e) => setNewFret(Number(e.target.value))}
                onKeyDown={(e) => e.stopPropagation()}
                aria-label="Replace with fret"
              />
            </label>
            <HardwareButton
              size="small"
              label="Set all"
              title={`Set every match to fret ${newFret}`}
              onClick={() => replace({ fret: newFret }, `Fret ${newFret}`)}
            />
            <HardwareButton
              size="small"
              label="−1"
              title="Every match a fret lower"
              onClick={() => replace({ shift: -1 }, 'Down a fret')}
            />
            <HardwareButton
              size="small"
              label="+1"
              title="Every match a fret higher"
              onClick={() => replace({ shift: 1 }, 'Up a fret')}
            />
          </div>
          <div className={t.tapRow}>
            <Select
              value={newDuration}
              onChange={(e) => setNewDuration(Number(e.target.value))}
              aria-label="Replace with rhythm"
            >
              {edit.DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {edit.DURATION_LABEL[d]}
                </option>
              ))}
            </Select>
            <HardwareButton
              size="small"
              label="Set rhythm"
              title="Give every matched beat this duration"
              onClick={() =>
                replace(
                  { duration: newDuration as model.Duration },
                  `Rhythm ${edit.DURATION_LABEL[newDuration]}`,
                )
              }
            />
            {technique && (
              <HardwareButton
                size="small"
                label={`Remove ${ops.TECHNIQUES.find((x) => x.id === technique)?.label}`}
                variant="danger"
                onClick={() => replace({ clear: technique }, 'Removed')}
              />
            )}
          </div>
        </div>
      )}
      {last && <p className={t.hint}>{last}. Undo with Ctrl/Cmd+Z.</p>}
    </div>
  )
}
