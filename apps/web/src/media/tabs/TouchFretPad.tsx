/**
 * Touch-friendly fret keypad + string strip + navigation & quick rhythm bar
 * (issue #459 / #17 prerequisite): fast, keyboardless tab entry on phones and
 * tablets with 44px+ tap targets and zero multi-digit timing ambiguity.
 */
import { model } from '@coderline/alphatab'
import { useState } from 'react'

import { type FretPos, noteName, openPitches } from './fretboard'
import * as edit from './scoreEdit'
import * as I from './tabIcons'
import t from './TabWorkspace.module.css'

export interface TouchFretPadProps {
  /** Tuning as alphaTab lists it (highest string first). */
  tunings: readonly number[]
  capo: number
  /** Active cursor string (1 = lowest string). */
  cursorString: number
  /** Notes of the beat at the edit cursor. */
  cursorNotes: FretPos[]
  barIndex: number
  barCount: number
  beatIndex: number
  beatDuration: model.Duration
  beatDotted: boolean
  beatIsRest: boolean
  autoAdvance: boolean
  onAutoAdvance: (on: boolean) => void
  onSelectString: (string: number) => void
  onEnterFret: (fret: number) => void
  onClearNote: () => void
  onRest: () => void
  onDeadNote: () => void
  onMoveBeat: (dir: -1 | 1) => void
  onMoveBar: (dir: -1 | 1) => void
  onDuration: (d: model.Duration) => void
  onToggleDot: () => void
}

const LOW_FRETS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
const HIGH_FRETS = [0, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]
const QUICK_DURATIONS = [
  model.Duration.Whole,
  model.Duration.Half,
  model.Duration.Quarter,
  model.Duration.Eighth,
  model.Duration.Sixteenth,
  model.Duration.ThirtySecond,
] as const

