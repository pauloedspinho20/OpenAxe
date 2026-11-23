/**
 * Second tier of score editing (issue #206): ranges and the clipboard, tracks
 * and song setup, notation tools, voices and drums. Same contract as
 * scoreEdit.ts - pure model transforms over an alphaTab Score that return the
 * cursor to use next; the caller snapshots for undo, re-renders and saves.
 */
import { exporter, importer, model, type Settings } from '@coderline/alphatab'

import { autoFinger, type FingeringOptions } from './fingering'
import {
  beatAt,
  clampCursor,
  copyBeat,
  insertBar,
  noteAt,
  refresh,
  relink,
  stringCount,
  voiceAt,
  type EditCursor,
} from './scoreEdit'

type Score = model.Score
type Beat = model.Beat

// ── Ranges ───────────────────────────────────────────────────────────────

export interface BeatRef {
  bar: number
  beat: number
}

const before = (a: BeatRef, b: BeatRef) => a.bar < b.bar || (a.bar === b.bar && a.beat <= b.beat)

/** Every beat from `a` to `b` (either order), inclusive, on the cursor's track/staff/voice. */
export function rangeBeats(score: Score, c: EditCursor, a: BeatRef, b: BeatRef): BeatRef[] {
  const [from, to] = before(a, b) ? [a, b] : [b, a]
  const out: BeatRef[] = []
  for (let bar = from.bar; bar <= to.bar; bar++) {
    const voice = voiceAt(score, { ...c, bar })
    if (!voice) continue
    const first = bar === from.bar ? from.beat : 0
    const last = bar === to.bar ? Math.min(to.beat, voice.beats.length - 1) : voice.beats.length - 1
    for (let beat = first; beat <= last; beat++) out.push({ bar, beat })
  }
  return out
}

/** True when the range covers whole bars (first beat of its first bar to last of its last). */
export function isWholeBars(score: Score, c: EditCursor, refs: BeatRef[]): boolean {
  if (!refs.length) return false
  const first = refs[0]!
  const last = refs[refs.length - 1]!
  const lastVoice = voiceAt(score, { ...c, bar: last.bar })
  return first.beat === 0 && last.beat === (lastVoice?.beats.length ?? 0) - 1
}

export type Clipboard = { kind: 'beats'; beats: Beat[] } | { kind: 'bars'; bars: Beat[][] }

export function copyRange(score: Score, c: EditCursor, refs: BeatRef[]): Clipboard | null {
  if (!refs.length) return null
  const beats = refs.map((r) => beatAt(score, { ...c, ...r })).filter((b): b is Beat => !!b)
  if (isWholeBars(score, c, refs)) {
    const bars: Beat[][] = []
    let current = -1
    refs.forEach((r, i) => {
      if (r.bar !== current) {
        bars.push([])
        current = r.bar
      }
      bars[bars.length - 1]!.push(copyBeat(beats[i]!))
    })
    return { kind: 'bars', bars }
  }
  return { kind: 'beats', beats: beats.map(copyBeat) }
}

/** Remove the range's beats; a bar left empty gets a whole rest. Returns the cursor at its start. */
export function deleteRange(
  score: Score,
  c: EditCursor,
  refs: BeatRef[],
  settings: Settings,
): EditCursor {
  if (!refs.length) return c
  const byBar = new Map<number, number[]>()
  for (const r of refs) byBar.set(r.bar, [...(byBar.get(r.bar) ?? []), r.beat])
  for (const [bar, beats] of byBar) {
    const voice = voiceAt(score, { ...c, bar })
    if (!voice) continue
    for (const i of beats.sort((x, y) => y - x)) voice.beats.splice(i, 1)
    if (voice.beats.length === 0) {
      const rest = new model.Beat()
      rest.duration = model.Duration.Whole
      voice.addBeat(rest)
    }
  }
  relink(score)
  refresh(score, settings)
  return clampCursor(score, { ...c, ...refs[0]! })
}

const isEmptyBar = (voice: model.Voice) => voice.beats.length === 1 && voice.beats[0]!.isRest

/**
 * Paste at the cursor. Bars insert as new bars after the cursor's bar (every
 * track gets the bar; this track gets the content). Beats insert before the
 * cursor's beat - or replace it when the bar is still a single empty rest.
 */
export function paste(
  score: Score,
  c: EditCursor,
  clip: Clipboard,
  settings: Settings,
): EditCursor {
  if (clip.kind === 'bars') {
    let at = c.bar
    for (const bar of clip.bars) {
      at = insertBar(score, at, settings)
      const voice = voiceAt(score, { ...c, bar: at })!
      voice.beats.length = 0
      for (const b of bar) voice.addBeat(copyBeat(b))
    }
    relink(score)
    refresh(score, settings)
    return clampCursor(score, { ...c, bar: c.bar + 1, beat: 0 })
  }
  const voice = voiceAt(score, c)
  if (!voice) return c
  const copies = clip.beats.map(copyBeat)
  if (isEmptyBar(voice)) voice.beats.splice(0, 1, ...copies)
  else voice.beats.splice(c.beat, 0, ...copies)
  for (const b of copies) b.voice = voice
  relink(score)
  refresh(score, settings)
  return clampCursor(score, { ...c, beat: c.beat + copies.length - (isEmptyBar(voice) ? 1 : 0) })
}

// ── Batch operations on a range ──────────────────────────────────────────

export function transposeRange(
  score: Score,
  c: EditCursor,
  refs: BeatRef[],
  semitones: number,
  settings: Settings,
): void {
  for (const r of refs) {
    for (const note of beatAt(score, { ...c, ...r })?.notes ?? []) {
      if (note.isPercussion) continue
      note.fret = Math.min(30, Math.max(0, note.fret + semitones))
    }
  }
  refresh(score, settings)
}

export function setRangeDuration(
  score: Score,
  c: EditCursor,
  refs: BeatRef[],
  duration: model.Duration,
  settings: Settings,
): void {
  for (const r of refs) {
    const beat = beatAt(score, { ...c, ...r })
    if (beat) beat.duration = duration
  }
  refresh(score, settings)
}

