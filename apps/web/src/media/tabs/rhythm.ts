/**
 * Smarter rhythm entry (issue #459): keep bar rhythm when overwriting durations,
 * metric-aware rest splitting/merging, tuplet editor, and bar quantization.
 * Pure model transforms over an alphaTab Score, unit-testable without a DOM.
 */
import { model, type Settings } from '@coderline/alphatab'

import { paste, type BeatRef, type Clipboard } from './scoreOps'
import {
  beatAt,
  clampCursor,
  copyBeat,
  DURATIONS,
  refresh,
  relink,
  voiceAt,
  type EditCursor,
} from './scoreEdit'

type Score = model.Score
type Beat = model.Beat
type Voice = model.Voice
type MasterBar = model.MasterBar

export const TICKS_PER_WHOLE = 3840
export const TICKS_PER_QUARTER = 960

export interface TupletPreset {
  num: number
  den: number
  label: string
  title: string
}

export const TUPLET_PRESETS: readonly TupletPreset[] = [
  { num: 3, den: 2, label: '3:2', title: 'Triplet (3 in the time of 2)' },
  { num: 5, den: 4, label: '5:4', title: 'Quintuplet (5 in the time of 4)' },
  { num: 6, den: 4, label: '6:4', title: 'Sextuplet (6 in the time of 4)' },
  { num: 7, den: 4, label: '7:4', title: 'Septuplet (7 in the time of 4)' },
  { num: 2, den: 3, label: '2:3', title: 'Duplet (2 in the time of 3)' },
  { num: 4, den: 3, label: '4:3', title: 'Quadruplet (4 in the time of 3)' },
]

export type QuantizeGrid = '1/4' | '1/8' | '1/16' | '1/32' | '1/8T' | '1/16T'

export interface QuantizeGridOption {
  id: QuantizeGrid
  label: string
  ticks: number
  tuplet?: readonly [number, number]
  baseDuration?: model.Duration
}

export const QUANTIZE_GRIDS: readonly QuantizeGridOption[] = [
  { id: '1/4', label: '1/4', ticks: 960 },
  { id: '1/8', label: '1/8', ticks: 480 },
  { id: '1/16', label: '1/16', ticks: 240 },
  { id: '1/32', label: '1/32', ticks: 120 },
  {
    id: '1/8T',
    label: '1/8 triplet',
    ticks: 320,
    tuplet: [3, 2],
    baseDuration: model.Duration.Eighth,
  },
  {
    id: '1/16T',
    label: '1/16 triplet',
    ticks: 160,
    tuplet: [3, 2],
    baseDuration: model.Duration.Sixteenth,
  },
]

export function quantizeGridOption(grid: QuantizeGrid): QuantizeGridOption {
  return QUANTIZE_GRIDS.find((g) => g.id === grid) ?? QUANTIZE_GRIDS[2]!
}

/** Tick length of a beat duration with optional dots and tuplet ratio. */
export function durationTicks(
  duration: model.Duration,
  dots = 0,
  tupletNum = -1,
  tupletDen = -1,
): number {
  const d = Number(duration)
  const base = d < 0 ? Math.round(TICKS_PER_WHOLE * -d) : Math.round(TICKS_PER_WHOLE / (d || 4))
  const withDots = dots === 1 ? (base * 3) / 2 : dots === 2 ? (base * 7) / 4 : base
  const withTuplet = tupletNum > 0 && tupletDen > 0 ? (withDots * tupletDen) / tupletNum : withDots
  return Math.round(withTuplet)
}

export function beatTicks(beat: Beat): number {
  if (beat.graceType !== model.GraceType.None || beat.isEmpty) return 0
  return durationTicks(beat.duration, beat.dots, beat.tupletNumerator, beat.tupletDenominator)
}

/** Beat unit in ticks (dotted quarter for compound meters like 6/8, 9/8, 12/8). */
export function barBeatUnit(mb: MasterBar): number {
  const num = mb.timeSignatureNumerator || 4
  const den = mb.timeSignatureDenominator || 4
  if (den === 8 && num >= 6 && num % 3 === 0) return 1440
  return Math.round(TICKS_PER_WHOLE / den)
}

export function beatStartTick(voice: Voice, beatIndex: number): number {
  let sum = 0
  const limit = Math.min(beatIndex, voice.beats.length)
  for (let i = 0; i < limit; i++) sum += beatTicks(voice.beats[i]!)
  return sum
}

function voiceTicks(voice: Voice): number {
  let sum = 0
  for (const b of voice.beats) sum += beatTicks(b)
  return sum
}

export interface RhythmPart {
  duration: model.Duration
  dots: number
  tupletNum?: number
  tupletDen?: number
}

