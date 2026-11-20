/**
 * Score editing as pure model transforms (issue #206): every function takes
 * an alphaTab Score plus an edit cursor, mutates the model, and returns the
 * cursor to use next. Rendering, undo snapshots and playback re-renders are
 * the caller's job, so these stay unit-testable without a DOM.
 *
 * Strings follow alphaTab: 1 is the LOWEST string (bottom tab line).
 */
import { model, type Settings } from '@coderline/alphatab'

type Score = model.Score
type Beat = model.Beat
type Voice = model.Voice
type Note = model.Note

export interface EditCursor {
  track: number
  staff: number
  bar: number
  voice: number
  beat: number
  /** 1 = lowest string. */
  string: number
}

export const DURATIONS = [
  model.Duration.Whole,
  model.Duration.Half,
  model.Duration.Quarter,
  model.Duration.Eighth,
  model.Duration.Sixteenth,
  model.Duration.ThirtySecond,
  model.Duration.SixtyFourth,
] as const

export const DURATION_LABEL: Record<number, string> = {
  [model.Duration.Whole]: '1/1',
  [model.Duration.Half]: '1/2',
  [model.Duration.Quarter]: '1/4',
  [model.Duration.Eighth]: '1/8',
  [model.Duration.Sixteenth]: '1/16',
  [model.Duration.ThirtySecond]: '1/32',
  [model.Duration.SixtyFourth]: '1/64',
}

export function startCursor(track = 0): EditCursor {
  return { track, staff: 0, bar: 0, voice: 0, beat: 0, string: 1 }
}

export function stringCount(score: Score, c: EditCursor): number {
  const staff = score.tracks[c.track]?.staves[c.staff]
  return Math.max(1, staff?.stringTuning.tunings.length ?? 6)
}

export function voiceAt(score: Score, c: EditCursor): Voice | null {
  return score.tracks[c.track]?.staves[c.staff]?.bars[c.bar]?.voices[c.voice] ?? null
}

export function beatAt(score: Score, c: EditCursor): Beat | null {
  return voiceAt(score, c)?.beats[c.beat] ?? null
}

export function noteAt(score: Score, c: EditCursor): Note | null {
  return beatAt(score, c)?.getNoteOnString(c.string) ?? null
}

/** Clamp a cursor onto the score (after deletions, track switches, reloads). */
export function clampCursor(score: Score, c: EditCursor): EditCursor {
  const track = Math.min(Math.max(0, c.track), score.tracks.length - 1)
  const staves = score.tracks[track]!.staves
  const staff = Math.min(Math.max(0, c.staff), staves.length - 1)
  const bars = staves[staff]!.bars
  const bar = Math.min(Math.max(0, c.bar), bars.length - 1)
  const voices = bars[bar]!.voices
  const voice = Math.min(Math.max(0, c.voice), voices.length - 1)
  const beats = voices[voice]!.beats
  const beat = Math.min(Math.max(0, c.beat), Math.max(0, beats.length - 1))
  const next = { track, staff, bar, voice, beat, string: c.string }
  next.string = Math.min(Math.max(1, c.string), stringCount(score, next))
  return next
}

/** Cursor pointing at an existing beat (e.g. one the user clicked). */
export function cursorForBeat(beat: Beat, string?: number): EditCursor {
  const bar = beat.voice.bar
  return {
    track: bar.staff.track.index,
    staff: bar.staff.index,
    bar: bar.index,
    voice: beat.voice.index,
    beat: beat.index,
    string: string ?? beat.notes[0]?.string ?? 1,
  }
}

export function refresh(score: Score, settings: Settings): void {
  score.finish(settings)
}

// ── Bars ─────────────────────────────────────────────────────────────────

function newRestBeat(duration: model.Duration): Beat {
  const beat = new model.Beat()
  beat.duration = duration
  return beat
}

/** A bar for `staff` with one voice holding a whole-bar rest. */
function emptyBarFor(staff: model.Staff, voices: number): model.Bar {
  const bar = new model.Bar()
  staff.addBar(bar)
  for (let v = 0; v < Math.max(1, voices); v++) {
    const voice = new model.Voice()
    bar.addVoice(voice)
    voice.addBeat(newRestBeat(model.Duration.Whole))
  }
  return bar
}