/**
 * Move every note to the neighbouring string (+1 = higher string) keeping its
 * pitch: the fret shifts by the tuning interval. Notes that would need a
 * negative fret, or whose target string is taken, stay put.
 */
export function moveRangeString(
  score: Score,
  c: EditCursor,
  refs: BeatRef[],
  dir: 1 | -1,
  settings: Settings,
): void {
  const staff = score.tracks[c.track]?.staves[c.staff]
  if (!staff || staff.isPercussion) return
  const tunings = staff.stringTuning.tunings
  const n = tunings.length
  // alphaTab tunings list the highest string first; string 1 is the lowest.
  const pitchOf = (s: number) => tunings[n - s]!
  for (const r of refs) {
    const beat = beatAt(score, { ...c, ...r })
    if (!beat) continue
    const order = [...beat.notes].sort((a, b) =>
      dir > 0 ? b.string - a.string : a.string - b.string,
    )
    for (const note of order) {
      const target = note.string + dir
      if (target < 1 || target > n || beat.hasNoteOnString(target)) continue
      const fret = note.fret + pitchOf(note.string) - pitchOf(target)
      if (fret < 0 || fret > 30) continue
      note.string = target
      note.fret = fret
    }
  }
  refresh(score, settings)
}

// ── Song + tracks ────────────────────────────────────────────────────────

export interface SongInfo {
  title: string
  subTitle: string
  artist: string
  album: string
  music: string
  tab: string
}

export function setSongInfo(score: Score, info: Partial<SongInfo>, settings: Settings): void {
  Object.assign(score, info)
  refresh(score, settings)
}

export interface InstrumentPreset {
  id: string
  label: string
  program: number
  /** MIDI pitches, highest string first (alphaTab order); empty for drums. */
  tunings: number[]
  percussion?: boolean
}

export const INSTRUMENTS: InstrumentPreset[] = [
  {
    id: 'guitar-dist',
    label: 'Electric guitar (distortion)',
    program: 30,
    tunings: [64, 59, 55, 50, 45, 40],
  },
  {
    id: 'guitar-over',
    label: 'Electric guitar (overdrive)',
    program: 29,
    tunings: [64, 59, 55, 50, 45, 40],
  },
  {
    id: 'guitar-clean',
    label: 'Electric guitar (clean)',
    program: 27,
    tunings: [64, 59, 55, 50, 45, 40],
  },
  {
    id: 'guitar-ac',
    label: 'Acoustic guitar (steel)',
    program: 25,
    tunings: [64, 59, 55, 50, 45, 40],
  },
  { id: 'guitar-7', label: '7-string guitar', program: 30, tunings: [64, 59, 55, 50, 45, 40, 35] },
  { id: 'bass-4', label: 'Bass (4 strings)', program: 33, tunings: [43, 38, 33, 28] },
  { id: 'bass-5', label: 'Bass (5 strings)', program: 33, tunings: [43, 38, 33, 28, 23] },
  { id: 'drums', label: 'Drums', program: 0, tunings: [], percussion: true },
  { id: 'piano', label: 'Piano', program: 0, tunings: [] },
]

/** Common GM programs for the instrument picker. */
export const PROGRAMS: { program: number; label: string }[] = [
  { program: 24, label: 'Nylon guitar' },
  { program: 25, label: 'Steel guitar' },
  { program: 26, label: 'Jazz guitar' },
  { program: 27, label: 'Clean guitar' },
  { program: 28, label: 'Muted guitar' },
  { program: 29, label: 'Overdriven guitar' },
  { program: 30, label: 'Distortion guitar' },
  { program: 31, label: 'Guitar harmonics' },
  { program: 32, label: 'Acoustic bass' },
  { program: 33, label: 'Finger bass' },
  { program: 34, label: 'Pick bass' },
  { program: 35, label: 'Fretless bass' },
  { program: 0, label: 'Piano' },
  { program: 48, label: 'Strings' },
  { program: 81, label: 'Saw lead' },
]

function freeChannels(score: Score): [number, number] {
  const used = new Set(
    score.tracks.flatMap((t) => [t.playbackInfo.primaryChannel, t.playbackInfo.secondaryChannel]),
  )
  const free: number[] = []
  for (let ch = 0; ch < 16 && free.length < 2; ch++) if (ch !== 9 && !used.has(ch)) free.push(ch)
  return [free[0] ?? 0, free[1] ?? free[0] ?? 1]
}

/** Append a track with empty bars matching the score. Returns its index. */
export function addTrack(
  score: Score,
  preset: InstrumentPreset,
  name: string,
  settings: Settings,
): number {
  const track = new model.Track()
  track.name = name || preset.label
  track.shortName = track.name.slice(0, 5)
  track.playbackInfo.program = preset.program
  if (preset.percussion) {
    track.playbackInfo.primaryChannel = 9
    track.playbackInfo.secondaryChannel = 9
  } else {
    ;[track.playbackInfo.primaryChannel, track.playbackInfo.secondaryChannel] = freeChannels(score)
  }
  score.addTrack(track)
  track.ensureStaveCount(1)
  const staff = track.staves[0]!
  if (preset.percussion) {
    staff.isPercussion = true
    staff.showTablature = false
    staff.showStandardNotation = true
  } else if (preset.tunings.length) {
    staff.stringTuning.tunings = [...preset.tunings]
    staff.showTablature = true
  } else {
    staff.showTablature = false
    staff.showStandardNotation = true
  }
  for (let i = 0; i < score.masterBars.length; i++) {
    const bar = new model.Bar()
    staff.addBar(bar)
    const voice = new model.Voice()
    bar.addVoice(voice)
    const rest = new model.Beat()
    rest.duration = model.Duration.Whole
    voice.addBeat(rest)
  }
  relink(score)
  refresh(score, settings)
  return score.tracks.length - 1
}

export function removeTrack(score: Score, index: number, settings: Settings): void {
  if (score.tracks.length <= 1 || index < 0 || index >= score.tracks.length) return
  score.tracks.splice(index, 1)
  score.tracks.forEach((t, i) => {
    t.index = i
  })
  refresh(score, settings)
}

