/**
 * Chord library and chord-name finder (issue #459): guitar voicings for any
 * root and quality (open shapes plus movable E- and A-shape barres), and a
 * name for the notes of a beat. Pure - the toolbox inserts and labels.
 */
import { openPitches } from './fretboard'

export const ROOTS = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'] as const

/** Quality suffix -> intervals (semitones above the root). Order = finder preference. */
export const QUALITIES: { id: string; label: string; intervals: number[] }[] = [
  { id: '', label: 'major', intervals: [0, 4, 7] },
  { id: 'm', label: 'minor', intervals: [0, 3, 7] },
  { id: '7', label: '7', intervals: [0, 4, 7, 10] },
  { id: 'm7', label: 'm7', intervals: [0, 3, 7, 10] },
  { id: 'maj7', label: 'maj7', intervals: [0, 4, 7, 11] },
  { id: '5', label: '5 (power)', intervals: [0, 7] },
  { id: 'sus4', label: 'sus4', intervals: [0, 5, 7] },
  { id: 'sus2', label: 'sus2', intervals: [0, 2, 7] },
  { id: 'add9', label: 'add9', intervals: [0, 2, 4, 7] },
  { id: '6', label: '6', intervals: [0, 4, 7, 9] },
  { id: 'm6', label: 'm6', intervals: [0, 3, 7, 9] },
  { id: '9', label: '9', intervals: [0, 2, 4, 7, 10] },
  { id: 'dim', label: 'dim', intervals: [0, 3, 6] },
  { id: 'm7♭5', label: 'm7♭5', intervals: [0, 3, 6, 10] },
  { id: 'dim7', label: 'dim7', intervals: [0, 3, 6, 9] },
  { id: 'aug', label: 'aug', intervals: [0, 4, 8] },
]

/** A voicing: frets from the lowest string up (-1 = muted), as written on the tab. */
export interface Voicing {
  frets: number[]
  /** Where it comes from, e.g. "open", "E shape", "A shape". */
  shape: string
}

// Standard tuning E A D G B E, low to high.
const STANDARD = [40, 45, 50, 55, 59, 64]

/** Open-position voicings in standard tuning, by chord name. */
const OPEN: Record<string, number[]> = {
  C: [-1, 3, 2, 0, 1, 0],
  A: [-1, 0, 2, 2, 2, 0],
  G: [3, 2, 0, 0, 0, 3],
  E: [0, 2, 2, 1, 0, 0],
  D: [-1, -1, 0, 2, 3, 2],
  Am: [-1, 0, 2, 2, 1, 0],
  Em: [0, 2, 2, 0, 0, 0],
  Dm: [-1, -1, 0, 2, 3, 1],
  C7: [-1, 3, 2, 3, 1, 0],
  A7: [-1, 0, 2, 0, 2, 0],
  G7: [3, 2, 0, 0, 0, 1],
  E7: [0, 2, 0, 1, 0, 0],
  D7: [-1, -1, 0, 2, 1, 2],
  B7: [-1, 2, 1, 2, 0, 2],
  Am7: [-1, 0, 2, 0, 1, 0],
  Em7: [0, 2, 0, 0, 0, 0],
  Dm7: [-1, -1, 0, 2, 1, 1],
  Cmaj7: [-1, 3, 2, 0, 0, 0],
  Amaj7: [-1, 0, 2, 1, 2, 0],
  Dmaj7: [-1, -1, 0, 2, 2, 2],
  Fmaj7: [-1, -1, 3, 2, 1, 0],
  Asus4: [-1, 0, 2, 2, 3, 0],
  Asus2: [-1, 0, 2, 2, 0, 0],
  Dsus4: [-1, -1, 0, 2, 3, 3],
  Dsus2: [-1, -1, 0, 2, 3, 0],
  Esus4: [0, 2, 2, 2, 0, 0],
  Cadd9: [-1, 3, 2, 0, 3, 0],
  E5: [0, 2, 2, -1, -1, -1],
  A5: [-1, 0, 2, 2, -1, -1],
  D5: [-1, -1, 0, 2, 3, -1],
}

/** Movable shapes: frets relative to the root's fret on the shape's root string. */
const E_SHAPE: Record<string, number[]> = {
  '': [0, 2, 2, 1, 0, 0],
  m: [0, 2, 2, 0, 0, 0],
  '7': [0, 2, 0, 1, 0, 0],
  m7: [0, 2, 0, 0, 0, 0],
  maj7: [0, -1, 1, 1, 0, -1],
  '5': [0, 2, 2, -1, -1, -1],
  sus4: [0, 2, 2, 2, 0, 0],
}
const A_SHAPE: Record<string, number[]> = {
  '': [-1, 0, 2, 2, 2, 0],
  m: [-1, 0, 2, 2, 1, 0],
  '7': [-1, 0, 2, 0, 2, 0],
  m7: [-1, 0, 2, 0, 1, 0],
  maj7: [-1, 0, 2, 1, 2, 0],
  '5': [-1, 0, 2, 2, -1, -1],
  sus4: [-1, 0, 2, 2, 3, 0],
  sus2: [-1, 0, 2, 2, 0, 0],
  '6': [-1, 0, 2, 2, 2, 2],
  m6: [-1, 0, 2, -1, 1, 2],
  dim: [-1, 0, 1, 2, 1, -1],
  'm7♭5': [-1, 0, 1, 0, 1, -1],
  dim7: [-1, 0, 1, -1, 1, -1],
  aug: [-1, 0, 3, 2, 2, -1],
}