/**
 * Insert an empty bar after `afterIndex` (-1 = at the start) in every track,
 * copying the time signature of its neighbour. alphaTab links bars by array
 * order, so the arrays are spliced and the score re-finished.
 */
export function insertBar(score: Score, afterIndex: number, settings: Settings): number {
  const at = Math.min(Math.max(0, afterIndex + 1), score.masterBars.length)
  const ref =
    score.masterBars[Math.min(afterIndex, score.masterBars.length - 1)] ?? score.masterBars[0]
  const mb = new model.MasterBar()
  if (ref) {
    mb.timeSignatureNumerator = ref.timeSignatureNumerator
    mb.timeSignatureDenominator = ref.timeSignatureDenominator
    mb.timeSignatureCommon = ref.timeSignatureCommon
  }
  score.addMasterBar(mb)
  score.masterBars.splice(score.masterBars.length - 1, 1)
  score.masterBars.splice(at, 0, mb)
  for (const track of score.tracks) {
    for (const staff of track.staves) {
      const voices = staff.bars[0]?.voices.length ?? 1
      const bar = emptyBarFor(staff, voices)
      staff.bars.splice(staff.bars.length - 1, 1)
      staff.bars.splice(at, 0, bar)
    }
  }
  relink(score)
  refresh(score, settings)
  return at
}

/** Delete bar `index` from every track (keeps at least one bar). */
export function deleteBar(score: Score, index: number, settings: Settings): void {
  if (score.masterBars.length <= 1 || index < 0 || index >= score.masterBars.length) return
  score.masterBars.splice(index, 1)
  for (const track of score.tracks) for (const staff of track.staves) staff.bars.splice(index, 1)
  relink(score)
  refresh(score, settings)
}

/** Duplicate bar `index` (all tracks) right after itself. */
export function duplicateBar(score: Score, index: number, settings: Settings): number {
  const at = insertBar(score, index, settings)
  for (const track of score.tracks) {
    for (const staff of track.staves) {
      const src = staff.bars[index]!
      const dst = staff.bars[at]!
      for (let v = 0; v < src.voices.length; v++) {
        const target =
          dst.voices[v] ??
          (() => {
            const nv = new model.Voice()
            dst.addVoice(nv)
            return nv
          })()
        target.beats.length = 0
        for (const b of src.voices[v]!.beats) target.addBeat(copyBeat(b))
      }
    }
  }
  const srcMb = score.masterBars[index]!
  const dstMb = score.masterBars[at]!
  dstMb.timeSignatureNumerator = srcMb.timeSignatureNumerator
  dstMb.timeSignatureDenominator = srcMb.timeSignatureDenominator
  relink(score)
  refresh(score, settings)
  return at
}

const NOTE_FIELDS = [
  'string',
  'fret',
  'isPalmMute',
  'isLetRing',
  'isHammerPullOrigin',
  'slideOutType',
  'vibrato',
  'isDead',
  'isGhost',
  'harmonicType',
  'harmonicValue',
  'isStaccato',
  'accentuated',
  'bendType',
  'isTieDestination',
  'leftHandFinger',
  'rightHandFinger',
  'dynamics',
  'percussionArticulation',
] as const
const BEAT_FIELDS = [
  'duration',
  'dots',
  'tupletNumerator',
  'tupletDenominator',
  'isEmpty',
  'tap',
  'slap',
  'pop',
  'pickStroke',
  'fade',
  'vibrato',
  'text',
  'dynamics',
  'brushType',
  'graceType',
] as const

/**
 * Copy of a beat's musical content (alphaTab's own cloner isn't exported):
 * duration/tuplets, notes with their articulations and bends.
 */
export function copyBeat(src: Beat): Beat {
  const beat = new model.Beat()
  const b = beat as unknown as Record<string, unknown>
  const s = src as unknown as Record<string, unknown>
  for (const f of BEAT_FIELDS) b[f] = s[f]
  for (const n of src.notes) {
    const note = new model.Note()
    const t = note as unknown as Record<string, unknown>
    const o = n as unknown as Record<string, unknown>
    for (const f of NOTE_FIELDS) t[f] = o[f]
    for (const p of n.bendPoints ?? []) note.addBendPoint(new model.BendPoint(p.offset, p.value))
    beat.addNote(note)
  }
  return beat
}

