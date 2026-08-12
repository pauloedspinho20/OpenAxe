const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

export interface DetectedNote {
  /** e.g. "E", "A#" - no octave suffix, so it lines up with NOTE_NAMES directly. */
  name: string
  octave: number
  /** How far off the nearest note this frequency is, in cents (-50..50, 0 = dead on). */
  cents: number
}

/** Convert a frequency to the nearest note name/octave and how far off (in cents) it is - relative to a tunable A4 reference (concert pitch is 440Hz, but some players tune to 432/442 etc). */
export function frequencyToNote(frequency: number, referenceA4 = 440): DetectedNote {
  const midiFloat = 69 + 12 * Math.log2(frequency / referenceA4)
  const midi = Math.round(midiFloat)
  const cents = Math.round((midiFloat - midi) * 100)
  const name = NOTE_NAMES[((midi % 12) + 12) % 12]!
  const octave = Math.floor(midi / 12) - 1
  return { name, octave, cents }
}

export interface StringTuning {
  label: string
  /** Note names low to high, as shown to the user (e.g. ['E','A','D','G','B','E'] for standard guitar). */
  notes: string[]
}

/**
 * Common reference tunings (issue #7's "alternate tunings" task) - purely
 * informational labels shown in the tuner UI; detection itself is
 * tuning-agnostic (it just reports the nearest chromatic note year-round).
 */
export const REFERENCE_TUNINGS: readonly StringTuning[] = [
  { label: 'Guitar - Standard', notes: ['E', 'A', 'D', 'G', 'B', 'E'] },
  { label: 'Guitar - Drop D', notes: ['D', 'A', 'D', 'G', 'B', 'E'] },
  { label: 'Guitar - DADGAD', notes: ['D', 'A', 'D', 'G', 'A', 'D'] },
  { label: 'Bass - 4-string', notes: ['E', 'A', 'D', 'G'] },
  { label: 'Bass - 5-string', notes: ['B', 'E', 'A', 'D', 'G'] },
  { label: 'Bass - 6-string', notes: ['B', 'E', 'A', 'D', 'G', 'C'] },
]