export function TouchFretPad({
  tunings,
  capo,
  cursorString,
  cursorNotes,
  barIndex,
  barCount,
  beatIndex,
  beatDuration,
  beatDotted,
  beatIsRest,
  autoAdvance,
  onAutoAdvance,
  onSelectString,
  onEnterFret,
  onClearNote,
  onRest,
  onDeadNote,
  onMoveBeat,
  onMoveBar,
  onDuration,
  onToggleDot,
}: TouchFretPadProps) {
  const [bank, setBank] = useState<'low' | 'high'>('low')
  const open = openPitches(tunings)
  const strings = tunings.length
  // Match tab staff order: highest string first (string = strings down to 1).
  const stringRows = Array.from({ length: strings }, (_, i) => strings - i)
  const noteOnCursorString = cursorNotes.find((n) => n.string === cursorString)
  const frets = bank === 'low' ? LOW_FRETS : HIGH_FRETS

  return (
    <div className={t.touchPad} aria-label="Touch fret entry">
      {/* String selector strip */}
      <div className={t.touchStrings} role="group" aria-label="Strings">
        {stringRows.map((s) => {
          const note = cursorNotes.find((n) => n.string === s)
          const openName = noteName(open[s] ?? 0, false)
          const selected = s === cursorString
          return (
            <button
              key={s}
              type="button"
              className={`${t.touchStringBtn} ${selected ? t.touchStringOn : ''}`}
              aria-pressed={selected}
              aria-label={`String ${strings - s + 1} (${openName})${note ? `, fret ${note.fret}` : ''}`}
              onClick={() => onSelectString(s)}
            >
              <span className={t.touchStringName}>{openName}</span>
              <span className={t.touchStringFret}>{note ? note.fret : '·'}</span>
            </button>
          )
        })}
      </div>

      {/* Direct fret keypad */}
      <div className={t.touchFretGrid} role="group" aria-label="Frets">
        {frets.map((f) => {
          const active = noteOnCursorString?.fret === f
          return (
            <button
              key={f}
              type="button"
              className={`${t.touchKey} ${f === 0 ? t.touchKeyOpen : ''} ${active ? t.touchKeyOn : ''}`}
              aria-pressed={active}
              aria-label={`Fret ${f}`}
              onClick={() => onEnterFret(f)}
            >
              {f}
            </button>
          )
        })}
        <button
          type="button"
          className={`${t.touchKey} ${t.touchKeyAlt}`}
          aria-pressed={bank === 'high'}
          aria-label={bank === 'low' ? 'Frets 13 to 24' : 'Frets 0 to 12'}
          onClick={() => setBank((b) => (b === 'low' ? 'high' : 'low'))}
        >
          {bank === 'low' ? '13–24' : '0–12'}
        </button>
        <button
          type="button"
          className={`${t.touchKey} ${t.touchKeyWarn}`}
          aria-label="Clear note on active string"
          title="Clear note"
          disabled={!noteOnCursorString}
          onClick={onClearNote}
        >
          <I.BackspaceIcon size={18} />
        </button>
      </div>

      {/* Navigation + quick rhythm & beat actions */}
      <div className={t.touchActions}>
        <div className={t.touchNavGroup} role="group" aria-label="Cursor navigation">
          <button
            type="button"
            className={t.touchActionBtn}
            aria-label="Previous bar"
            disabled={barIndex === 0}
            onClick={() => onMoveBar(-1)}
          >
            <I.ChevronLeftIcon size={16} />
            <span>Bar</span>
          </button>
          <button
            type="button"
            className={t.touchActionBtn}
            aria-label="Previous beat"
            disabled={barIndex === 0 && beatIndex === 0}
            onClick={() => onMoveBeat(-1)}
          >
            <I.ChevronLeftIcon size={16} />
          </button>
          <span className={t.touchCursorReadout}>
            {barIndex + 1}/{barCount}·{beatIndex + 1}
            {capo > 0 ? ` c${capo}` : ''}
          </span>
          <button
            type="button"
            className={`${t.touchActionBtn} ${t.touchActionPrimary}`}
            aria-label="Next beat"
            onClick={() => onMoveBeat(1)}
          >
            <span>Next</span>
            <I.ChevronRightIcon size={16} />
          </button>
          <button
            type="button"
            className={t.touchActionBtn}
            aria-label="Next bar"
            disabled={barIndex >= barCount - 1}
            onClick={() => onMoveBar(1)}
          >
            <span>Bar</span>
            <I.ChevronRightIcon size={16} />
          </button>
        </div>

        <div className={t.touchRhythmRow} role="group" aria-label="Duration and beat actions">
          {QUICK_DURATIONS.map((d) => {
            const Icon = I.NOTE_ICON[d]
            return (
              <button
                key={d}
                type="button"
                className={`${t.touchChipBtn} ${beatDuration === d ? t.touchChipOn : ''}`}
                aria-pressed={beatDuration === d}
                aria-label={`${edit.DURATION_LABEL[d]} note`}
                onClick={() => onDuration(d)}
              >
                {Icon ? <Icon size={16} /> : edit.DURATION_LABEL[d]}
              </button>
            )
          })}
          <button
            type="button"
            className={`${t.touchChipBtn} ${beatDotted ? t.touchChipOn : ''}`}
            aria-pressed={beatDotted}
            aria-label="Dotted"
            onClick={onToggleDot}
          >
            <I.DotIcon size={16} />
          </button>
          <button
            type="button"
            className={`${t.touchChipBtn} ${beatIsRest ? t.touchChipOn : ''}`}
            aria-pressed={beatIsRest}
            aria-label="Rest"
            onClick={onRest}
          >
            <I.RestIcon size={16} />
          </button>
          <button
            type="button"
            className={t.touchChipBtn}
            aria-label="Dead note"
            disabled={!noteOnCursorString}
            onClick={onDeadNote}
          >
            <I.DeadNoteIcon size={16} />
          </button>
          <button
            type="button"
            className={`${t.touchChipBtn} ${t.touchAutoBtn} ${autoAdvance ? t.touchChipOn : ''}`}
            aria-pressed={autoAdvance}
            aria-label="Auto advance to next beat after entering a fret"
            onClick={() => onAutoAdvance(!autoAdvance)}
          >
            Auto ▶
          </button>
        </div>
      </div>
    </div>
  )
}