/** Move a track to another position in the track list. */
export function moveTrack(score: Score, from: number, to: number, settings: Settings): void {
  const n = score.tracks.length
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return
  const [track] = score.tracks.splice(from, 1)
  score.tracks.splice(to, 0, track!)
  score.tracks.forEach((t, i) => {
    t.index = i
  })
  refresh(score, settings)
}

/** Copy a track (notes, tuning, capo, sound) right after itself. Returns the copy's index. */
export function duplicateTrack(score: Score, index: number, settings: Settings): number {
  const src = score.tracks[index]
  if (!src) return index
  const srcStaff = src.staves[0]!
  const at = addTrack(
    score,
    {
      id: 'copy',
      label: `${src.name} (copy)`,
      program: src.playbackInfo.program,
      tunings: [...srcStaff.stringTuning.tunings],
      percussion: srcStaff.isPercussion,
    },
    `${src.name} (copy)`,
    settings,
  )
  const copy = score.tracks[at]!
  const staff = copy.staves[0]!
  staff.capo = srcStaff.capo
  staff.showTablature = srcStaff.showTablature
  staff.showStandardNotation = srcStaff.showStandardNotation
  copy.playbackInfo.volume = src.playbackInfo.volume
  copy.playbackInfo.balance = src.playbackInfo.balance
  copy.percussionArticulations = [...src.percussionArticulations]
  srcStaff.bars.forEach((bar, b) => {
    const dst = staff.bars[b]!
    bar.voices.forEach((voice, v) => {
      let target = dst.voices[v]
      if (!target) {
        target = new model.Voice()
        dst.addVoice(target)
      }
      target.beats.length = 0
      for (const beat of voice.beats) target.addBeat(copyBeat(beat))
    })
  })
  // Place it right after the original.
  score.tracks.splice(at, 1)
  score.tracks.splice(index + 1, 0, copy)
  score.tracks.forEach((t, i) => {
    t.index = i
  })
  relink(score)
  refresh(score, settings)
  return index + 1
}

/** Mix volume (0..16, alphaTab/GP scale) and pan (0..16, 8 = centre), saved with the file. */
export function setTrackMix(
  score: Score,
  index: number,
  mix: { volume?: number; balance?: number },
  _settings?: Settings,
): void {
  const t = score.tracks[index]
  if (!t) return
  if (mix.volume !== undefined)
    t.playbackInfo.volume = Math.min(16, Math.max(0, Math.round(mix.volume)))
  if (mix.balance !== undefined)
    t.playbackInfo.balance = Math.min(16, Math.max(0, Math.round(mix.balance)))
}

export function renameTrack(score: Score, index: number, name: string, settings: Settings): void {
  const t = score.tracks[index]
  if (!t || !name.trim()) return
  t.name = name.trim()
  t.shortName = t.name.slice(0, 5)
  refresh(score, settings)
}

/**
 * Retune a track. Notes on strings the new tuning no longer has are removed;
 * frets keep their numbers (as Guitar Pro does - the sound follows the tuning).
 */
export function setTuning(
  score: Score,
  trackIndex: number,
  tunings: number[],
  settings: Settings,
): void {
  const staff = score.tracks[trackIndex]?.staves[0]
  if (!staff || staff.isPercussion || tunings.length < 1) return
  staff.stringTuning.tunings = [...tunings]
  const n = tunings.length
  for (const bar of staff.bars) {
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        for (const note of [...beat.notes]) if (note.string > n) beat.removeNote(note)
      }
    }
  }
  refresh(score, settings)
}

export function setCapo(score: Score, trackIndex: number, capo: number, settings: Settings): void {
  const staff = score.tracks[trackIndex]?.staves[0]
  if (!staff) return
  staff.capo = Math.min(24, Math.max(0, Math.round(capo)))
  refresh(score, settings)
}

export function setProgram(
  score: Score,
  trackIndex: number,
  program: number,
  _settings?: Settings,
): void {
  const t = score.tracks[trackIndex]
  if (!t) return
  t.playbackInfo.program = Math.min(127, Math.max(0, Math.round(program)))
}

export function tuningLabel(tunings: number[]): string {
  return tunings
    .map((p) => model.Tuning.getTextForTuning(p, false))
    .reverse()
    .join(' ')
}

/** Named tuning presets for a string count (alphaTab's own table). */
export function tuningPresets(strings: number): { name: string; tunings: number[] }[] {
  return model.Tuning.getPresetsFor(strings).map((t) => ({ name: t.name, tunings: [...t.tunings] }))
}

export interface NewSongOptions {
  title: string
  artist: string
  tempo: number
  numerator: number
  denominator: number
  bars: number
  instrument: InstrumentPreset
}

const escapeTex = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

/** AlphaTex for a new, empty song (parsed by the normal import path). */
export function newSongTex(o: NewSongOptions): string {
  const bars = Array.from({ length: Math.max(1, Math.min(512, o.bars)) }, () => 'r.1').join(' | ')
  const lines = [
    `\\title "${escapeTex(o.title || 'Untitled')}"`,
    ...(o.artist ? [`\\artist "${escapeTex(o.artist)}"`] : []),
    `\\tempo ${Math.round(Math.min(400, Math.max(20, o.tempo)))}`,
    `\\track "${escapeTex(o.instrument.label)}" { instrument ${o.instrument.program} }`,
  ]
  if (o.instrument.percussion) {
    lines.push('\\staff {score}', '\\instrument percussion')
  } else if (o.instrument.tunings.length) {
    const names = o.instrument.tunings.map((p) => model.Tuning.getTextForTuning(p, true))
    lines.push('\\staff {score tabs}', `\\tuning (${names.join(' ')})`)
  } else {
    lines.push('\\staff {score}')
  }
  lines.push(`\\ts (${o.numerator} ${o.denominator})`, bars)
  return lines.join('\n')
}

// ── Notation tools ───────────────────────────────────────────────────────

export type BendPreset =
  'none' | 'half' | 'full' | 'oneHalf' | 'bendRelease' | 'preBend' | 'preBendRelease'