/** Re-establish index/prev/next links after array splices. */
export function relink(score: Score): void {
  score.masterBars.forEach((mb, i) => {
    mb.index = i
    mb.score = score
    mb.previousMasterBar = score.masterBars[i - 1] ?? null
    mb.nextMasterBar = score.masterBars[i + 1] ?? null
  })
  for (const track of score.tracks) {
    for (const staff of track.staves) {
      staff.bars.forEach((bar, i) => {
        bar.index = i
        bar.staff = staff
        bar.previousBar = staff.bars[i - 1] ?? null
        bar.nextBar = staff.bars[i + 1] ?? null
        for (const voice of bar.voices) {
          voice.bar = bar
          voice.beats.forEach((beat, j) => {
            beat.index = j
            beat.voice = voice
          })
        }
      })
    }
  }
}

// ── Beats ────────────────────────────────────────────────────────────────

/** Fill (in ticks) of a voice versus its bar's time signature. */
export function barFill(score: Score, c: EditCursor): { used: number; capacity: number } {
  const voice = voiceAt(score, c)
  const mb = score.masterBars[c.bar]
  if (!voice || !mb) return { used: 0, capacity: 0 }
  const capacity = mb.calculateDuration(false)
  const used = voice.beats.reduce((sum, b) => sum + (b.isEmpty ? 0 : b.playbackDuration), 0)
  return { used, capacity }
}

/** Insert a rest beat after the cursor's beat (same duration); returns its cursor. */
export function insertBeatAfter(score: Score, c: EditCursor, settings: Settings): EditCursor {
  const voice = voiceAt(score, c)
  const beat = beatAt(score, c)
  if (!voice || !beat) return c
  const nb = newRestBeat(beat.duration)
  voice.insertBeat(beat, nb)
  relink(score)
  refresh(score, settings)
  return { ...c, beat: c.beat + 1 }
}

/** Insert a rest beat before the cursor's beat. */
export function insertBeatBefore(score: Score, c: EditCursor, settings: Settings): EditCursor {
  const voice = voiceAt(score, c)
  const beat = beatAt(score, c)
  if (!voice || !beat) return c
  const nb = newRestBeat(beat.duration)
  voice.beats.splice(c.beat, 0, nb)
  nb.voice = voice
  relink(score)
  refresh(score, settings)
  return c
}

/** Delete the cursor's beat; a bar never ends up with no beats (it gets a whole rest). */
export function deleteBeat(score: Score, c: EditCursor, settings: Settings): EditCursor {
  const voice = voiceAt(score, c)
  if (!voice) return c
  voice.beats.splice(c.beat, 1)
  if (voice.beats.length === 0) voice.addBeat(newRestBeat(model.Duration.Whole))
  relink(score)
  refresh(score, settings)
  return clampCursor(score, { ...c, beat: Math.min(c.beat, voice.beats.length - 1) })
}

// ── Notes ────────────────────────────────────────────────────────────────

/** Set (or create) the note on the cursor's string. Frets 0..30. */
export function setFret(score: Score, c: EditCursor, fret: number, settings: Settings): void {
  const beat = beatAt(score, c)
  if (!beat) return
  const value = Math.min(30, Math.max(0, Math.round(fret)))
  const existing = beat.getNoteOnString(c.string)
  if (existing) {
    existing.fret = value
  } else {
    const note = new model.Note()
    note.string = c.string
    note.fret = value
    beat.addNote(note)
  }
  beat.isEmpty = false
  refresh(score, settings)
}

export function deleteNote(score: Score, c: EditCursor, settings: Settings): void {
  const beat = beatAt(score, c)
  const note = beat?.getNoteOnString(c.string)
  if (!beat || !note) return
  beat.removeNote(note)
  refresh(score, settings)
}

/** Clear every note of the beat, making it a rest. */
export function makeRest(score: Score, c: EditCursor, settings: Settings): void {
  const beat = beatAt(score, c)
  if (!beat) return
  for (const n of [...beat.notes]) beat.removeNote(n)
  refresh(score, settings)
}

export function setDuration(
  score: Score,
  c: EditCursor,
  duration: model.Duration,
  settings: Settings,
): void {
  const beat = beatAt(score, c)
  if (!beat) return
  beat.duration = duration
  refresh(score, settings)
}

