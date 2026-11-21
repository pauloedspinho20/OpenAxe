/**
 * Standard MIDI File (SMF format 0 & 1) importer + quantizer (issue #459).
 * Parses raw .mid/.midi bytes, snaps note onsets and durations to a rhythmic
 * grid, detects guitar/bass/drums, assigns playable fingerings, and builds an
 * editable alphaTab Score.
 */
import { model, type Settings } from '@coderline/alphatab'

import { autoFinger } from './fingering'
import { openPitches } from './fretboard'
import {
  populateQuantizedBar,
  type QuantizeGrid,
  type QuantizedEvent,
  quantizeGridOption,
  TICKS_PER_QUARTER,
} from './rhythm'
import { relink } from './scoreEdit'
import { DRUM_KIT, drumIndex, ensureDrumKit } from './scoreOps'
import { placeChord } from './stepEntry'

export interface MidiNoteEvent {
  startTick: number
  durationTicks: number
  pitch: number
  velocity: number
}

export interface MidiTempoEvent {
  tick: number
  bpm: number
}

export interface MidiTimeSigEvent {
  tick: number
  numerator: number
  denominator: number
}

export interface MidiTrackData {
  name: string
  channel: number
  program: number
  notes: MidiNoteEvent[]
}

export interface ParsedMidi {
  format: number
  ticksPerQuarter: number
  tempos: MidiTempoEvent[]
  timeSignatures: MidiTimeSigEvent[]
  tracks: MidiTrackData[]
}

const GUITAR_6 = [64, 59, 55, 50, 45, 40]
const GUITAR_7 = [64, 59, 55, 50, 45, 40, 35]
const BASS_4 = [43, 38, 33, 28]
const BASS_5 = [43, 38, 33, 28, 23]

const GM_DRUM_ALIAS: Record<number, number> = {
  35: 36, // Acoustic Bass Drum -> Kick
  36: 36,
  37: 37,
  38: 38,
  39: 38, // Hand Clap -> Snare
  40: 38, // Electric Snare -> Snare
  41: 41,
  42: 42,
  43: 41, // High Floor Tom -> Floor Tom
  44: 44,
  45: 45,
  46: 46,
  47: 47,
  48: 48,
  49: 49,
  50: 48, // High Tom -> High Tom
  51: 51,
  52: 49, // Chinese Cymbal -> Crash
  53: 51, // Ride Bell -> Ride
  55: 49, // Splash -> Crash
  57: 49, // Crash 2 -> Crash
  59: 51, // Ride 2 -> Ride
}

function mapDrumId(pitch: number): number {
  const direct = GM_DRUM_ALIAS[pitch]
  if (direct !== undefined) return direct
  let best = DRUM_KIT[0]!.id
  let bestDist = Infinity
  for (const k of DRUM_KIT) {
    const d = Math.abs(k.id - pitch)
    if (d < bestDist) {
      bestDist = d
      best = k.id
    }
  }
  return best
}

function readAscii(bytes: Uint8Array, offset: number, len: number): string {
  let s = ''
  for (let i = 0; i < len && offset + i < bytes.length; i++) {
    s += String.fromCharCode(bytes[offset + i]!)
  }
  return s
}

function readU16(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0)
}

function readU32(bytes: Uint8Array, at: number): number {
  return (
    (((bytes[at] ?? 0) << 24) |
      ((bytes[at + 1] ?? 0) << 16) |
      ((bytes[at + 2] ?? 0) << 8) |
      (bytes[at + 3] ?? 0)) >>>
    0
  )
}

function readVlq(bytes: Uint8Array, state: { pos: number }, end: number): number {
  let val = 0
  for (let i = 0; i < 4 && state.pos < end; i++) {
    const b = bytes[state.pos++]!
    val = (val << 7) | (b & 0x7f)
    if ((b & 0x80) === 0) break
  }
  return val
}