export const BEND_PRESETS: { id: BendPreset; label: string }[] = [
  { id: 'half', label: '½' },
  { id: 'full', label: 'full' },
  { id: 'oneHalf', label: '1½' },
  { id: 'bendRelease', label: 'bend+rel.' },
  { id: 'preBend', label: 'pre-bend' },
  { id: 'preBendRelease', label: 'pre+rel.' },
  { id: 'none', label: 'none' },
]

/** Bend values are quarter tones; offsets 0..60 span the note. */
export function setBend(score: Score, c: EditCursor, preset: BendPreset, settings: Settings): void {
  const note = noteAt(score, c)
  if (!note) return
  note.bendPoints = null
  const pts: [number, number][] = {
    none: [],
    half: [
      [0, 0],
      [30, 2],
      [60, 2],
    ],
    full: [
      [0, 0],
      [30, 4],
      [60, 4],
    ],
    oneHalf: [
      [0, 0],
      [30, 6],
      [60, 6],
    ],
    bendRelease: [
      [0, 0],
      [20, 4],
      [40, 4],
      [60, 0],
    ],
    preBend: [
      [0, 4],
      [60, 4],
    ],
    preBendRelease: [
      [0, 4],
      [30, 4],
      [60, 0],
    ],
  }[preset] as [number, number][]
  const type: Record<BendPreset, model.BendType> = {
    none: model.BendType.None,
    half: model.BendType.Bend,
    full: model.BendType.Bend,
    oneHalf: model.BendType.Bend,
    bendRelease: model.BendType.BendRelease,
    preBend: model.BendType.Prebend,
    preBendRelease: model.BendType.PrebendRelease,
  }
  note.bendType = type[preset]
  for (const [offset, value] of pts) note.addBendPoint(new model.BendPoint(offset, value))
  refresh(score, settings)
}

export type SlideKind = 'none' | 'shift' | 'legato' | 'outDown' | 'outUp' | 'inBelow' | 'inAbove'

export const SLIDES: { id: SlideKind; label: string; title: string }[] = [
  { id: 'shift', label: '/', title: 'Shift slide to next note' },
  { id: 'legato', label: '⁀/', title: 'Legato slide to next note' },
  { id: 'outDown', label: '↘', title: 'Slide out downwards' },
  { id: 'outUp', label: '↗', title: 'Slide out upwards' },
  { id: 'inBelow', label: '↗•', title: 'Slide in from below' },
  { id: 'inAbove', label: '↘•', title: 'Slide in from above' },
  { id: 'none', label: 'no slide', title: 'Remove slides' },
]

export function setSlide(score: Score, c: EditCursor, kind: SlideKind, settings: Settings): void {
  const note = noteAt(score, c)
  if (!note) return
  const out: Partial<Record<SlideKind, model.SlideOutType>> = {
    shift: model.SlideOutType.Shift,
    legato: model.SlideOutType.Legato,
    outDown: model.SlideOutType.OutDown,
    outUp: model.SlideOutType.OutUp,
  }
  if (kind === 'none') {
    note.slideOutType = model.SlideOutType.None
    note.slideInType = model.SlideInType.None
  } else if (kind === 'inBelow') note.slideInType = model.SlideInType.IntoFromBelow
  else if (kind === 'inAbove') note.slideInType = model.SlideInType.IntoFromAbove
  else note.slideOutType = out[kind]!
  refresh(score, settings)
}

/** Tremolo picking: 0 = off, 1..3 = eighths/sixteenths/thirty-seconds. */
export function setTremolo(score: Score, c: EditCursor, marks: number, settings: Settings): void {
  const beat = beatAt(score, c)
  if (!beat) return
  if (marks <= 0) {
    delete (beat as { tremoloPicking?: unknown }).tremoloPicking
  } else {
    const t = new model.TremoloPickingEffect()
    t.marks = Math.min(3, marks)
    beat.tremoloPicking = t
  }
  refresh(score, settings)
}

/** Trill to `fret` on the same string (null = off), in sixteenths. */
export function setTrill(
  score: Score,
  c: EditCursor,
  fret: number | null,
  settings: Settings,
): void {
  const note = noteAt(score, c)
  if (!note) return
  if (fret === null || fret < 0) {
    note.trillValue = -1
  } else {
    // trillValue is the absolute MIDI value of the trilled note.
    note.trillValue = note.realValue - note.fret + fret
    note.trillSpeed = model.Duration.Sixteenth
  }
  refresh(score, settings)
}

/** Insert a grace note (on the cursor's string, `fret`) before the cursor's beat. */
export function addGraceNote(
  score: Score,
  c: EditCursor,
  fret: number,
  settings: Settings,
): EditCursor {
  const voice = voiceAt(score, c)
  if (!voice) return c
  const grace = new model.Beat()
  grace.graceType = model.GraceType.BeforeBeat
  grace.duration = model.Duration.ThirtySecond
  const note = new model.Note()
  note.string = c.string
  note.fret = Math.min(30, Math.max(0, fret))
  grace.addNote(note)
  voice.beats.splice(c.beat, 0, grace)
  grace.voice = voice
  relink(score)
  refresh(score, settings)
  return { ...c, beat: c.beat + 1 }
}

/** Name a chord on the beat; the diagram is taken from the beat's own frets. */
export function setChord(
  score: Score,
  c: EditCursor,
  name: string | null,
  settings: Settings,
): void {
  const beat = beatAt(score, c)
  const staff = score.tracks[c.track]?.staves[c.staff]
  if (!beat || !staff) return
  if (!name?.trim()) {
    beat.chordId = null
    refresh(score, settings)
    return
  }
  const n = stringCount(score, c)
  const chord = new model.Chord()
  chord.name = name.trim()
  // Chord.strings is highest string first; -1 = not played.
  chord.strings = Array.from({ length: n }, (_, i) => beat.getNoteOnString(n - i)?.fret ?? -1)
  const fretted = chord.strings.filter((f) => f > 0)
  chord.firstFret = fretted.length ? Math.max(1, Math.min(...fretted)) : 1
  chord.showDiagram = beat.notes.length > 1
  chord.showName = true
  const id = `oa-${c.bar}-${c.beat}-${chord.name}`
  staff.addChord(id, chord)
  beat.chordId = id
  refresh(score, settings)
}

