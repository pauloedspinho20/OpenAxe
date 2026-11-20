/**
 * Wait mode (issue #205 practice toolkit): the tab waits on each note until
 * the guitar plays it. Pure helpers here; the listening loop lives in the
 * workspace (it needs the input analyser and the transport).
 */
import type { model } from '@coderline/alphatab'

import { beatAt, voiceAt, type EditCursor } from './scoreEdit'

export interface WaitTarget {
  /** MIDI pitches of the beat's notes (sounding pitch: tuning + capo + fret). */
  midi: number[]
  /** Human label, e.g. "G3 (6th string, fret 3)". */
  label: string
}

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
export const midiName = (m: number) => `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`
const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`

export function frequencyToMidi(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440)
}

/** What to play for a beat, or null for rests, empty beats and drum tracks. */
export function targetFor(score: model.Score, c: EditCursor): WaitTarget | null {
  const staff = score.tracks[c.track]?.staves[c.staff]
  const beat = beatAt(score, c)
  if (!staff || staff.isPercussion || !beat || beat.isRest || beat.notes.length === 0) return null
  const notes = beat.notes.filter((n) => !n.isDead && !n.isTieDestination)
  if (!notes.length) return null
  const strings = staff.stringTuning.tunings.length
  const midi = notes.map((n) => n.realValue)
  const label = notes
    .slice()
    .sort((a, b) => a.realValue - b.realValue)
    .map(
      (n) =>
        `${midiName(n.realValue)} (${ordinal(strings - n.string + 1)} string, ${n.fret === 0 ? 'open' : `fret ${n.fret}`})`,
    )
    .join(' + ')
  return { midi, label }
}

/**
 * Does a detected pitch satisfy the target? Within `cents` of any of its
 * notes; an octave off also counts (pitch detectors and players both slip
 * octaves, and the point is the note, not the register).
 */
export function matches(freq: number, target: WaitTarget, cents = 50): boolean {
  if (!(freq > 0)) return false
  const m = frequencyToMidi(freq)
  return target.midi.some((t) => {
    const d = Math.abs(m - t)
    return d * 100 <= cents || Math.abs(d - 12) * 100 <= cents
  })
}

/** The next beat (after `c`, across bars) that has something to play; null at the end. */
export function nextTarget(
  score: model.Score,
  c: EditCursor,
  includeCurrent = false,
): EditCursor | null {
  let bar = c.bar
  let beat = includeCurrent ? c.beat : c.beat + 1
  while (bar < score.masterBars.length) {
    const voice = voiceAt(score, { ...c, bar })
    const n = voice?.beats.length ?? 0
    for (; beat < n; beat++) {
      const at = { ...c, bar, beat }
      if (targetFor(score, at)) return at
    }
    bar++
    beat = 0
  }
  return null
}