interface Candidate {
  duration: model.Duration
  dots: number
  ticks: number
  tupletNum?: number
  tupletDen?: number
}

const STRAIGHT_CANDIDATES: readonly Candidate[] = [
  { duration: model.Duration.Whole, dots: 0, ticks: 3840 },
  { duration: model.Duration.Half, dots: 1, ticks: 2880 },
  { duration: model.Duration.Half, dots: 0, ticks: 1920 },
  { duration: model.Duration.Quarter, dots: 1, ticks: 1440 },
  { duration: model.Duration.Quarter, dots: 0, ticks: 960 },
  { duration: model.Duration.Eighth, dots: 1, ticks: 720 },
  { duration: model.Duration.Eighth, dots: 0, ticks: 480 },
  { duration: model.Duration.Sixteenth, dots: 1, ticks: 360 },
  { duration: model.Duration.Sixteenth, dots: 0, ticks: 240 },
  { duration: model.Duration.ThirtySecond, dots: 0, ticks: 120 },
  { duration: model.Duration.SixtyFourth, dots: 0, ticks: 60 },
]

const TRIPLET_CANDIDATES: readonly Candidate[] = [
  { duration: model.Duration.Quarter, dots: 0, ticks: 640, tupletNum: 3, tupletDen: 2 },
  { duration: model.Duration.Eighth, dots: 0, ticks: 320, tupletNum: 3, tupletDen: 2 },
  { duration: model.Duration.Sixteenth, dots: 0, ticks: 160, tupletNum: 3, tupletDen: 2 },
]

function makeRestBeat(part: RhythmPart): Beat {
  const b = new model.Beat()
  b.duration = part.duration
  b.dots = part.dots
  if (part.tupletNum && part.tupletDen) {
    b.tupletNumerator = part.tupletNum
    b.tupletDenominator = part.tupletDen
  }
  return b
}

function toPart(c: Candidate): RhythmPart {
  return {
    duration: c.duration,
    dots: c.dots,
    ...(c.tupletNum && c.tupletDen ? { tupletNum: c.tupletNum, tupletDen: c.tupletDen } : {}),
  }
}

function isCleanAlignment(
  c: Candidate,
  pos: number,
  beatUnit: number,
  allowDotted: boolean,
): boolean {
  if (c.dots > 0) {
    if (!allowDotted) {
      // In compound meters (6/8, 9/8, 12/8), dotted quarter rests align to the dotted beat.
      return beatUnit === 1440 && c.ticks === 1440 && pos % 1440 === 0
    }
    if (c.ticks === 2880) return pos === 0
    if (c.ticks === 1440) return pos % beatUnit === 0
    if (c.ticks === 720) return pos % 480 === 0
    if (c.ticks === 360) return pos % 240 === 0
    return false
  }
  if (c.ticks <= 480) return pos % c.ticks === 0
  if (c.ticks <= beatUnit) return pos % c.ticks === 0
  // Larger straight durations (half, whole) must align cleanly to their own boundary
  // so e.g. a half rest never crosses beats 2-3 of a 4/4 bar.
  return pos % c.ticks === 0
}

function decomposeSpan(
  ticks: number,
  startOffset: number,
  barCapacity: number,
  beatUnit: number,
  allowDotted: boolean,
): RhythmPart[] {
  const target = Math.round(ticks)
  if (target <= 0) return []
  if (startOffset === 0 && target === barCapacity) {
    if (barCapacity === 3840) return [{ duration: model.Duration.Whole, dots: 0 }]
    if (barCapacity === 2880) return [{ duration: model.Duration.Half, dots: 1 }]
  }
  const out: RhythmPart[] = []
  let pos = Math.round(startOffset)
  let rem = target
  while (rem >= 60) {
    let picked: Candidate | undefined
    if (rem % 60 !== 0) {
      picked = TRIPLET_CANDIDATES.find((c) => c.ticks <= rem && (rem - c.ticks) % 60 === 0)
    }
    picked ??=
      STRAIGHT_CANDIDATES.find(
        (c) => c.ticks <= rem && isCleanAlignment(c, pos, beatUnit, allowDotted),
      ) ?? STRAIGHT_CANDIDATES.find((c) => c.ticks <= rem)
    if (!picked) break
    out.push(toPart(picked))
    pos += picked.ticks
    rem -= picked.ticks
  }
  return out
}

/**
 * Split a rest span into metric-aware rest values (e.g. a 1920-tick rest on
 * beat 2 of 4/4 becomes two quarter rests instead of crossing the middle).
 */
export function decomposeRests(
  ticks: number,
  startOffset: number,
  barCapacity: number,
  beatUnit = TICKS_PER_QUARTER,
): RhythmPart[] {
  return decomposeSpan(ticks, startOffset, barCapacity, beatUnit, false)
}