/** Step the duration shorter (+1) or longer (-1). */
export function stepDuration(score: Score, c: EditCursor, dir: 1 | -1, settings: Settings): void {
  const beat = beatAt(score, c)
  if (!beat) return
  const i = DURATIONS.indexOf(beat.duration as (typeof DURATIONS)[number])
  const next = DURATIONS[Math.min(DURATIONS.length - 1, Math.max(0, (i < 0 ? 2 : i) + dir))]!
  setDuration(score, c, next, settings)
}

export function toggleDot(score: Score, c: EditCursor, settings: Settings): void {
  const beat = beatAt(score, c)
  if (!beat) return
  beat.dots = beat.dots === 1 ? 0 : 1
  refresh(score, settings)
}

export function setTuplet(
  score: Score,
  c: EditCursor,
  numerator: number,
  denominator: number,
  settings: Settings,
): void {
  const beat = beatAt(score, c)
  if (!beat) return
  const off = beat.tupletNumerator === numerator && beat.tupletDenominator === denominator
  beat.tupletNumerator = off ? -1 : numerator
  beat.tupletDenominator = off ? -1 : denominator
  refresh(score, settings)
}

// ── Effects ──────────────────────────────────────────────────────────────

export type NoteEffect =
  | 'palmMute'
  | 'letRing'
  | 'hammer'
  | 'slide'
  | 'vibrato'
  | 'bend'
  | 'dead'
  | 'ghost'
  | 'harmonic'
  | 'staccato'
  | 'accent'
  | 'tie'

export type BeatEffect = 'tap' | 'slap' | 'pop' | 'pickDown' | 'pickUp' | 'fadeIn'

/** Toggle an articulation on the cursor's note. Returns the new on/off state. */
export function toggleNoteEffect(
  score: Score,
  c: EditCursor,
  effect: NoteEffect,
  settings: Settings,
): boolean {
  const note = noteAt(score, c)
  if (!note) return false
  let on = false
  switch (effect) {
    case 'palmMute':
      on = note.isPalmMute = !note.isPalmMute
      break
    case 'letRing':
      on = note.isLetRing = !note.isLetRing
      break
    case 'hammer':
      on = note.isHammerPullOrigin = !note.isHammerPullOrigin
      break
    case 'slide':
      on = note.slideOutType === model.SlideOutType.None
      note.slideOutType = on ? model.SlideOutType.Legato : model.SlideOutType.None
      break
    case 'vibrato':
      on = note.vibrato === model.VibratoType.None
      note.vibrato = on ? model.VibratoType.Slight : model.VibratoType.None
      break
    case 'bend':
      on = note.bendType === model.BendType.None
      if (on) {
        // Full-step bend: 0 -> +1 tone over the note (alphaTab bend values are quarter tones).
        note.bendType = model.BendType.Bend
        note.addBendPoint(new model.BendPoint(0, 0))
        note.addBendPoint(new model.BendPoint(30, 4))
        note.addBendPoint(new model.BendPoint(60, 4))
      } else {
        note.bendType = model.BendType.None
        note.bendPoints = null
      }
      break
    case 'dead':
      on = note.isDead = !note.isDead
      break
    case 'ghost':
      on = note.isGhost = !note.isGhost
      break
    case 'harmonic':
      on = note.harmonicType === model.HarmonicType.None
      note.harmonicType = on ? model.HarmonicType.Natural : model.HarmonicType.None
      break
    case 'staccato':
      on = note.isStaccato = !note.isStaccato
      break
    case 'accent':
      on = note.accentuated === model.AccentuationType.None
      note.accentuated = on ? model.AccentuationType.Normal : model.AccentuationType.None
      break
    case 'tie':
      on = note.isTieDestination = !note.isTieDestination
      break
  }
  refresh(score, settings)
  return on
}

export function toggleBeatEffect(
  score: Score,
  c: EditCursor,
  effect: BeatEffect,
  settings: Settings,
): boolean {
  const beat = beatAt(score, c)
  if (!beat) return false
  let on = false
  switch (effect) {
    case 'tap':
      on = beat.tap = !beat.tap
      break
    case 'slap':
      on = beat.slap = !beat.slap
      break
    case 'pop':
      on = beat.pop = !beat.pop
      break
    case 'pickDown':
      on = beat.pickStroke !== model.PickStroke.Down
      beat.pickStroke = on ? model.PickStroke.Down : model.PickStroke.None
      break
    case 'pickUp':
      on = beat.pickStroke !== model.PickStroke.Up
      beat.pickStroke = on ? model.PickStroke.Up : model.PickStroke.None
      break
    case 'fadeIn':
      on = beat.fade === model.FadeType.None
      beat.fade = on ? model.FadeType.FadeIn : model.FadeType.None
      break
  }
  refresh(score, settings)
  return on
}

