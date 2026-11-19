/**
 * Second tier of score editing (issue #206): ranges and the clipboard, tracks
 * and song setup, notation tools, voices and drums. Same contract as
 * scoreEdit.ts - pure model transforms over an alphaTab Score that return the
 * cursor to use next; the caller snapshots for undo, re-renders and saves.
 */
import { exporter, importer, model, type Settings } from '@coderline/alphatab'

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
  settings: Settings,
): void {
  const t = score.tracks[trackIndex]
  if (!t) return
  t.playbackInfo.program = Math.min(127, Math.max(0, Math.round(program)))
  refresh(score, settings)
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
function drumIndex(track: model.Track, id: number, settings: Settings): number {
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