/**
 * Split a note span into metric-aware beat values (allows dotted notes on
 * beat boundaries so e.g. a dotted quarter stays one beat when aligned).
 */
export function decomposeDuration(
  ticks: number,
  startOffset: number,
  barCapacity: number,
  beatUnit = TICKS_PER_QUARTER,
): RhythmPart[] {
  return decomposeSpan(ticks, startOffset, barCapacity, beatUnit, true)
}

const isPlainRest = (b: Beat) =>
  b.isRest && b.notes.length === 0 && b.graceType === model.GraceType.None && b.tupletNumerator <= 0

/**
 * Merge consecutive plain rests in `voice` into canonical metric-aware rests.
 * Tuplet rests, grace notes and an optional `preserveBeat` (e.g. the cursor's
 * rest beat whose duration the user just set) are left unmerged. Returns the
 * beat index covering `trackOffset`.
 */
export function mergeRestsInVoice(
  voice: Voice,
  mb: MasterBar,
  trackOffset = 0,
  preserveBeat?: Beat,
): number {
  const capacity = mb.calculateDuration(false)
  const beatUnit = barBeatUnit(mb)
  const nextBeats: Beat[] = []
  let pos = 0
  let i = 0
  while (i < voice.beats.length) {
    const b = voice.beats[i]!
    if (!isPlainRest(b) || b === preserveBeat) {
      nextBeats.push(b)
      pos += beatTicks(b)
      i++
      continue
    }
    const startOffset = pos
    let span = 0
    while (
      i < voice.beats.length &&
      isPlainRest(voice.beats[i]!) &&
      voice.beats[i] !== preserveBeat
    ) {
      span += beatTicks(voice.beats[i]!)
      i++
    }
    const parts = decomposeRests(span, startOffset, capacity, beatUnit)
    if (parts.length) {
      for (const p of parts) {
        const rb = makeRestBeat(p)
        rb.voice = voice
        nextBeats.push(rb)
      }
    } else if (span > 0) {
      // Preserve tiny remainder if smaller than a 64th rest.
      const rb = makeRestBeat({ duration: model.Duration.SixtyFourth, dots: 0 })
      rb.voice = voice
      nextBeats.push(rb)
    }
    pos += span
  }
  if (!nextBeats.length) {
    const rb = makeRestBeat({ duration: model.Duration.Whole, dots: 0 })
    rb.voice = voice
    nextBeats.push(rb)
  }
  voice.beats.length = 0
  for (const nb of nextBeats) voice.addBeat(nb)

  let cursorAcc = 0
  for (let idx = 0; idx < voice.beats.length; idx++) {
    const t = beatTicks(voice.beats[idx]!)
    if (trackOffset < cursorAcc + t || idx === voice.beats.length - 1) return idx
    cursorAcc += t
  }
  return 0
}

/** Pad an underfilled voice with metric rests and merge adjacent rests. */
export function normalizeBarRests(score: Score, c: EditCursor, settings: Settings): EditCursor {
  const voice = voiceAt(score, c)
  const mb = score.masterBars[c.bar]
  if (!voice || !mb) return c
  const startTick = beatStartTick(voice, c.beat)
  const capacity = mb.calculateDuration(false)
  const used = voiceTicks(voice)
  if (used < capacity) {
    const pad = decomposeRests(capacity - used, used, capacity, barBeatUnit(mb))
    for (const p of pad) voice.addBeat(makeRestBeat(p))
  }
  const beat = mergeRestsInVoice(voice, mb, startTick)
  relink(score)
  refresh(score, settings)
  return clampCursor(score, { ...c, beat })
}

/**
 * Consume `excess` ticks from beats starting at `afterIndex` inside `voice`,
 * splitting a partially consumed beat into canonical rests when needed.
 */
function trimFollowingBeats(
  voice: Voice,
  afterIndex: number,
  afterStartTick: number,
  excessTicks: number,
  capacity: number,
  beatUnit: number,
): void {
  let excess = excessTicks
  while (excess > 0 && afterIndex < voice.beats.length) {
    const after = voice.beats[afterIndex]!
    if (after.graceType !== model.GraceType.None) {
      afterIndex++
      continue
    }
    const at = beatTicks(after)
    if (at <= excess) {
      voice.beats.splice(afterIndex, 1)
      excess -= at
    } else {
      const remParts = decomposeRests(at - excess, afterStartTick, capacity, beatUnit)
      const replacements = remParts.map((p) => {
        const rb = makeRestBeat(p)
        rb.voice = voice
        return rb
      })
      voice.beats.splice(afterIndex, 1, ...replacements)
      excess = 0
    }
  }
}

