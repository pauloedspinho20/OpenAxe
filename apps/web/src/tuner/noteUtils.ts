// Core note mapping lives in packages/core/src/dsp/note_utils.cpp (issue #123).
// The TS implementation here is the presentational fallback; when the WASM
// module is ready, `frequencyToNote` forwards to `openaxe_frequency_to_note`
// so every front end displays the same reading. Both paths are proven
// equivalent by the ported suite in packages/core/tests (pitch_note_test)
// and by noteUtils.test.ts here — see noteUtils.test.ts's WASM-parity case.
// Keeping the TS path also preserves offline/test determinism when WASM
// isn't loaded (Node/jsdom, etc.).
import { ensureWasm, frequencyToNoteWasm } from './openAxeWasm'

let wasmNoteMod: unknown | null = null
let wasmNoteReady = false
if (typeof window !== 'undefined') {
  void ensureWasm()
    .then((m) => {
      wasmNoteMod = m
      wasmNoteReady = m !== null
    })
    .catch(() => {})
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

export interface DetectedNote {
  /** e.g. "E", "A#" - no octave suffix, so it lines up with NOTE_NAMES directly. */
  name: string
  octave: number
  /** How far off the nearest note this frequency is, in cents (-50..50, 0 = dead on). */
  cents: number
}

/** TS fallback — identical arithmetic to the C++ in note_utils.cpp. */
export function frequencyToNoteFallback(frequency: number, referenceA4 = 440): DetectedNote {
  const midiFloat = 69 + 12 * Math.log2(frequency / referenceA4)
  const midi = Math.round(midiFloat)
  const cents = Math.round((midiFloat - midi) * 100)
  const name = NOTE_NAMES[((midi % 12) + 12) % 12]!
  const octave = Math.floor(midi / 12) - 1
  return { name, octave, cents }
}

/** Convert a frequency to the nearest note name/octave and how far off (in cents) it is - relative to a tunable A4 reference (concert pitch is 440Hz, but some players tune to 432/442 etc). */
export function frequencyToNote(frequency: number, referenceA4 = 440): DetectedNote {
  if (wasmNoteReady && wasmNoteMod) {
    try {
      const r = frequencyToNoteWasm(frequency, referenceA4, wasmNoteMod as never)
      if (r) return r as DetectedNote
    } catch {
      // fall through to TS fallback
    }
  }
  return frequencyToNoteFallback(frequency, referenceA4)
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