/** Parse a Standard MIDI File (format 0 or 1) into tracks, tempos, and meters. */
export function parseMidiFile(bytes: Uint8Array): ParsedMidi {
  if (bytes.length < 14 || readAscii(bytes, 0, 4) !== 'MThd') {
    throw new Error('This file is not a valid MIDI file (missing MThd header).')
  }
  const headerLen = readU32(bytes, 4)
  if (headerLen < 6 || 8 + headerLen > bytes.length) {
    throw new Error('The MIDI header is damaged.')
  }
  const format = readU16(bytes, 8)
  if (format !== 0 && format !== 1) {
    throw new Error(`Unsupported MIDI format (${format}); only format 0 and 1 are supported.`)
  }
  const trackCount = readU16(bytes, 10)
  const division = readU16(bytes, 12)
  if (division === 0 || (division & 0x8000) !== 0) {
    throw new Error('SMPTE timecode MIDI files are not supported (need ticks per beat).')
  }

  const tempos: MidiTempoEvent[] = []
  const timeSignatures: MidiTimeSigEvent[] = []
  const outTracks: MidiTrackData[] = []
  const decoder = new TextDecoder('utf-8')
  let offset = 8 + headerLen

  for (let t = 0; t < trackCount && offset + 8 <= bytes.length; t++) {
    const chunkId = readAscii(bytes, offset, 4)
    const chunkLen = readU32(bytes, offset + 4)
    const start = offset + 8
    const end = Math.min(bytes.length, start + chunkLen)
    offset = end
    if (chunkId !== 'MTrk') {
      t--
      continue
    }

    const state = { pos: start }
    let tick = 0
    let running = 0
    let trackName = ''
    const buckets = new Map<number, { program: number; notes: MidiNoteEvent[] }>()
    const openNotes = new Map<
      string,
      { channel: number; pitch: number; startTick: number; velocity: number }
    >()

    const ensureBucket = (ch: number) => {
      let b = buckets.get(ch)
      if (!b) {
        b = { program: 27, notes: [] }
        buckets.set(ch, b)
      }
      return b
    }

    const closeNote = (ch: number, pitch: number, atTick: number) => {
      const key = `${ch}:${pitch}`
      const open = openNotes.get(key)
      if (!open) return
      openNotes.delete(key)
      ensureBucket(ch).notes.push({
        startTick: open.startTick,
        durationTicks: Math.max(1, atTick - open.startTick),
        pitch,
        velocity: open.velocity,
      })
    }

    while (state.pos < end) {
      tick += readVlq(bytes, state, end)
      if (state.pos >= end) break
      const raw = bytes[state.pos]!
      let status: number
      if (raw >= 0x80) {
        status = raw
        state.pos++
        if (status < 0xf0) running = status
        else running = 0
      } else {
        if (!running) break
        status = running
      }

      if (status === 0xff) {
        if (state.pos >= end) break
        const metaType = bytes[state.pos++]!
        const len = readVlq(bytes, state, end)
        const payloadEnd = Math.min(end, state.pos + len)
        if (metaType === 0x51 && payloadEnd - state.pos >= 3) {
          const us =
            ((bytes[state.pos]! << 16) | (bytes[state.pos + 1]! << 8) | bytes[state.pos + 2]!) >>> 0
          if (us > 0) {
            tempos.push({ tick, bpm: Math.round((60_000_000 / us) * 100) / 100 })
          }
        } else if (metaType === 0x58 && payloadEnd - state.pos >= 2) {
          const num = Math.min(32, Math.max(1, bytes[state.pos]!))
          const den = 1 << Math.min(5, bytes[state.pos + 1]!)
          timeSignatures.push({ tick, numerator: num, denominator: den })
        } else if (metaType === 0x03 && !trackName) {
          trackName = decoder.decode(bytes.subarray(state.pos, payloadEnd)).trim()
        } else if (metaType === 0x2f) {
          state.pos = payloadEnd
          break
        }
        state.pos = payloadEnd
        continue
      }

      if (status === 0xf0 || status === 0xf7) {
        const len = readVlq(bytes, state, end)
        state.pos = Math.min(end, state.pos + len)
        continue
      }

      const cmd = status & 0xf0
      const ch = status & 0x0f
      if (state.pos >= end) break
      const data1 = bytes[state.pos++]!

      if (cmd === 0xc0) {
        ensureBucket(ch).program = data1 & 0x7f
        continue
      }
      if (cmd === 0xd0) {
        continue
      }
      if (state.pos >= end) break
      const data2 = bytes[state.pos++]!

      if (cmd === 0x80) {
        closeNote(ch, data1 & 0x7f, tick)
      } else if (cmd === 0x90) {
        const pitch = data1 & 0x7f
        const vel = data2 & 0x7f
        if (vel === 0) {
          closeNote(ch, pitch, tick)
        } else {
          closeNote(ch, pitch, tick)
          openNotes.set(`${ch}:${pitch}`, {
            channel: ch,
            pitch,
            startTick: tick,
            velocity: vel,
          })
        }
      }
    }

    // Close any hanging notes at track end.
    for (const open of openNotes.values()) {
      ensureBucket(open.channel).notes.push({
        startTick: open.startTick,
        durationTicks: Math.max(division, tick - open.startTick),
        pitch: open.pitch,
        velocity: open.velocity,
      })
    }

    const nonEmpty = [...buckets.entries()].filter(([, b]) => b.notes.length > 0)
    for (const [ch, bucket] of nonEmpty) {
      bucket.notes.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch)
      const label =
        trackName && nonEmpty.length === 1
          ? trackName
          : ch === 9
            ? trackName
              ? `${trackName} (Drums)`
              : 'Drums'
            : trackName
              ? `${trackName} (ch ${ch + 1})`
              : `Track ${outTracks.length + 1}`
      outTracks.push({
        name: label,
        channel: ch,
        program: bucket.program,
        notes: bucket.notes,
      })
    }
  }

  tempos.sort((a, b) => a.tick - b.tick)
  timeSignatures.sort((a, b) => a.tick - b.tick)
  return {
    format,
    ticksPerQuarter: division,
    tempos,
    timeSignatures,
    tracks: outTracks,
  }
}