/**
 * Adjust the cursor beat's duration/dots while keeping the bar's total rhythm
 * aligned: shortening splits trailing rests, lengthening consumes following
 * beats or splits their remainder into rests.
 */
export function changeDurationKeepRhythm(
  score: Score,
  c: EditCursor,
  nextDuration: model.Duration,
  nextDots: number,
  settings: Settings,
): EditCursor {
  const voice = voiceAt(score, c)
  const beat = beatAt(score, c)
  const mb = score.masterBars[c.bar]
  if (!voice || !beat || !mb) return c

  const capacity = mb.calculateDuration(false)
  const beatUnit = barBeatUnit(mb)
  const startTick = beatStartTick(voice, c.beat)
  const oldT = beatTicks(beat)
  const newT = durationTicks(nextDuration, nextDots, beat.tupletNumerator, beat.tupletDenominator)

  beat.duration = nextDuration
  beat.dots = nextDots

  if (newT < oldT) {
    const gap = decomposeRests(oldT - newT, startTick + newT, capacity, beatUnit)
    const rests = gap.map((p) => {
      const rb = makeRestBeat(p)
      rb.voice = voice
      return rb
    })
    voice.beats.splice(c.beat + 1, 0, ...rests)
  } else if (newT > oldT && startTick + newT <= capacity) {
    const used = voiceTicks(voice)
    if (used > capacity) {
      trimFollowingBeats(voice, c.beat + 1, startTick + newT, used - capacity, capacity, beatUnit)
    }
  }

  const nextBeatIdx = mergeRestsInVoice(voice, mb, startTick, beat)
  relink(score)
  refresh(score, settings)
  return clampCursor(score, { ...c, beat: nextBeatIdx })
}

export function setDurationKeepRhythm(
  score: Score,
  c: EditCursor,
  duration: model.Duration,
  settings: Settings,
): EditCursor {
  const beat = beatAt(score, c)
  if (!beat) return c
  return changeDurationKeepRhythm(score, c, duration, beat.dots, settings)
}

export function stepDurationKeepRhythm(
  score: Score,
  c: EditCursor,
  dir: 1 | -1,
  settings: Settings,
): EditCursor {
  const beat = beatAt(score, c)
  if (!beat) return c
  const i = DURATIONS.indexOf(beat.duration as (typeof DURATIONS)[number])
  const next = DURATIONS[Math.min(DURATIONS.length - 1, Math.max(0, (i < 0 ? 2 : i) + dir))]!
  return setDurationKeepRhythm(score, c, next, settings)
}

export function toggleDotKeepRhythm(score: Score, c: EditCursor, settings: Settings): EditCursor {
  const beat = beatAt(score, c)
  if (!beat) return c
  return changeDurationKeepRhythm(score, c, beat.duration, beat.dots === 1 ? 0 : 1, settings)
}

/** Clear notes on the cursor's beat and merge adjacent rests in the bar. */
export function makeRestAndMerge(score: Score, c: EditCursor, settings: Settings): EditCursor {
  const voice = voiceAt(score, c)
  const beat = beatAt(score, c)
  const mb = score.masterBars[c.bar]
  if (!voice || !beat || !mb) return c
  const startTick = beatStartTick(voice, c.beat)
  for (const n of [...beat.notes]) beat.removeNote(n)
  const nextBeatIdx = mergeRestsInVoice(voice, mb, startTick)
  relink(score)
  refresh(score, settings)
  return clampCursor(score, { ...c, beat: nextBeatIdx })
}

/**
 * Paste `clip` at the cursor while keeping the bar's rhythm intact: copied
 * beats overwrite `clipTicks` starting at `c.beat`, splitting any partially
 * overlapped beat's remainder into metric rests instead of overflowing the bar.
 */