// ── Bar-level properties ─────────────────────────────────────────────────

export function setTimeSignature(
  score: Score,
  bar: number,
  num: number,
  den: number,
  settings: Settings,
): void {
  const mb = score.masterBars[bar]
  if (!mb) return
  mb.timeSignatureNumerator = Math.min(32, Math.max(1, Math.round(num)))
  mb.timeSignatureDenominator = [1, 2, 4, 8, 16, 32].includes(den) ? den : 4
  mb.timeSignatureCommon = false
  refresh(score, settings)
}

export function toggleRepeat(
  score: Score,
  bar: number,
  which: 'start' | 'end',
  settings: Settings,
): void {
  const mb = score.masterBars[bar]
  if (!mb) return
  if (which === 'start') mb.isRepeatStart = !mb.isRepeatStart
  else mb.repeatCount = mb.repeatCount > 0 ? 0 : 2
  refresh(score, settings)
}

/** Tempo at the start of a bar (BPM). Adds/replaces a tempo automation. */
export function setTempo(score: Score, bar: number, bpm: number, settings: Settings): void {
  const mb = score.masterBars[bar]
  if (!mb) return
  const value = Math.min(400, Math.max(20, Math.round(bpm)))
  const existing = mb.tempoAutomations.find((a) => a.ratioPosition === 0)
  if (existing) existing.value = value
  else mb.tempoAutomations.unshift(model.Automation.buildTempoAutomation(false, 0, value, 0))
  refresh(score, settings)
}

export function tempoAt(score: Score, bar: number): number {
  for (let i = Math.min(bar, score.masterBars.length - 1); i >= 0; i--) {
    const a = score.masterBars[i]!.tempoAutomations[0]
    if (a) return a.value
  }
  return score.tempo || 120
}

/** Transpose every fretted note of the cursor's bar by `semitones` (frets clamp at 0..30). */
export function transposeBar(
  score: Score,
  c: EditCursor,
  semitones: number,
  settings: Settings,
): void {
  const voice = voiceAt(score, c)
  if (!voice) return
  for (const beat of voice.beats) {
    for (const note of beat.notes) {
      if (note.fret >= 0) note.fret = Math.min(30, Math.max(0, note.fret + semitones))
    }
  }
  refresh(score, settings)
}

// ── Navigation ───────────────────────────────────────────────────────────

/**
 * Move right one beat, Guitar-Pro style: past the last beat of a bar that
 * still has room, a rest beat is appended; past a full bar, into the next bar;
 * past the last bar, a new bar is created.
 */
export function moveRight(
  score: Score,
  c: EditCursor,
  settings: Settings,
  extend = true,
): EditCursor {
  const voice = voiceAt(score, c)
  if (!voice) return c
  if (c.beat < voice.beats.length - 1) return { ...c, beat: c.beat + 1 }
  if (!extend) {
    if (c.bar < score.masterBars.length - 1) return { ...c, bar: c.bar + 1, beat: 0 }
    return c
  }
  const current = voice.beats[c.beat]!
  const { used, capacity } = barFill(score, c)
  if (!current.isRest && used < capacity) return insertBeatAfter(score, c, settings)
  if (c.bar >= score.masterBars.length - 1) insertBar(score, c.bar, settings)
  return clampCursor(score, { ...c, bar: c.bar + 1, beat: 0 })
}

export function moveLeft(score: Score, c: EditCursor): EditCursor {
  if (c.beat > 0) return { ...c, beat: c.beat - 1 }
  if (c.bar === 0) return c
  const prevVoice = voiceAt(score, { ...c, bar: c.bar - 1 })
  return { ...c, bar: c.bar - 1, beat: Math.max(0, (prevVoice?.beats.length ?? 1) - 1) }
}

/** Up = toward the highest string (larger number). */
export function moveString(score: Score, c: EditCursor, dir: 1 | -1): EditCursor {
  return { ...c, string: Math.min(stringCount(score, c), Math.max(1, c.string + dir)) }
}

export function moveBar(score: Score, c: EditCursor, dir: 1 | -1): EditCursor {
  return clampCursor(score, { ...c, bar: c.bar + dir, beat: 0 })
}
