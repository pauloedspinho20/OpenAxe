/**
 * Chord chart / lead sheet (issue #459): the song as sections of bars with
 * their chords and lyrics, for strumming songs - built from the score's
 * chord names, lyrics, section markers and repeats. Pure.
 */
import type { model } from '@coderline/alphatab'

export interface ChartChord {
  name: string
  /** Where in the bar it starts, 0..1. */
  at: number
}

export interface ChartBar {
  index: number
  chords: ChartChord[]
  lyrics: string
  repeatStart: boolean
  /** Times to play when the bar closes a repeat (0 = no repeat end). */
  repeatEnd: number
}

export interface ChartSection {
  label: string
  bars: ChartBar[]
}

/** The first track (from `prefer`) whose beats carry chords, or `prefer`. */
function chordTrack(score: model.Score, prefer: number): number {
  const has = (t: model.Track) =>
    t.staves.some((s) => s.bars.some((b) => b.voices.some((v) => v.beats.some((x) => !!x.chordId))))
  const order = [prefer, ...score.tracks.map((_, i) => i).filter((i) => i !== prefer)]
  return order.find((i) => score.tracks[i] && has(score.tracks[i]!)) ?? prefer
}

function lyricTrack(score: model.Score, prefer: number): number {
  const has = (t: model.Track) =>
    t.staves.some((s) =>
      s.bars.some((b) => b.voices.some((v) => v.beats.some((x) => !!x.lyrics?.some(Boolean)))),
    )
  const order = [prefer, ...score.tracks.map((_, i) => i).filter((i) => i !== prefer)]
  return order.find((i) => score.tracks[i] && has(score.tracks[i]!)) ?? prefer
}

export function buildLeadSheet(score: model.Score, prefer = 0): ChartSection[] {
  const ct = score.tracks[chordTrack(score, prefer)]
  const lt = score.tracks[lyricTrack(score, prefer)]
  const sections: ChartSection[] = []
  let current: ChartSection | null = null
  score.masterBars.forEach((mb, i) => {
    if (mb.section || !current) {
      current = { label: mb.section?.text || (i === 0 ? '' : '…'), bars: [] }
      sections.push(current)
    }
    const chords: ChartChord[] = []
    const staff = ct?.staves[0]
    const bar = staff?.bars[i]
    const length = Math.max(1, mb.calculateDuration())
    for (const beat of bar?.voices[0]?.beats ?? []) {
      if (!beat.chordId) continue
      const name = staff!.getChord(beat.chordId)?.name
      if (name) chords.push({ name, at: Math.min(1, beat.playbackStart / length) })
    }
    const words: string[] = []
    for (const beat of lt?.staves[0]?.bars[i]?.voices[0]?.beats ?? []) {
      const syl = beat.lyrics?.[0]
      if (syl) words.push(syl)
    }
    current!.bars.push({
      index: i,
      chords,
      lyrics: joinSyllables(words),
      repeatStart: mb.isRepeatStart,
      repeatEnd: mb.repeatCount > 1 ? mb.repeatCount : 0,
    })
  })
  return sections
}

/** Join lyric syllables: a trailing "-" glues the next syllable on. */
export function joinSyllables(syllables: string[]): string {
  let out = ''
  for (const s of syllables) {
    const glue = out.endsWith('-')
    if (glue) out = out.slice(0, -1)
    out += (out && !glue ? ' ' : '') + s
  }
  return out.replace(/-$/, '')
}

const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
const PC: Record<string, number> = {}
SHARP.forEach((n, i) => (PC[n] = i))
FLAT.forEach((n, i) => (PC[n] = i))
Object.assign(PC, {
  'C♯': 1,
  'D♯': 3,
  'F♯': 6,
  'G♯': 8,
  'A♯': 10,
  'D♭': 1,
  'E♭': 3,
  'G♭': 6,
  'A♭': 8,
  'B♭': 10,
})

/**
 * Transpose a chord name ("F#m7", "C/G", "B♭maj7") by semitones; names it
 * can't read are returned unchanged. Flats stay flats.
 */
export function transposeChord(name: string, semitones: number): string {
  if (!semitones) return name
  return name.replace(/([A-G](?:#|b|♯|♭)?)/g, (root, _m, offset: number) => {
    // Only roots: at the start or right after a slash.
    if (offset !== 0 && name[offset - 1] !== '/') return root
    const pc = PC[root]
    if (pc === undefined) return root
    const useFlats = /b|♭/.test(root)
    const n = (((pc + semitones) % 12) + 12) % 12
    return (useFlats ? FLAT : SHARP)[n]!
  })
}