export function pasteKeepRhythm(
  score: Score,
  c: EditCursor,
  clip: Clipboard,
  settings: Settings,
): EditCursor {
  if (clip.kind === 'bars') return paste(score, c, clip, settings)
  const voice = voiceAt(score, c)
  const mb = score.masterBars[c.bar]
  if (!voice || !mb || !clip.beats.length) return c

  const capacity = mb.calculateDuration(false)
  const beatUnit = barBeatUnit(mb)
  const startTick = beatStartTick(voice, c.beat)
  const copies = clip.beats.map(copyBeat)
  const clipTicks = copies.reduce((sum, b) => sum + beatTicks(b), 0)

  if (startTick + clipTicks > capacity) {
    // Fallback when clip exceeds remaining bar capacity: replace rest bar or insert cleanly.
    const empty = voice.beats.length === 1 && voice.beats[0]!.isRest
    if (empty) voice.beats.splice(0, 1, ...copies)
    else voice.beats.splice(c.beat, 0, ...copies)
    for (const b of copies) b.voice = voice
    relink(score)
    refresh(score, settings)
    return clampCursor(score, { ...c, beat: c.beat + copies.length - (empty ? 1 : 0) })
  }

  let covered = 0
  let removeCount = 0
  let remainder = 0
  while (c.beat + removeCount < voice.beats.length && covered < clipTicks) {
    const cur = voice.beats[c.beat + removeCount]!
    const ct = beatTicks(cur)
    removeCount++
    if (covered + ct > clipTicks) {
      remainder = covered + ct - clipTicks
      break
    }
    covered += ct
  }
  const tailRests =
    remainder > 0
      ? decomposeRests(remainder, startTick + clipTicks, capacity, beatUnit).map((p) =>
          makeRestBeat(p),
        )
      : []
  const inserted = [...copies, ...tailRests]
  for (const b of inserted) b.voice = voice
  voice.beats.splice(c.beat, removeCount, ...inserted)

  const used = voiceTicks(voice)
  if (used < capacity) {
    for (const p of decomposeRests(capacity - used, used, capacity, beatUnit)) {
      const rb = makeRestBeat(p)
      rb.voice = voice
      voice.beats.push(rb)
    }
  }
  mergeRestsInVoice(voice, mb, startTick)
  relink(score)
  refresh(score, settings)
  return clampCursor(score, { ...c, beat: c.beat + copies.length })
}

// ── Tuplet editor ────────────────────────────────────────────────────────

/** Clear tuplet grouping on the contiguous matching tuplet group containing `c.beat`. */
export function clearTuplet(
  score: Score,
  c: EditCursor,
  keepRhythm: boolean,
  settings: Settings,
): EditCursor {
  const voice = voiceAt(score, c)
  const beat = beatAt(score, c)
  const mb = score.masterBars[c.bar]
  if (!voice || !beat || !mb || beat.tupletNumerator <= 0) return c

  const num = beat.tupletNumerator
  const den = beat.tupletDenominator
  let lo = c.beat
  while (
    lo > 0 &&
    voice.beats[lo - 1]!.tupletNumerator === num &&
    voice.beats[lo - 1]!.tupletDenominator === den
  ) {
    lo--
  }
  let hi = c.beat
  while (
    hi + 1 < voice.beats.length &&
    voice.beats[hi + 1]!.tupletNumerator === num &&
    voice.beats[hi + 1]!.tupletDenominator === den
  ) {
    hi++
  }

  const startTick = beatStartTick(voice, lo)
  let groupTicks = 0
  for (let i = lo; i <= hi; i++) groupTicks += beatTicks(voice.beats[i]!)

  for (let i = lo; i <= hi; i++) {
    voice.beats[i]!.tupletNumerator = -1
    voice.beats[i]!.tupletDenominator = -1
  }

  if (keepRhythm) {
    const capacity = mb.calculateDuration(false)
    const beatUnit = barBeatUnit(mb)
    let newTicks = 0
    for (let i = lo; i <= hi; i++) newTicks += beatTicks(voice.beats[i]!)
    // Drop trailing rests inside the cleared group when un-tupleting expands duration.
    let end = hi
    while (newTicks > groupTicks && end > lo && isPlainRest(voice.beats[end]!)) {
      newTicks -= beatTicks(voice.beats[end]!)
      voice.beats.splice(end, 1)
      end--
    }
    const afterStart = startTick + newTicks
    if (newTicks < groupTicks) {
      const pad = decomposeRests(groupTicks - newTicks, afterStart, capacity, beatUnit).map((p) => {
        const rb = makeRestBeat(p)
        rb.voice = voice
        return rb
      })
      voice.beats.splice(end + 1, 0, ...pad)
    } else if (newTicks > groupTicks) {
      trimFollowingBeats(voice, end + 1, afterStart, newTicks - groupTicks, capacity, beatUnit)
    }
    const nextIdx = mergeRestsInVoice(voice, mb, startTick)
    relink(score)
    refresh(score, settings)
    return clampCursor(score, { ...c, beat: nextIdx })
  }

  relink(score)
  refresh(score, settings)
  return c
}

/**
 * Apply (or toggle off) a `num:den` tuplet. With a multi-beat selection, applies
 * to the selected beats; on a single beat with `keepRhythm` enabled, builds a
 * complete `num`-beat tuplet group and keeps the rest of the bar aligned.
 */