export function setSection(
  score: Score,
  bar: number,
  text: string | null,
  settings: Settings,
): void {
  const mb = score.masterBars[bar]
  if (!mb) return
  if (!text?.trim()) {
    mb.section = null
  } else {
    const s = new model.Section()
    const letters = score.masterBars.filter((m, i) => m.section && i < bar).length
    s.marker = String.fromCharCode(65 + (letters % 26))
    s.text = text.trim()
    mb.section = s
  }
  refresh(score, settings)
}

export function setBeatText(
  score: Score,
  c: EditCursor,
  text: string | null,
  settings: Settings,
): void {
  const beat = beatAt(score, c)
  if (!beat) return
  beat.text = text?.trim() ? text.trim() : null
  refresh(score, settings)
}

export function setLyric(
  score: Score,
  c: EditCursor,
  text: string | null,
  settings: Settings,
): void {
  const beat = beatAt(score, c)
  if (!beat) return
  beat.lyrics = text?.trim() ? [text.trim()] : null
  refresh(score, settings)
}

export const DYNAMICS = ['PPP', 'PP', 'P', 'MP', 'MF', 'F', 'FF', 'FFF'] as const

export function setDynamics(
  score: Score,
  c: EditCursor,
  dyn: (typeof DYNAMICS)[number],
  settings: Settings,
): void {
  const beat = beatAt(score, c)
  if (!beat) return
  beat.dynamics = model.DynamicValue[dyn]
  for (const n of beat.notes) n.dynamics = model.DynamicValue[dyn]
  refresh(score, settings)
}

// ── Voices ───────────────────────────────────────────────────────────────

/** Make sure every bar of the cursor's staff has `voice` (filled with whole rests). */
export function ensureVoice(
  score: Score,
  c: EditCursor,
  voice: number,
  settings: Settings,
): EditCursor {
  const staff = score.tracks[c.track]?.staves[c.staff]
  if (!staff || voice < 0 || voice > 3) return c
  let changed = false
  for (const bar of staff.bars) {
    while (bar.voices.length <= voice) {
      const v = new model.Voice()
      bar.addVoice(v)
      const rest = new model.Beat()
      rest.duration = model.Duration.Whole
      v.addBeat(rest)
      changed = true
    }
  }
  if (changed) {
    relink(score)
    refresh(score, settings)
  }
  return clampCursor(score, { ...c, voice, beat: 0 })
}

// ── Drums ────────────────────────────────────────────────────────────────

/** GP7 percussion articulation ids (see alphaTab's Note.percussionArticulation). */
export const DRUM_KIT: { id: number; label: string }[] = [
  { id: 49, label: 'Crash' },
  { id: 51, label: 'Ride' },
  { id: 46, label: 'Hi-hat open' },
  { id: 42, label: 'Hi-hat closed' },
  { id: 44, label: 'Hi-hat pedal' },
  { id: 48, label: 'High tom' },
  { id: 47, label: 'Mid tom' },
  { id: 45, label: 'Low tom' },
  { id: 41, label: 'Floor tom' },
  { id: 38, label: 'Snare' },
  { id: 37, label: 'Side stick' },
  { id: 36, label: 'Kick' },
]

let defaultKit: model.InstrumentArticulation[] | null = null

/**
 * alphaTab's default GP7 drum articulation table. It isn't exported, so get it
 * the way a .gp import does: round-trip an empty drum track once.
 */
function defaultArticulations(settings: Settings): model.InstrumentArticulation[] {
  if (defaultKit) return defaultKit
  const score = new model.Score()
  const mb = new model.MasterBar()
  score.addMasterBar(mb)
  const track = new model.Track()
  track.playbackInfo.primaryChannel = 9
  track.playbackInfo.secondaryChannel = 9
  score.addTrack(track)
  track.ensureStaveCount(1)
  track.staves[0]!.isPercussion = true
  const bar = new model.Bar()
  track.staves[0]!.addBar(bar)
  const voice = new model.Voice()
  bar.addVoice(voice)
  const beat = new model.Beat()
  beat.duration = model.Duration.Whole
  voice.addBeat(beat)
  score.finish(settings)
  const bytes = new exporter.Gp7Exporter().export(score, settings)
  defaultKit = importer.ScoreLoader.loadScoreFromBytes(bytes, settings).tracks[0]!
    .percussionArticulations
  return defaultKit
}

/**
 * Warm up the default GP7 drum kit table before building a new score from
 * scratch (loading the template resets alphaTab's global Bar/Voice/Beat IDs).
 */
export function ensureDrumKit(settings: Settings): void {
  defaultArticulations(settings)
}

/**
 * The GP7 articulation id of a drum note. With a track articulation table the
 * note holds an index into it; without one it holds the id itself.
 */
export function drumId(track: model.Track, note: model.Note): number {
  const table = track.percussionArticulations
  return table.length ? (table[note.percussionArticulation]?.id ?? -1) : note.percussionArticulation
}

/**
 * Store a drum hit the way .gp files do: register the articulation on the
 * track and keep its index. A bare id would be re-read as an index after a
 * save, turning a kick into whatever sits at that slot.
 */
export function drumIndex(track: model.Track, id: number, settings: Settings): number {
  if (!track.percussionArticulations.length) {
    // Convert any hits stored as bare ids before the table exists.
    const pending: model.Note[] = []
    for (const staff of track.staves)
      for (const bar of staff.bars)
        for (const v of bar.voices) for (const b of v.beats) pending.push(...b.notes)
    const ids = pending.map((n) => n.percussionArticulation)
    const kit = defaultArticulations(settings)
    pending.forEach((n, i) => {
      const a = kit.find((k) => k.id === ids[i])
      n.percussionArticulation = a ? track.getOrRegisterPercussionArticulation(a) : 0
    })
  }
  const articulation = defaultArticulations(settings).find((a) => a.id === id)
  if (!articulation) return id
  return track.getOrRegisterPercussionArticulation(articulation)
}

export function isPercussion(score: Score, c: EditCursor): boolean {
  return !!score.tracks[c.track]?.staves[c.staff]?.isPercussion
}