/**
 * The semitone shift that turns standard tuning into this tuning (e.g. -1
 * for E♭ standard), or null when the tuning isn't standard-shaped.
 */
export function standardShift(tunings: readonly number[]): number | null {
  const open = openPitches(tunings).slice(1)
  if (open.length !== 6) return null
  const shift = open[0]! - STANDARD[0]!
  return open.every((p, i) => p - STANDARD[i]! === shift) ? shift : null
}

const pc = (n: number) => ((n % 12) + 12) % 12

/**
 * Voicings for `root` (0 = C) and quality `q` on a standard-shaped tuning,
 * lowest position first. Written frets: with a uniformly shifted tuning the
 * shapes keep their names on the sounding pitch.
 */
export function voicings(tunings: readonly number[], root: number, q: string): Voicing[] {
  const shift = standardShift(tunings)
  if (shift === null) return []
  const out: Voicing[] = []
  // Sounding root -> the root to finger in standard tuning.
  const fingerRoot = pc(root - shift)
  const name = `${ROOTS[fingerRoot]!.replace('♯', '#').replace('♭', 'b')}${q}`
  const openKey = Object.keys(OPEN).find(
    (k) => normalise(k) === normalise(name) || normalise(k) === normalise(enharmonic(name)),
  )
  if (openKey) out.push({ frets: OPEN[openKey]!, shape: 'open' })
  const movable = (shape: Record<string, number[]>, rootString: number, label: string) => {
    const rel = shape[q]
    if (!rel) return
    const base = pc(fingerRoot - pc(STANDARD[rootString]!))
    for (const f0 of [base, base + 12]) {
      if (f0 === 0 || f0 > 14) continue
      out.push({ frets: rel.map((r) => (r < 0 ? -1 : r + f0)), shape: `${label} shape` })
    }
  }
  movable(E_SHAPE, 0, 'E')
  movable(A_SHAPE, 1, 'A')
  const seen = new Set<string>()
  return out
    .filter((v) => {
      const k = v.frets.join(',')
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .sort((a, b) => lowestFret(a.frets) - lowestFret(b.frets))
}

const lowestFret = (frets: number[]) => {
  const f = frets.filter((x) => x > 0)
  return f.length ? Math.min(...f) : 0
}
const normalise = (s: string) => s.replace('♯', '#').replace('♭', 'b')
function enharmonic(name: string): string {
  const m = /^([A-G][#b]?)(.*)$/.exec(normalise(name))
  if (!m) return name
  const map: Record<string, string> = {
    'C#': 'Db',
    Db: 'C#',
    'D#': 'Eb',
    Eb: 'D#',
    'F#': 'Gb',
    Gb: 'F#',
    'G#': 'Ab',
    Ab: 'G#',
    'A#': 'Bb',
    Bb: 'A#',
  }
  return (map[m[1]!] ?? m[1]!) + m[2]!
}

/**
 * Names a set of sounding pitches (MIDI numbers): tries every pitch class as
 * the root against the qualities, preferring the bass note as root, then
 * fewer missing/extra notes. A different bass is written as a slash chord.
 * Null for fewer than two pitch classes or nothing close.
 */
export function nameChord(pitches: readonly number[]): string | null {
  if (!pitches.length) return null
  const classes = [...new Set(pitches.map(pc))]
  if (classes.length < 2) return null
  const bass = pc(Math.min(...pitches))
  let best: { name: string; cost: number } | null = null
  for (const root of classes) {
    for (const [qi, q] of QUALITIES.entries()) {
      const want = q.intervals.map((i) => pc(root + i))
      const missing = want.filter((p) => !classes.includes(p)).length
      const extra = classes.filter((p) => !want.includes(p)).length
      // A missing fifth is common and fine; anything else missing or extra costs.
      const fifthMissing = !classes.includes(pc(root + 7)) && want.includes(pc(root + 7)) ? 1 : 0
      if (extra > 0 || missing - fifthMissing > 0) continue
      const cost = fifthMissing * 0.5 + (root === bass ? 0 : 1) + qi * 0.01
      if (!best || cost < best.cost) {
        const slash = root === bass ? '' : `/${ROOTS[bass]}`
        best = { name: `${ROOTS[root]}${q.id}${slash}`, cost }
      }
    }
  }
  return best?.name ?? null
}