export function applyTuplet(
  score: Score,
  c: EditCursor,
  refs: readonly BeatRef[],
  numerator: number,
  denominator: number,
  keepRhythm: boolean,
  settings: Settings,
): EditCursor {
  const num = Math.min(15, Math.max(2, Math.round(numerator)))
  const den = Math.min(15, Math.max(1, Math.round(denominator)))

  if (refs.length > 1) {
    const byBar = new Map<number, number[]>()
    let allSame = true
    for (const r of refs) {
      const b = beatAt(score, { ...c, bar: r.bar, beat: r.beat })
      if (!b) continue
      if (b.tupletNumerator !== num || b.tupletDenominator !== den) allSame = false
      byBar.set(r.bar, [...(byBar.get(r.bar) ?? []), r.beat])
    }
    for (const [bar, beats] of byBar) {
      const voice = voiceAt(score, { ...c, bar })
      const mb = score.masterBars[bar]
      if (!voice || !mb) continue
      for (const bi of beats) {
        const b = voice.beats[bi]
        if (!b) continue
        if (allSame) {
          b.tupletNumerator = -1
          b.tupletDenominator = -1
        } else {
          b.dots = 0
          b.tupletNumerator = num
          b.tupletDenominator = den
        }
      }
      if (keepRhythm) {
        const capacity = mb.calculateDuration(false)
        const used = voiceTicks(voice)
        if (used < capacity) {
          for (const p of decomposeRests(capacity - used, used, capacity, barBeatUnit(mb))) {
            voice.addBeat(makeRestBeat(p))
          }
        }
        mergeRestsInVoice(voice, mb)
      }
    }
    relink(score)
    refresh(score, settings)
    return clampCursor(score, c)
  }

  const voice = voiceAt(score, c)
  const beat = beatAt(score, c)
  const mb = score.masterBars[c.bar]
  if (!voice || !beat || !mb) return c

  if (beat.tupletNumerator === num && beat.tupletDenominator === den) {
    return clearTuplet(score, c, keepRhythm, settings)
  }

  if (!keepRhythm) {
    beat.tupletNumerator = num
    beat.tupletDenominator = den
    refresh(score, settings)
    return c
  }

  const capacity = mb.calculateDuration(false)
  const beatUnit = barBeatUnit(mb)
  const startTick = beatStartTick(voice, c.beat)
  const room = Math.max(60, capacity - startTick)
  const oldT = beatTicks(beat)

  // Pick a base duration whose complete tuplet group fits inside the remaining bar room.
  let d = beat.duration
  if (Number(d) < 0) d = model.Duration.Whole
  let di = DURATIONS.indexOf(d as (typeof DURATIONS)[number])
  if (di < 0) di = 2 // Quarter
  while (di < DURATIONS.length - 1 && durationTicks(DURATIONS[di]!) * den > room) {
    di++
  }
  d = DURATIONS[di]!
  const groupTicks = durationTicks(d, 0, num, den) * num

  beat.duration = d
  beat.dots = 0
  beat.tupletNumerator = num
  beat.tupletDenominator = den

  const trailing: Beat[] = []
  for (let k = 1; k < num; k++) {
    const rb = makeRestBeat({ duration: d, dots: 0, tupletNum: num, tupletDen: den })
    rb.voice = voice
    trailing.push(rb)
  }
  voice.beats.splice(c.beat + 1, 0, ...trailing)

  const delta = groupTicks - oldT
  if (delta < 0) {
    const gap = decomposeRests(-delta, startTick + groupTicks, capacity, beatUnit).map((p) => {
      const rb = makeRestBeat(p)
      rb.voice = voice
      return rb
    })
    voice.beats.splice(c.beat + num, 0, ...gap)
  } else if (delta > 0) {
    trimFollowingBeats(voice, c.beat + num, startTick + groupTicks, delta, capacity, beatUnit)
  }

  const nextBeatIdx = mergeRestsInVoice(voice, mb, startTick, beat)
  relink(score)
  refresh(score, settings)
  return clampCursor(score, { ...c, beat: nextBeatIdx })
}

// ── Quantize ─────────────────────────────────────────────────────────────

export interface QuantizedEvent {
  start: number
  duration: number
  notes: model.Note[]
  template?: Beat
}

function copyNote(src: model.Note): model.Note {
  const n = new model.Note()
  n.string = src.string
  n.fret = src.fret
  n.percussionArticulation = src.percussionArticulation
  n.isPalmMute = src.isPalmMute
  n.isLetRing = src.isLetRing
  n.isHammerPullOrigin = src.isHammerPullOrigin
  n.slideOutType = src.slideOutType
  n.slideInType = src.slideInType
  n.vibrato = src.vibrato
  n.isDead = src.isDead
  n.isGhost = src.isGhost
  n.harmonicType = src.harmonicType
  n.harmonicValue = src.harmonicValue
  n.isStaccato = src.isStaccato
  n.accentuated = src.accentuated
  n.bendType = src.bendType
  n.isTieDestination = src.isTieDestination
  n.leftHandFinger = src.leftHandFinger
  n.rightHandFinger = src.rightHandFinger
  n.dynamics = src.dynamics
  for (const p of src.bendPoints ?? []) n.addBendPoint(new model.BendPoint(p.offset, p.value))
  return n
}