/** Toggle one drum hit on a beat; returns whether it is now on. */
export function toggleDrumHit(
  score: Score,
  c: EditCursor,
  beatIndex: number,
  id: number,
  settings: Settings,
): boolean {
  const beat = beatAt(score, { ...c, beat: beatIndex })
  const track = score.tracks[c.track]
  if (!beat || !track) return false
  const existing = beat.notes.find((n) => drumId(track, n) === id)
  if (existing) {
    beat.removeNote(existing)
  } else {
    const note = new model.Note()
    note.percussionArticulation = drumIndex(track, id, settings)
    beat.addNote(note)
  }
  refresh(score, settings)
  return !existing
}

/**
 * Re-grid the cursor's bar into equal steps of `duration` (e.g. 16 sixteenths
 * in 4/4) for the drum lane. Hits on beats that start exactly on a step keep
 * their place; everything else is dropped.
 */
export function setBarGrid(
  score: Score,
  c: EditCursor,
  duration: model.Duration,
  settings: Settings,
): void {
  const voice = voiceAt(score, c)
  const mb = score.masterBars[c.bar]
  if (!voice || !mb) return
  const step = 3840 / duration // ticks: a whole note is 3840
  const steps = Math.max(1, Math.round(mb.calculateDuration(false) / step))
  const hits = new Map<number, model.Note[]>()
  for (const b of voice.beats) {
    if (b.playbackStart % step === 0) hits.set(b.playbackStart / step, b.notes)
  }
  voice.beats.length = 0
  for (let i = 0; i < steps; i++) {
    const beat = new model.Beat()
    beat.duration = duration
    for (const n of hits.get(i) ?? []) {
      const copy = new model.Note()
      copy.percussionArticulation = n.percussionArticulation
      copy.string = n.string
      copy.fret = n.fret
      beat.addNote(copy)
    }
    voice.addBeat(beat)
  }
  relink(score)
  refresh(score, settings)
}

// ── Multi-bar operations (issue #459) ────────────────────────────────────

/** The bars a selection covers (or the cursor's bar), first to last. */
export function barSpan(c: EditCursor, refs: readonly BeatRef[]): [number, number] {
  if (refs.length < 2) return [c.bar, c.bar]
  const bars = refs.map((r) => r.bar)
  return [Math.min(...bars), Math.max(...bars)]
}

/** Insert `count` empty bars after `after`. Returns the first new bar's index. */
export function insertBars(score: Score, after: number, count: number, settings: Settings): number {
  const n = Math.min(64, Math.max(1, Math.round(count)))
  const first = insertBar(score, after, settings)
  for (let i = 1; i < n; i++) insertBar(score, first + i - 1, settings)
  return first
}

/** Delete bars `from`..`to` in every track (at least one bar stays). */
export function deleteBars(score: Score, from: number, to: number, settings: Settings): void {
  const a = Math.max(0, Math.min(from, to))
  const b = Math.min(score.masterBars.length - 1, Math.max(from, to))
  const count = Math.min(b - a + 1, score.masterBars.length - 1)
  if (count <= 0) return
  score.masterBars.splice(a, count)
  for (const track of score.tracks) for (const staff of track.staves) staff.bars.splice(a, count)
  relink(score)
  refresh(score, settings)
}

/**
 * Change the time signature from bar `from` on, Guitar-Pro style: every
 * following bar that shared the old signature changes too, up to the next
 * bar that had a signature of its own.
 */
export function setTimeSignatureFrom(
  score: Score,
  from: number,
  num: number,
  den: number,
  settings: Settings,
): void {
  const start = score.masterBars[from]
  if (!start) return
  const oldNum = start.timeSignatureNumerator
  const oldDen = start.timeSignatureDenominator
  const n = Math.min(32, Math.max(1, Math.round(num)))
  const d = [1, 2, 4, 8, 16, 32].includes(den) ? den : 4
  for (let i = from; i < score.masterBars.length; i++) {
    const mb = score.masterBars[i]!
    if (
      i > from &&
      (mb.timeSignatureNumerator !== oldNum || mb.timeSignatureDenominator !== oldDen)
    )
      break
    mb.timeSignatureNumerator = n
    mb.timeSignatureDenominator = d
    mb.timeSignatureCommon = false
  }
  refresh(score, settings)
}

/** Repeat bars `from`..`to` so they play `times` times in all (1 removes the repeat). */
export function setRepeat(
  score: Score,
  from: number,
  to: number,
  times: number,
  settings: Settings,
): void {
  const a = score.masterBars[Math.min(from, to)]
  const b = score.masterBars[Math.max(from, to)]
  if (!a || !b) return
  const n = Math.min(16, Math.max(1, Math.round(times)))
  a.isRepeatStart = n > 1
  b.repeatCount = n > 1 ? n : 0
  refresh(score, settings)
}

/**
 * Move bars `from`..`to` (every track, with their bar settings) by `delta`
 * bars. Returns the block's new first index.
 */
export function moveBars(
  score: Score,
  from: number,
  to: number,
  delta: number,
  settings: Settings,
): number {
  const a = Math.min(from, to)
  const count = Math.abs(to - from) + 1
  const dest = Math.min(score.masterBars.length - count, Math.max(0, a + delta))
  if (dest === a) return a
  const block = <T>(arr: T[]) => {
    const taken = arr.splice(a, count)
    arr.splice(dest, 0, ...taken)
  }
  block(score.masterBars)
  for (const track of score.tracks) for (const staff of track.staves) block(staff.bars)
  relink(score)
  refresh(score, settings)
  return dest
}

/**
 * Write a chord voicing into the cursor's beat (replacing its notes) and
 * label it: `frets` is lowest string first, -1 = not played.
 */
export function insertVoicing(
  score: Score,
  c: EditCursor,
  frets: readonly number[],
  name: string,
  settings: Settings,
): void {
  const beat = beatAt(score, c)
  if (!beat || frets.length !== stringCount(score, c)) return
  for (const n of [...beat.notes]) beat.removeNote(n)
  frets.forEach((f, i) => {
    if (f < 0) return
    const note = new model.Note()
    note.string = i + 1
    note.fret = f
    beat.addNote(note)
  })
  beat.isEmpty = beat.notes.length === 0
  setChord(score, c, name, settings)
}