function fitPitchToRange(pitch: number, minOpen: number, maxOpen: number): number {
  let p = pitch
  while (p < minOpen) p += 12
  while (p > maxOpen + 24) p -= 12
  return p
}

function pickInstrument(mt: MidiTrackData): {
  percussion: boolean
  tunings: number[]
  program: number
} {
  if (mt.channel === 9) {
    return { percussion: true, tunings: [], program: 0 }
  }
  const pitches = mt.notes.map((n) => n.pitch)
  const minPitch = Math.min(...pitches)
  const maxPitch = Math.max(...pitches)
  const looksBass = (mt.program >= 32 && mt.program <= 39) || (maxPitch <= 67 && minPitch < 40)
  if (looksBass) {
    return {
      percussion: false,
      tunings: minPitch < 28 ? BASS_5 : BASS_4,
      program: mt.program >= 32 && mt.program <= 39 ? mt.program : 33,
    }
  }
  return {
    percussion: false,
    tunings: minPitch >= 35 && minPitch < 40 ? GUITAR_7 : GUITAR_6,
    program: mt.program,
  }
}

export interface MidiImportOptions {
  grid?: QuantizeGrid
  title?: string
}

/**
 * Convert raw `.mid`/`.midi` bytes into an editable alphaTab `Score`,
 * quantized onto `options.grid` (default `'1/16'`).
 */