function makeBeatFromNotes(
  part: RhythmPart,
  notes: readonly model.Note[],
  tieCont: boolean,
  template?: Beat,
): Beat {
  const b = new model.Beat()
  b.duration = part.duration
  b.dots = part.dots
  if (part.tupletNum && part.tupletDen) {
    b.tupletNumerator = part.tupletNum
    b.tupletDenominator = part.tupletDen
  }
  if (template && !tieCont) {
    b.tap = template.tap
    b.slap = template.slap
    b.pop = template.pop
    b.pickStroke = template.pickStroke
    b.fade = template.fade
    b.vibrato = template.vibrato
    b.dynamics = template.dynamics
    b.text = template.text
    b.chordId = template.chordId
  }
  for (const src of notes) {
    const n = copyNote(src)
    if (tieCont) n.isTieDestination = true
    b.addNote(n)
  }
  return b
}

function emitEventBeats(
  out: Beat[],
  start: number,
  dur: number,
  notes: readonly model.Note[],
  capacity: number,
  beatUnit: number,
  template?: Beat,
): void {
  const parts = decomposeDuration(dur, start, capacity, beatUnit)
  parts.forEach((p, idx) => {
    out.push(makeBeatFromNotes(p, notes, idx > 0, template))
  })
}

function buildTripletGridBar(
  events: readonly QuantizedEvent[],
  capacity: number,
  beatUnit: number,
  opt: QuantizeGridOption,
): Beat[] {
  const step = opt.ticks // 320 (1/8T) or 160 (1/16T)
  const [tNum, tDen] = opt.tuplet!
  const dur = opt.baseDuration!
  const out: Beat[] = []
  const byStart = new Map<number, QuantizedEvent>()
  for (const ev of events) byStart.set(ev.start, ev)

  // Process the bar in quarter-note cells (960 ticks = 3 or 6 triplet steps).
  for (let cellStart = 0; cellStart < capacity; cellStart += TICKS_PER_QUARTER) {
    const cellEnd = Math.min(capacity, cellStart + TICKS_PER_QUARTER)
    const cellSpan = cellEnd - cellStart
    const cellEvents = events.filter((ev) => ev.start >= cellStart && ev.start < cellEnd)
    const hasTripletSub = cellEvents.some((ev) => (ev.start - cellStart) % 480 !== 0)
    if (!hasTripletSub) {
      // Straight quarter or eighths inside this cell (never mixes awkward rests).
      if (cellSpan === TICKS_PER_QUARTER) {
        const at0 = byStart.get(cellStart)
        const atMid = byStart.get(cellStart + 480)
        if (!atMid) {
          if (at0) {
            emitEventBeats(out, cellStart, cellSpan, at0.notes, capacity, beatUnit, at0.template)
          } else {
            for (const p of decomposeRests(cellSpan, cellStart, capacity, beatUnit)) {
              out.push(makeRestBeat(p))
            }
          }
          continue
        }
        // Straight eighths inside the quarter cell.
        for (const sub of [cellStart, cellStart + 480]) {
          const ev = byStart.get(sub)
          if (ev) emitEventBeats(out, sub, 480, ev.notes, capacity, beatUnit, ev.template)
          else out.push(makeRestBeat({ duration: model.Duration.Eighth, dots: 0 }))
        }
        continue
      }
      // Partial trailing cell (e.g. 3/8, 5/8, 7/8): emit straight eighth/sixteenth events or rests.
      let pos = cellStart
      for (const ev of cellEvents) {
        if (ev.start > pos) {
          for (const p of decomposeRests(ev.start - pos, pos, capacity, beatUnit)) {
            out.push(makeRestBeat(p))
          }
        }
        const dur = Math.max(60, Math.min(ev.duration, cellEnd - ev.start))
        emitEventBeats(out, ev.start, dur, ev.notes, capacity, beatUnit, ev.template)
        pos = ev.start + dur
      }
      if (pos < cellEnd) {
        for (const p of decomposeRests(cellEnd - pos, pos, capacity, beatUnit)) {
          out.push(makeRestBeat(p))
        }
      }
      continue
    }
    let pos = cellStart
    for (let t = cellStart; t + step <= cellEnd; t += step) {
      const ev = byStart.get(t)
      if (ev) {
        out.push(
          makeBeatFromNotes(
            { duration: dur, dots: 0, tupletNum: tNum, tupletDen: tDen },
            ev.notes,
            false,
            ev.template,
          ),
        )
      } else {
        out.push(makeRestBeat({ duration: dur, dots: 0, tupletNum: tNum, tupletDen: tDen }))
      }
      pos = t + step
    }
    if (pos < cellEnd) {
      for (const p of decomposeRests(cellEnd - pos, pos, capacity, beatUnit)) {
        out.push(makeRestBeat(p))
      }
    }
  }
  return out
}

