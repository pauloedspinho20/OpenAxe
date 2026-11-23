/**
 * Fretboard / piano / keypad input panel (issue #459): switchable between
 * numeric touch keypad (default on narrow/touch), interactive fretboard neck
 * (with position jump shortcuts), and piano roll; cursor & playing notes
 * light up live, and MIDI / guitar step entry remain directly accessible.
 */
import { ButtonGroup } from '@openaxe/ui'
import { type CSSProperties, useMemo, useRef, useState } from 'react'

import styles from '../MediaCenter.module.css'
import { type FretPos, INLAYS, isBlackKey, noteName, openPitches, pitchAt } from './fretboard'
import * as I from './tabIcons'
import t from './TabWorkspace.module.css'
import { TouchFretPad, type TouchFretPadProps } from './TouchFretPad'

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
  /** Step entry: write notes played on a MIDI controller or the guitar. */
  stepInput: StepInput
  onStepInput: (mode: StepInput) => void
  stepAdvance: boolean
  onStepAdvance: (on: boolean) => void
  /** Default view mode; narrow/touch defaults to 'keypad'. */
  defaultMode?: InputMode | undefined
  /** Props needed to render the TouchFretPad when mode === 'keypad'. */
  touchPadProps?:
    Omit<TouchFretPadProps, 'tunings' | 'capo' | 'cursorString' | 'cursorNotes'> | undefined
  /** Hide the outer panel card frame when embedded inside the bottom dock. */
  embedded?: boolean | undefined
}

export type InputMode = 'keypad' | 'neck' | 'piano'
export type StepInput = 'off' | 'midi' | 'guitar'

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
  stepInput,
  onStepInput,
  stepAdvance,
  onStepAdvance,
  defaultMode = 'neck',
  touchPadProps,
  embedded = false,
}: FretboardPanelProps) {
  const [mode, setMode] = useState<InputMode>(touchPadProps ? defaultMode : 'neck')
  const neckScrollRef = useRef<HTMLDivElement | null>(null)
  const open = useMemo(() => openPitches(tunings), [tunings])
  const strings = tunings.length
  // Top row = highest string, as on the tab.
  const rows = Array.from({ length: strings }, (_, i) => strings - i)

  const jumpFret = (fret: number) => {
    const el = neckScrollRef.current
    if (!el) return
    const ratio = fret / Math.max(1, frets)
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth)
    el.scrollTo({ left: Math.round(maxScroll * ratio), behavior: 'smooth' })
  }

  const modeOptions: { id: InputMode; label: string; Icon: typeof I.KeypadIcon }[] = [
    ...(touchPadProps ? [{ id: 'keypad' as const, label: 'Keypad', Icon: I.KeypadIcon }] : []),
    { id: 'neck', label: 'Fretboard', Icon: I.FretboardIcon },
    { id: 'piano', label: 'Piano', Icon: I.PianoIcon },
  ]

  return (
    <div className={`${t.fretPanel} ${embedded ? t.fretPanelEmbedded : ''}`}>
      <div className={t.fretHead}>
        <ButtonGroup
          mode="radiogroup"
          label="Input mode"
          value={mode}
          onChange={setMode}
          items={modeOptions.map(({ id, label, Icon }) => ({
            value: id,
            label,
            icon: <Icon size={13} />,
          }))}
        />

        <ButtonGroup
          mode="radiogroup"
          label="Play to enter notes"
          value={stepInput}
          onChange={onStepInput}
          items={[
            { value: 'off', label: 'Tap', title: 'Enter notes by tapping' },
            {
              value: 'midi',
              label: 'MIDI',
              title:
                'Play notes or chords on a MIDI keyboard or guitar to write them at the cursor',
            },
            {
              value: 'guitar',
              label: 'Guitar',
              title: 'Play single notes on your guitar to write them at the cursor (when stopped)',
            },
          ]}
        />

        {stepInput !== 'off' && (
          <label className={styles.check} title="Move to the next beat after each note or chord">
            <input
              type="checkbox"
              checked={stepAdvance}
              onChange={(e) => onStepAdvance(e.target.checked)}
            />
            Advance
          </label>
        )}

        {mode === 'neck' && (
          <ButtonGroup
            label="Fretboard position"
            onChange={(f) => jumpFret(Number(f))}
            items={[
              { value: '0', label: '0–5' },
              { value: '5', label: '5–12' },
              { value: '12', label: '12–24' },
            ]}
          />
        )}

        <span className={t.fretHint}>
          {stepInput === 'midi'
            ? 'Listening to MIDI: play a note or chord'
            : stepInput === 'guitar'
              ? 'Listening to guitar: pick one note at a time'
              : mode === 'keypad'
                ? 'Tap a string, then tap a fret'
                : 'Tap to add or remove a note'}
          {capo > 0 && ` · capo ${capo}`}
        </span>

        {mode !== 'keypad' && (
          <span className={t.fretLegend}>
            <i className={t.fretDotCursor} /> cursor <i className={t.fretDotPlay} /> playing
          </span>
        )}
      </div>

      {mode === 'keypad' && touchPadProps ? (
        <TouchFretPad
          tunings={tunings}
          capo={capo}
          cursorString={cursorString}
          cursorNotes={cursorNotes}
          {...touchPadProps}
        />
      ) : mode === 'neck' ? (
        <div
          ref={neckScrollRef}
          className={t.neckScroll}
          tabIndex={0}
          role="region"
          aria-label="Fretboard"
        >
          <div
            className={t.neck}
            style={{ '--neck-cols': `36px repeat(${frets}, minmax(30px, 1fr))` } as CSSProperties}
            role="grid"
            aria-label="Fretboard grid"
          >
            <div
              className={t.neckInlays}
              style={{ gridRow: `1 / ${strings + 1}` }}
              aria-hidden="true"
            >
              {INLAYS.filter((f) => f <= frets).map((f) => {
                const double = f % 12 === 0
                return (
                  <span
                    key={f}
                    className={`${t.neckInlaySlot} ${double ? t.neckInlayDouble : ''}`}
                    style={{ gridColumn: f + 1 }}
                    data-inlay-fret={f}
                    data-inlay={double ? 'double' : 'single'}
                  >
                    <span className={t.neckInlayDot} />
                    {double && <span className={t.neckInlayDot} />}
                  </span>
                )
              })}
            </div>
            {rows.map((s, rowIdx) => (
              <div key={s} className={t.neckRow} style={{ gridRow: rowIdx + 1 }} role="row">
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
                      <span className={t.fretString} style={{ height: 1 + (strings - s) * 0.35 }} />
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
            <div className={t.neckRow} style={{ gridRow: strings + 1 }} aria-hidden="true">
              {Array.from({ length: frets + 1 }, (_, f) => (
                <span
                  key={f}
                  className={`${t.fretNumber} ${INLAYS.includes(f) ? t.fretNumberMarked : ''}`}
                >
                  {f === 0 ? '' : f}
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
  const W = 28
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
    <div className={t.neckScroll} tabIndex={0} role="region" aria-label="Piano keyboard">
      <div className={t.piano} style={{ width: whites.length * W }} aria-label="Piano">
        {whites.map((p) => key(p, false))}
        {keys.filter(isBlackKey).map((p) => key(p, true, whites.indexOf(p - 1) * W + W - 9))}
      </div>
    </div>
  )
}
