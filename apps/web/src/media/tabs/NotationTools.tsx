/**
 * Notation tools row of the edit palette (issue #206 / #183): bends, slides,
 * tremolo picking, trills, grace notes, chords, sections, text, lyrics,
 * dynamics and the voice switch.
 */
import { model, type Settings } from '@coderline/alphatab'
import { useState } from 'react'

import styles from '../MediaCenter.module.css'
import * as edit from './scoreEdit'
import * as ops from './scoreOps'
import tabStyles from './TabWorkspace.module.css'

type Apply = (fn: (score: model.Score, s: Settings) => edit.EditCursor | void) => void

interface NotationToolsProps {
  score: model.Score
  cursor: edit.EditCursor
  apply: Apply
  onVoice: (voice: number) => void
}

/** A small text input applied on Enter/blur. */
function TextTool({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string
  value: string
  placeholder: string
  onCommit: (v: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft)
    setDraft(null)
  }
  return (
    <label className={tabStyles.inlineField} title={label}>
      <span>{label}</span>
      <input
        value={draft ?? value}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') setDraft(null)
        }}
      />
    </label>
  )
}

export function NotationTools({ score, cursor, apply, onVoice }: NotationToolsProps) {
  const beat = edit.beatAt(score, cursor)
  const note = edit.noteAt(score, cursor)
  const staff = score.tracks[cursor.track]?.staves[cursor.staff]
  const chordName = beat?.chordId ? (staff?.getChord(beat.chordId)?.name ?? '') : ''
  const section = score.masterBars[cursor.bar]?.section?.text ?? ''
  const voices = staff?.bars[cursor.bar]?.voices.length ?? 1
  const dyn = beat
    ? (Object.keys(model.DynamicValue).find(
        (k) => model.DynamicValue[k as 'F'] === beat.dynamics,
      ) ?? 'F')
    : 'F'
  const c = cursor

  return (
    <>
      <div className={tabStyles.paletteGroup} aria-label="Bends and slides">
        <span className={styles.dim}>Bend</span>
        {ops.BEND_PRESETS.map((b) => (
          <button
            key={b.id}
            type="button"
            className={tabStyles.pbtn}
            disabled={!note}
            onClick={() => apply((sc, s) => ops.setBend(sc, c, b.id, s))}
          >
            {b.label}
          </button>
        ))}
        <span className={styles.dim}>Slide</span>
        {ops.SLIDES.map((sl) => (
          <button
            key={sl.id}
            type="button"
            className={tabStyles.pbtn}
            disabled={!note}
            title={sl.title}
            onClick={() => apply((sc, s) => ops.setSlide(sc, c, sl.id, s))}
          >
            {sl.label}
          </button>
        ))}
      </div>
      <div className={tabStyles.paletteGroup} aria-label="Ornaments">
        <span className={styles.dim}>Tremolo</span>
        <select
          className={styles.select}
          value={beat?.tremoloPicking?.marks ?? 0}
          disabled={!beat}
          onChange={(e) => apply((sc, s) => ops.setTremolo(sc, c, Number(e.target.value), s))}
          aria-label="Tremolo picking"
        >
          <option value={0}>off</option>
          <option value={1}>♪ 8th</option>
          <option value={2}>♬ 16th</option>
          <option value={3}>32nd</option>
        </select>
        <button
          type="button"
          className={`${tabStyles.pbtn} ${note?.isTrill ? tabStyles.pbtnOn : ''}`}
          disabled={!note}
          title="Trill with the fret two above (toggle)"
          onClick={() =>
            apply((sc, s) => ops.setTrill(sc, c, note?.isTrill ? null : (note?.fret ?? 0) + 2, s))
          }
        >
          tr
        </button>
        <button
          type="button"
          className={tabStyles.pbtn}
          disabled={!beat}
          title="Add a grace note before this beat (two frets below the note)"
          onClick={() =>
            apply((sc, s) => ops.addGraceNote(sc, c, Math.max(0, (note?.fret ?? 2) - 2), s))
          }
        >
          grace
        </button>
        <span className={styles.dim}>Dyn.</span>
        <select
          className={styles.select}
          value={dyn}
          disabled={!beat}
          onChange={(e) =>
            apply((sc, s) =>
              ops.setDynamics(sc, c, e.target.value as (typeof ops.DYNAMICS)[number], s),
            )
          }
          aria-label="Dynamics"
        >
          {ops.DYNAMICS.map((d) => (
            <option key={d} value={d}>
              {d.toLowerCase()}
            </option>
          ))}
        </select>
        <span className={styles.dim}>Voice</span>
        {[0, 1].map((v) => (
          <button
            key={v}
            type="button"
            className={`${tabStyles.pbtn} ${cursor.voice === v ? tabStyles.pbtnOn : ''}`}
            title={v === 0 ? 'Voice 1' : voices > 1 ? 'Voice 2' : 'Add a second voice'}
            onClick={() => {
              if (v >= voices) apply((sc, s) => ops.ensureVoice(sc, c, v, s))
              onVoice(v)
            }}
          >
            V{v + 1}
          </button>
        ))}
      </div>
      <div className={tabStyles.paletteGroup} aria-label="Text">
        <TextTool
          label="Chord"
          value={chordName}
          placeholder="Am7"
          onCommit={(v) => apply((sc, s) => ops.setChord(sc, c, v, s))}
        />
        <TextTool
          label="Section"
          value={section}
          placeholder="Chorus"
          onCommit={(v) => apply((sc, s) => ops.setSection(sc, c.bar, v, s))}
        />
        <TextTool
          label="Text"
          value={beat?.text ?? ''}
          placeholder="let ring"
          onCommit={(v) => apply((sc, s) => ops.setBeatText(sc, c, v, s))}
        />
        <TextTool
          label="Lyric"
          value={beat?.lyrics?.[0] ?? ''}
          placeholder="la"
          onCommit={(v) => apply((sc, s) => ops.setLyric(sc, c, v, s))}
        />
      </div>
    </>
  )
}