/**
 * Rebuild one bar's voice from a list of quantized note events (snapped onto
 * `grid` and ordered by `start`), filling gaps with canonical rests and
 * clamping to `capacity`.
 */
export function populateQuantizedBar(
  voice: Voice,
  mb: MasterBar,
  rawEvents: readonly QuantizedEvent[],
  grid: QuantizeGrid,
  isPercussion = false,
): void {
  const capacity = mb.calculateDuration(false)
  const beatUnit = barBeatUnit(mb)
  const opt = quantizeGridOption(grid)
  const step = opt.ticks

  // Snap & merge collisions on the same quantized grid tick.
  const merged = new Map<number, QuantizedEvent>()
  for (const ev of rawEvents) {
    const snapped = Math.min(Math.max(0, Math.round(ev.start / step) * step), capacity - step)
    const existing = merged.get(snapped)
    if (!existing) {
      merged.set(snapped, {
        start: snapped,
        duration: Math.max(step, ev.duration),
        notes: ev.notes.map(copyNote),
        ...(ev.template ? { template: ev.template } : {}),
      })
    } else {
      for (const n of ev.notes) {
        const dup = isPercussion
          ? existing.notes.some((x) => x.percussionArticulation === n.percussionArticulation)
          : existing.notes.some((x) => x.string === n.string)
        if (!dup) existing.notes.push(copyNote(n))
      }
      existing.duration = Math.max(existing.duration, ev.duration)
    }
  }
  const sorted = [...merged.values()].sort((a, b) => a.start - b.start)

  let nextBeats: Beat[]
  if (opt.tuplet) {
    nextBeats = buildTripletGridBar(sorted, capacity, beatUnit, opt)
  } else {
    nextBeats = []
    let cursor = 0
    for (let i = 0; i < sorted.length; i++) {
      const ev = sorted[i]!
      const nextStart = sorted[i + 1]?.start ?? capacity
      if (ev.start > cursor) {
        for (const p of decomposeRests(ev.start - cursor, cursor, capacity, beatUnit)) {
          nextBeats.push(makeRestBeat(p))
        }
      }
      const rawDur = Math.min(ev.duration, nextStart - ev.start, capacity - ev.start)
      const snappedDur = Math.max(step, Math.round(rawDur / step) * step)
      const dur = Math.min(snappedDur, nextStart - ev.start, capacity - ev.start)
      if (dur >= 60) {
        emitEventBeats(nextBeats, ev.start, dur, ev.notes, capacity, beatUnit, ev.template)
        cursor = ev.start + dur
      }
    }
    if (cursor < capacity) {
      for (const p of decomposeRests(capacity - cursor, cursor, capacity, beatUnit)) {
        nextBeats.push(makeRestBeat(p))
      }
    }
  }

  voice.beats.length = 0
  for (const b of nextBeats) voice.addBeat(b)
  mergeRestsInVoice(voice, mb)
}

/**
 * Quantize beats in bars `[fromBar..toBar]` onto `grid` while preserving bar
 * capacity and canonical rests.
 */
export function quantizeBars(
  score: Score,
  c: EditCursor,
  fromBar: number,
  toBar: number,
  grid: QuantizeGrid,
  settings: Settings,
): EditCursor {
  const a = Math.max(0, Math.min(fromBar, toBar))
  const b = Math.min(score.masterBars.length - 1, Math.max(fromBar, toBar))
  const percussion = !!score.tracks[c.track]?.staves[c.staff]?.isPercussion
  for (let bar = a; bar <= b; bar++) {
    const voice = voiceAt(score, { ...c, bar })
    const mb = score.masterBars[bar]
    if (!voice || !mb) continue
    const events: QuantizedEvent[] = []
    let pos = 0
    for (const beat of voice.beats) {
      const t = beatTicks(beat)
      if (!beat.isRest && beat.notes.length > 0 && t > 0) {
        events.push({
          start: pos,
          duration: t,
          notes: beat.notes,
          template: beat,
        })
      }
      pos += t
    }
    populateQuantizedBar(voice, mb, events, grid, percussion)
  }
  relink(score)
  refresh(score, settings)
  return clampCursor(score, c)
}
