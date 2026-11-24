/**
 * Step entry (issue #459): write notes at the cursor from a MIDI keyboard or
 * guitar, or from the guitar itself via pitch detection, then move on - the
 * pure timing and placement logic.
 */
import { type FretPos, openPitches, placePitch } from './fretboard'

/**
 * Groups MIDI note-ons into chords: notes arriving within `windowMs` of each
 * other are one chord, released once no new note has come for that long.
 */
export class ChordCollector {
  private pitches: number[] = []
  private last = 0
  private readonly windowMs: number

  constructor(windowMs = 70) {
    this.windowMs = windowMs
  }

  add(pitch: number, now: number): void {
    if (!this.pitches.includes(pitch)) this.pitches.push(pitch)
    this.last = now
  }

  /** The finished chord (once), or null while still collecting / empty. */
  poll(now: number): number[] | null {
    if (!this.pitches.length || now - this.last < this.windowMs) return null
    const out = this.pitches
    this.pitches = []
    return out
  }
}

/**
 * Turns a stream of detected pitches (MIDI note numbers, null = nothing
 * clear) into played notes: a note counts once it has held for `holdMs`; the
 * same note again needs a gap (silence or another note) in between, so a
 * sustained note isn't written twice.
 */
export class StepDetector {
  private candidate: number | null = null
  private since = 0
  private armed = true
  private lastAccepted: number | null = null
  private readonly holdMs: number

  constructor(holdMs = 120) {
    this.holdMs = holdMs
  }

  feed(note: number | null, now: number): number | null {
    if (note !== this.candidate) {
      this.candidate = note
      this.since = now
      if (note === null || note !== this.lastAccepted) this.armed = true
      return null
    }
    if (note === null || !this.armed || now - this.since < this.holdMs) return null
    this.armed = false
    this.lastAccepted = note
    return note
  }
}

/** Frequency (Hz) to the nearest MIDI note number. */
export const midiFromFrequency = (hz: number) => Math.round(69 + 12 * Math.log2(hz / 440))

/**
 * Places a chord on the neck. A single note goes where the hand already is
 * (the string whose fret is closest to `near`, the previous note's fret; open
 * strings count as close), or on the cursor's string when there's no previous
 * note. A chord goes highest pitch first, each on the free string with the
 * lowest fret. Pitches out of range are dropped.
 */
export function placeChord(
  tunings: readonly number[],
  pitches: readonly number[],
  prefer: number,
  maxFret = 24,
  near: number | null = null,
): FretPos[] {
  if (pitches.length === 1) {
    const p =
      near === null
        ? placePitch(tunings, pitches[0]!, prefer, maxFret)
        : placeNear(tunings, pitches[0]!, near, maxFret)
    return p ? [p] : []
  }
  const out: FretPos[] = []
  for (const pitch of [...pitches].sort((a, b) => b - a)) {
    const p = placePitch(
      tunings,
      pitch,
      -1,
      maxFret,
      out.map((o) => o.string),
    )
    if (p && !out.some((o) => o.string === p.string)) out.push(p)
  }
  return out
}

/** The position of `pitch` closest to fret `near` (open strings: within 2 frets). */
export function placeNear(
  tunings: readonly number[],
  pitch: number,
  near: number,
  maxFret = 24,
): FretPos | null {
  const open = openPitches(tunings)
  let best: FretPos | null = null
  let bestCost = Infinity
  for (let s = 1; s < open.length; s++) {
    const f = pitch - open[s]!
    if (f < 0 || f > maxFret) continue
    const cost = f === 0 ? Math.min(near, 2) : Math.abs(f - near)
    if (cost < bestCost || (cost === bestCost && best && f < best.fret)) {
      best = { string: s, fret: f }
      bestCost = cost
    }
  }
  return best
}