/** Show the song's chord diagrams in a strip at the top of the sheet. */
export function setChordStrip(score: Score, on: boolean, settings: Settings): void {
  score.stylesheet.globalDisplayChordDiagramsOnTop = on
  refresh(score, settings)
}

// ── More techniques (issue #459) ─────────────────────────────────────────

export const HARMONICS: { type: model.HarmonicType; label: string; title: string }[] = [
  { type: model.HarmonicType.Natural, label: 'N.H.', title: 'Natural harmonic' },
  { type: model.HarmonicType.Pinch, label: 'P.H.', title: 'Pinch harmonic' },
  { type: model.HarmonicType.Artificial, label: 'A.H.', title: 'Artificial harmonic (+12)' },
  { type: model.HarmonicType.Tap, label: 'T.H.', title: 'Tapped harmonic (+12)' },
  { type: model.HarmonicType.Semi, label: 'S.H.', title: 'Semi-harmonic' },
]

/** Set (or clear, when it's already that type) a harmonic on the cursor's note. */
export function setHarmonic(
  score: Score,
  c: EditCursor,
  type: model.HarmonicType,
  settings: Settings,
): void {
  const note = noteAt(score, c)
  if (!note) return
  if (note.harmonicType === type) {
    note.harmonicType = model.HarmonicType.None
    note.harmonicValue = 0
  } else {
    note.harmonicType = type
    // Natural: the fret itself; the others sound an octave over the fretted note.
    note.harmonicValue =
      type === model.HarmonicType.Natural ? note.fret : type === model.HarmonicType.Semi ? 0 : 12
  }
  refresh(score, settings)
}

export type WhammyPreset = 'none' | 'dive' | 'dip' | 'diveReturn' | 'predive'

export const WHAMMY_PRESETS: { id: WhammyPreset; label: string; title: string }[] = [
  { id: 'dive', label: 'dive', title: 'Whammy dive (down a whole tone... and more)' },
  { id: 'dip', label: 'dip', title: 'Whammy dip (down and back)' },
  { id: 'diveReturn', label: 'd+r', title: 'Dive and return' },
  { id: 'predive', label: 'pre', title: 'Pre-dive (starts down, returns)' },
]

/** Whammy bar on the cursor's beat. Values are quarter tones (negative = down); offsets 0..60. */
export function setWhammy(
  score: Score,
  c: EditCursor,
  preset: WhammyPreset,
  settings: Settings,
): void {
  const beat = beatAt(score, c)
  if (!beat) return
  beat.whammyBarPoints = null
  const shape: Record<WhammyPreset, [model.WhammyType, [number, number][]]> = {
    none: [model.WhammyType.None, []],
    dive: [
      model.WhammyType.Dive,
      [
        [0, 0],
        [45, -8],
        [60, -8],
      ],
    ],
    dip: [
      model.WhammyType.Dip,
      [
        [0, 0],
        [15, -4],
        [30, 0],
      ],
    ],
    diveReturn: [
      model.WhammyType.Dive,
      [
        [0, 0],
        [30, -8],
        [60, 0],
      ],
    ],
    predive: [
      model.WhammyType.Predive,
      [
        [0, -4],
        [60, 0],
      ],
    ],
  }
  const [type, pts] = shape[preset]
  beat.whammyBarType = type
  for (const [offset, value] of pts) beat.addWhammyBarPoint(new model.BendPoint(offset, value))
  refresh(score, settings)
}

/** Left-hand finger for the cursor's note (Fingers.Unknown clears it). */
export function setFinger(
  score: Score,
  c: EditCursor,
  finger: model.Fingers,
  settings: Settings,
): void {
  const note = noteAt(score, c)
  if (!note) return
  note.leftHandFinger = note.leftHandFinger === finger ? model.Fingers.Unknown : finger
  refresh(score, settings)
}

/** Fade in / fade out / volume swell on the cursor's beat (same again clears it). */
export function setFade(
  score: Score,
  c: EditCursor,
  fade: model.FadeType,
  settings: Settings,
): void {
  const beat = beatAt(score, c)
  if (!beat) return
  beat.fade = beat.fade === fade ? model.FadeType.None : fade
  refresh(score, settings)
}

export const RASGUEADOS: { type: model.Rasgueado; label: string }[] = [
  { type: model.Rasgueado.Ii, label: 'ii' },
  { type: model.Rasgueado.Mi, label: 'mi' },
  { type: model.Rasgueado.MiiTriplet, label: 'mii (triplet)' },
  { type: model.Rasgueado.PmpTriplet, label: 'pmp (triplet)' },
  { type: model.Rasgueado.AmiTriplet, label: 'ami (triplet)' },
  { type: model.Rasgueado.Ppp, label: 'ppp' },
]

export function setRasgueado(
  score: Score,
  c: EditCursor,
  type: model.Rasgueado,
  settings: Settings,
): void {
  const beat = beatAt(score, c)
  if (!beat) return
  beat.rasgueado = type
  refresh(score, settings)
}

// ── Find & replace (issue #459) ──────────────────────────────────────────

export type Technique =
  | 'palmMute'
  | 'letRing'
  | 'hammer'
  | 'slide'
  | 'bend'
  | 'vibrato'
  | 'harmonic'
  | 'dead'
  | 'ghost'
  | 'tie'
  | 'staccato'
  | 'accent'

export const TECHNIQUES: { id: Technique; label: string }[] = [
  { id: 'palmMute', label: 'palm mute' },
  { id: 'letRing', label: 'let ring' },
  { id: 'hammer', label: 'hammer-on / pull-off' },
  { id: 'slide', label: 'slide' },
  { id: 'bend', label: 'bend' },
  { id: 'vibrato', label: 'vibrato' },
  { id: 'harmonic', label: 'harmonic' },
  { id: 'dead', label: 'dead note' },
  { id: 'ghost', label: 'ghost note' },
  { id: 'tie', label: 'tie' },
  { id: 'staccato', label: 'staccato' },
  { id: 'accent', label: 'accent' },
]

