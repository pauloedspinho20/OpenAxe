/**
 * Fretboard / piano input (issue #459): the pure part - open-string pitches
 * from a staff's tuning, the notes a beat holds, and where on the neck a
 * pitch clicked on the piano goes.
 */

/** A note on the neck. `string` is alphaTab's numbering: 1 = lowest. */
export interface FretPos {
  string: number
  fret: number
}

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

export const noteName = (midi: number, octave = true) =>
  `${NAMES[((midi % 12) + 12) % 12]}${octave ? Math.floor(midi / 12) - 1 : ''}`

export const isBlackKey = (midi: number) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12)

/** Fretboard inlay positions (12 and 24 are doubled). */
export const INLAYS: readonly number[] = [5, 7, 9, 12, 15, 17, 19, 21, 24]

/**
 * Open-string pitch per string, indexed by alphaTab string number (index 0
 * unused). alphaTab lists tunings from the highest string down.
 */
export function openPitches(tunings: readonly number[]): number[] {
  const n = tunings.length
  const out = [0]
  for (let s = 1; s <= n; s++) out.push(tunings[n - s]!)
  return out
}

/** Pitch of a fretted note (written fret, as on the tab; the capo is not added). */
export function pitchAt(tunings: readonly number[], pos: FretPos): number {
  return openPitches(tunings)[pos.string]! + pos.fret
}

/** The notes of a beat as neck positions (fretted notes only). */
export function beatPositions(
  beat: { notes: readonly { string: number; fret: number; isStringed?: boolean }[] } | null,
): FretPos[] {
  if (!beat) return []
  return beat.notes
    .filter((n) => n.string > 0 && n.fret >= 0)
    .map((n) => ({ string: n.string, fret: n.fret }))
}

/**
 * Where a pitch goes on the neck: the preferred string if it's free and the
 * pitch is playable there; otherwise a free string (not in `taken`) with the lowest
 * fret, then any string with the lowest fret. Null if out of range.
 */
export function placePitch(
  tunings: readonly number[],
  pitch: number,
  prefer: number,
  maxFret: number,
  taken: readonly number[] = [],
): FretPos | null {
  const open = openPitches(tunings)
  const fits = (s: number) => {
    const f = pitch - open[s]!
    return f >= 0 && f <= maxFret ? f : null
  }
  const pf = prefer >= 1 && prefer < open.length && !taken.includes(prefer) ? fits(prefer) : null
  if (pf !== null) return { string: prefer, fret: pf }
  let best: FretPos | null = null
  let bestFree: FretPos | null = null
  for (let s = 1; s < open.length; s++) {
    const f = fits(s)
    if (f === null) continue
    if (!best || f < best.fret) best = { string: s, fret: f }
    if (!taken.includes(s) && (!bestFree || f < bestFree.fret)) bestFree = { string: s, fret: f }
  }
  return bestFree ?? best
}