export function importMidiToScore(
  bytes: Uint8Array,
  settings: Settings,
  options: MidiImportOptions = {},
): model.Score {
  const parsed = parseMidiFile(bytes)
  const grid = options.grid ?? '1/16'
  const step = quantizeGridOption(grid).ticks
  const scale = TICKS_PER_QUARTER / parsed.ticksPerQuarter

  const tempos = parsed.tempos.map((t) => ({
    tick: Math.round(t.tick * scale),
    bpm: Math.min(400, Math.max(20, Math.round(t.bpm))),
  }))
  const timeSigs = parsed.timeSignatures.map((ts) => ({
    tick: Math.round(ts.tick * scale),
    numerator: ts.numerator,
    denominator: ts.denominator,
  }))

  // Quantize every track's note starts and durations onto the score grid.
  const tracks = parsed.tracks.length
    ? parsed.tracks
    : [{ name: 'Guitar', channel: 0, program: 27, notes: [] }]
  // Load alphaTab's default drum table before allocating any Score nodes,
  // because its internal GP7 round-trip resets global Bar/Voice/Beat IDs.
  if (tracks.some((t) => t.channel === 9)) ensureDrumKit(settings)

  const quantizedTracks = tracks.map((mt) =>
    mt.notes.map((n, id) => {
      const start = Math.max(0, Math.round((n.startTick * scale) / step) * step)
      const dur = Math.max(step, Math.round((n.durationTicks * scale) / step) * step)
      return { id, start, dur, pitch: n.pitch }
    }),
  )

  let maxEndTick = 0
  for (const list of quantizedTracks) {
    for (const n of list) maxEndTick = Math.max(maxEndTick, n.start + n.dur)
  }

  // Build master bars covering the entire piece.
  const score = new model.Score()
  score.title = options.title || parsed.tracks[0]?.name || 'MIDI Import'
  const initialTempo = tempos[0]?.bpm ?? 120

  const barBounds: { start: number; end: number; capacity: number }[] = []
  let barTick = 0
  let curNum = timeSigs[0]?.tick === 0 ? timeSigs[0].numerator : 4
  let curDen = timeSigs[0]?.tick === 0 ? timeSigs[0].denominator : 4
  let tsIdx = timeSigs[0]?.tick === 0 ? 1 : 0
  let tmIdx = 0

  while (barBounds.length === 0 || (barTick < maxEndTick && barBounds.length < 2000)) {
    while (tsIdx < timeSigs.length && timeSigs[tsIdx]!.tick <= barTick) {
      curNum = timeSigs[tsIdx]!.numerator
      curDen = timeSigs[tsIdx]!.denominator
      tsIdx++
    }
    const mb = new model.MasterBar()
    mb.timeSignatureNumerator = curNum
    mb.timeSignatureDenominator = curDen
    const cap = Math.round((3840 * curNum) / curDen)
    if (barBounds.length === 0) {
      const bpm = tempos[0]?.tick === 0 ? tempos[0].bpm : initialTempo
      mb.tempoAutomations.push(model.Automation.buildTempoAutomation(false, 0, bpm, 0))
      if (tempos[0]?.tick === 0) tmIdx = 1
    }
    while (tmIdx < tempos.length && tempos[tmIdx]!.tick < barTick + cap) {
      const tm = tempos[tmIdx++]!
      const ratio = Math.min(0.99, Math.max(0, (tm.tick - barTick) / Math.max(1, cap)))
      if (!(barBounds.length === 0 && ratio === 0)) {
        mb.tempoAutomations.push(model.Automation.buildTempoAutomation(false, ratio, tm.bpm, 0))
      }
    }
    score.addMasterBar(mb)
    barBounds.push({ start: barTick, end: barTick + cap, capacity: cap })
    barTick += cap
  }

  // Build each track + staff + bars.
  const usedChannels = new Set<number>()
  tracks.forEach((mt, tIndex) => {
    const inst = pickInstrument(mt)
    const track = new model.Track()
    track.name = mt.name || `Track ${tIndex + 1}`
    track.shortName = track.name.slice(0, 5)
    track.playbackInfo.program = inst.program
    if (inst.percussion) {
      track.playbackInfo.primaryChannel = 9
      track.playbackInfo.secondaryChannel = 9
    } else {
      let ch = mt.channel !== 9 && !usedChannels.has(mt.channel) ? mt.channel : 0
      while (ch === 9 || usedChannels.has(ch)) ch++
      usedChannels.add(ch)
      track.playbackInfo.primaryChannel = ch
      track.playbackInfo.secondaryChannel = ch + 1 === 9 ? 10 : ch
    }
    score.addTrack(track)
    track.ensureStaveCount(1)
    const staff = track.staves[0]!
    if (inst.percussion) {
      staff.isPercussion = true
      staff.showTablature = false
      staff.showStandardNotation = true
    } else {
      staff.stringTuning.tunings = [...inst.tunings]
      staff.showTablature = true
      staff.showStandardNotation = true
    }

    const qNotes = quantizedTracks[tIndex]!

    // For melodic tracks, compute playable string/fret for every note onset
    // first, then feed them through autoFinger so the passage flows naturally.
    const posById = new Map<number, { string: number; fret: number }>()
    if (!inst.percussion && qNotes.length) {
      const open = openPitches(inst.tunings)
      const minOpen = Math.min(...open.slice(1))
      const maxOpen = Math.max(...open.slice(1))
      const byStart = new Map<number, typeof qNotes>()
      for (const n of qNotes) {
        const list = byStart.get(n.start) ?? []
        list.push(n)
        byStart.set(n.start, list)
      }
      const onsetTimes = [...byStart.keys()].sort((a, b) => a - b)
      const onsetIds: number[][] = []
      const initialPos: { string: number; fret: number }[][] = []
      let near: number | null = null
      for (const t of onsetTimes) {
        const group = byStart.get(t)!
        const pitches = group.map((n) => fitPitchToRange(n.pitch, minOpen, maxOpen))
        const placed = placeChord(inst.tunings, pitches, 1, 24, near)
        if (placed.length) near = Math.max(...placed.map((p) => p.fret))
        const ids: number[] = []
        const posList: { string: number; fret: number }[] = []
        const usedIdx = new Set<number>()
        for (const pos of placed) {
          const placedPitch = open[pos.string]! + pos.fret
          const idx = group.findIndex(
            (n, gi) =>
              !usedIdx.has(gi) && fitPitchToRange(n.pitch, minOpen, maxOpen) === placedPitch,
          )
          if (idx >= 0) {
            usedIdx.add(idx)
            ids.push(group[idx]!.id)
            posList.push(pos)
          }
        }
        if (posList.length) {
          onsetIds.push(ids)
          initialPos.push(posList)
        }
      }
      const fingered = initialPos.length ? autoFinger(inst.tunings, initialPos) : []
      fingered.forEach((group, gi) => {
        group.forEach((pos, pi) => {
          const id = onsetIds[gi]?.[pi]
          if (id !== undefined) posById.set(id, pos)
        })
      })
    }

    // Slice notes across bar boundaries into per-bar events.
    const perBar: Map<number, { start: number; dur: number; notes: model.Note[] }>[] =
      barBounds.map(() => new Map())

    let bCursor = 0
    for (const n of qNotes) {
      while (bCursor < barBounds.length && barBounds[bCursor]!.end <= n.start) bCursor++
      const end = n.start + n.dur
      for (let bi = bCursor; bi < barBounds.length; bi++) {
        const bb = barBounds[bi]!
        if (bb.start >= end) break
        const localStart = Math.max(0, n.start - bb.start)
        const localEnd = Math.min(bb.capacity, end - bb.start)
        const localDur = Math.max(step, localEnd - localStart)
        if (localEnd - localStart < 60) continue

        const note = new model.Note()
        if (inst.percussion) {
          note.percussionArticulation = drumIndex(track, mapDrumId(n.pitch), settings)
        } else {
          const pos = posById.get(n.id)
          if (!pos) continue
          note.string = pos.string
          note.fret = pos.fret
          if (bb.start > n.start) note.isTieDestination = true
        }

        const bucket = perBar[bi]!
        const existing = bucket.get(localStart)
        if (!existing) {
          bucket.set(localStart, { start: localStart, dur: localDur, notes: [note] })
        } else {
          const dup = inst.percussion
            ? existing.notes.some((x) => x.percussionArticulation === note.percussionArticulation)
            : existing.notes.some((x) => x.string === note.string)
          if (!dup) existing.notes.push(note)
          existing.dur = Math.max(existing.dur, localDur)
        }
      }
    }

    // Build alphaTab Bars and Voices.
    for (let bi = 0; bi < barBounds.length; bi++) {
      const mb = score.masterBars[bi]!
      const bar = new model.Bar()
      staff.addBar(bar)
      const voice = new model.Voice()
      bar.addVoice(voice)
      const events: QuantizedEvent[] = [...perBar[bi]!.values()].map((ev) => ({
        start: ev.start,
        duration: ev.dur,
        notes: ev.notes,
      }))
      populateQuantizedBar(voice, mb, events, grid, inst.percussion)
    }
  })

  relink(score)
  score.finish(settings)
  return score
}