function hasTechnique(n: model.Note, t: Technique): boolean {
  switch (t) {
    case 'palmMute':
      return n.isPalmMute
    case 'letRing':
      return n.isLetRing
    case 'hammer':
      return n.isHammerPullOrigin
    case 'slide':
      return n.slideOutType !== model.SlideOutType.None || n.slideInType !== model.SlideInType.None
    case 'bend':
      return n.hasBend
    case 'vibrato':
      return n.vibrato !== model.VibratoType.None
    case 'harmonic':
      return n.harmonicType !== model.HarmonicType.None
    case 'dead':
      return n.isDead
    case 'ghost':
      return n.isGhost
    case 'tie':
      return n.isTieDestination
    case 'staccato':
      return n.isStaccato
    case 'accent':
      return n.accentuated !== model.AccentuationType.None
  }
}

function clearTechnique(n: model.Note, t: Technique): void {
  switch (t) {
    case 'palmMute':
      n.isPalmMute = false
      break
    case 'letRing':
      n.isLetRing = false
      break
    case 'hammer':
      n.isHammerPullOrigin = false
      break
    case 'slide':
      n.slideOutType = model.SlideOutType.None
      n.slideInType = model.SlideInType.None
      break
    case 'bend':
      n.bendType = model.BendType.None
      n.bendPoints = null
      break
    case 'vibrato':
      n.vibrato = model.VibratoType.None
      break
    case 'harmonic':
      n.harmonicType = model.HarmonicType.None
      n.harmonicValue = 0
      break
    case 'dead':
      n.isDead = false
      break
    case 'ghost':
      n.isGhost = false
      break
    case 'tie':
      n.isTieDestination = false
      break
    case 'staccato':
      n.isStaccato = false
      break
    case 'accent':
      n.accentuated = model.AccentuationType.None
      break
  }
}

/** What to look for; unset fields match anything. */
export interface FindQuery {
  fret?: number | null
  /** alphaTab string number (1 = lowest). */
  string?: number | null
  technique?: Technique | null
  duration?: model.Duration | null
}

export interface NoteRef {
  bar: number
  voice: number
  beat: number
  string: number
}

/** Every note on the cursor's track/staff matching the query, in song order. */
export function findNotes(score: Score, c: EditCursor, q: FindQuery): NoteRef[] {
  const staff = score.tracks[c.track]?.staves[c.staff]
  if (!staff) return []
  const out: NoteRef[] = []
  staff.bars.forEach((bar, bi) =>
    bar.voices.forEach((voice, vi) =>
      voice.beats.forEach((beat, ei) => {
        if (beat.isEmpty || beat.isRest) return
        if (q.duration != null && beat.duration !== q.duration) return
        for (const n of beat.notes) {
          if (q.fret != null && n.fret !== q.fret) continue
          if (q.string != null && n.string !== q.string) continue
          if (q.technique && !hasTechnique(n, q.technique)) continue
          out.push({ bar: bi, voice: vi, beat: ei, string: n.string })
        }
      }),
    ),
  )
  return out
}

/** What to do to every match: a new fret, a fret shift, removing the technique, a new duration. */
export interface ReplaceAction {
  fret?: number
  shift?: number
  clear?: Technique
  duration?: model.Duration
}

/** Apply `action` to the matched notes. Returns how many changed. */
export function replaceNotes(
  score: Score,
  c: EditCursor,
  matches: readonly NoteRef[],
  action: ReplaceAction,
  settings: Settings,
): number {
  const staff = score.tracks[c.track]?.staves[c.staff]
  if (!staff) return 0
  let changed = 0
  const beats = new Set<model.Beat>()
  for (const m of matches) {
    const beat = staff.bars[m.bar]?.voices[m.voice]?.beats[m.beat]
    const note = beat?.getNoteOnString(m.string)
    if (!beat || !note) continue
    if (action.fret != null) note.fret = Math.min(30, Math.max(0, Math.round(action.fret)))
    if (action.shift) note.fret = Math.min(30, Math.max(0, note.fret + action.shift))
    if (action.clear) clearTechnique(note, action.clear)
    if (action.duration != null) beats.add(beat)
    changed++
  }
  for (const b of beats) b.duration = action.duration!
  refresh(score, settings)
  return changed
}

// ── Auto-fingering (issue #459) ──────────────────────────────────────────

/**
 * Re-pick strings and frets for the beats in `refs` (pitches unchanged).
 * Tied notes follow their origin's string. Returns how many notes moved.
 */
export function autoFingerRange(
  score: Score,
  c: EditCursor,
  refs: readonly BeatRef[],
  options: FingeringOptions,
  settings: Settings,
): number {
  const staff = score.tracks[c.track]?.staves[c.staff]
  if (!staff || staff.isPercussion) return 0
  const beats = refs
    .map((r) => voiceAt(score, { ...c, bar: r.bar })?.beats[r.beat])
    .filter((b): b is Beat => !!b && !b.isRest && b.notes.length > 0)
  const current = beats.map((b) => b.notes.map((n) => ({ string: n.string, fret: n.fret })))
  const next = autoFinger(staff.stringTuning.tunings, current, options)
  let moved = 0
  beats.forEach((beat, bi) => {
    const notes = [...beat.notes]
    for (const n of notes) beat.removeNote(n)
    notes.forEach((n, i) => {
      const to = next[bi]![i]!
      if (to.string !== n.string || to.fret !== n.fret) moved++
      n.string = to.string
      n.fret = to.fret
    })
    for (const n of notes) beat.addNote(n)
  })
  // A tie must stay on its origin's string (same pitch, so the same fret).
  for (const beat of beats) {
    for (const n of [...beat.notes]) {
      const origin = n.tieOrigin
      if (!n.isTieDestination || !origin || origin.string === n.string) continue
      if (beat.getNoteOnString(origin.string)) continue
      beat.removeNote(n)
      n.string = origin.string
      n.fret = origin.fret
      beat.addNote(n)
    }
  }
  refresh(score, settings)
  return moved
}
