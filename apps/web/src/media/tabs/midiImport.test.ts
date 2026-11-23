// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { exporter, importer, midi, Settings } from '@coderline/alphatab'

import { importMidiToScore, parseMidiFile } from './midiImport'
import { barFill, startCursor } from './scoreEdit'
import { drumId } from './scoreOps'

function encodeVlq(v: number): number[] {
  const bytes = [v & 0x7f]
  let n = v >>> 7
  while (n > 0) {
    bytes.unshift((n & 0x7f) | 0x80)
    n >>>= 7
  }
  return bytes
}

function buildSmf(format: number, division: number, trackEvents: number[][]): Uint8Array {
  const chunks: number[] = [
    0x4d,
    0x54,
    0x68,
    0x64, // MThd
    0,
    0,
    0,
    6,
    (format >> 8) & 0xff,
    format & 0xff,
    (trackEvents.length >> 8) & 0xff,
    trackEvents.length & 0xff,
    (division >> 8) & 0xff,
    division & 0xff,
  ]
  for (const ev of trackEvents) {
    const body = [...ev, 0x00, 0xff, 0x2f, 0x00]
    chunks.push(
      0x4d,
      0x54,
      0x72,
      0x6b, // MTrk
      (body.length >>> 24) & 0xff,
      (body.length >>> 16) & 0xff,
      (body.length >>> 8) & 0xff,
      body.length & 0xff,
      ...body,
    )
  }
  return new Uint8Array(chunks)
}

function noteEvents(
  channel: number,
  notes: { start: number; dur: number; pitch: number; vel?: number }[],
): number[] {
  const evs: { tick: number; bytes: number[] }[] = []
  for (const n of notes) {
    evs.push({ tick: n.start, bytes: [0x90 | channel, n.pitch, n.vel ?? 100] })
    evs.push({ tick: n.start + n.dur, bytes: [0x80 | channel, n.pitch, 0] })
  }
  evs.sort((a, b) => a.tick - b.tick)
  const out: number[] = []
  let last = 0
  for (const e of evs) {
    out.push(...encodeVlq(e.tick - last), ...e.bytes)
    last = e.tick
  }
  return out
}

describe('midiImport', () => {
  it('round-trips a score exported through alphaTab MidiFileGenerator', () => {
    const settings = new Settings()
    const imp = new importer.AlphaTexImporter()
    imp.initFromString(
      '\\tempo 132\n\\track "Lead"\n\\staff {tabs}\n\\tuning (E4 B3 G3 D3 A2 E2)\n0.6.4 3.6.4 5.6.4 7.6.4 | 8.6.2 10.6.2',
      settings,
    )
    const src = imp.readScore()
    const mf = new midi.MidiFile()
    const gen = new midi.MidiFileGenerator(
      src,
      settings,
      new midi.AlphaSynthMidiFileHandler(mf, true),
    )
    gen.generate()

    const imported = importMidiToScore(mf.toBinary(), settings, {
      grid: '1/16',
      title: 'Lead Riff',
    })
    expect(imported.title).toBe('Lead Riff')
    expect(imported.tempo).toBe(132)
    expect(imported.masterBars.length).toBe(2)
    const pitches = imported.tracks[0]!.staves[0]!.bars[0]!.voices[0]!.beats.filter(
      (b) => !b.isRest,
    ).map((b) => b.notes[0]!.realValue)
    expect(pitches).toEqual([40, 43, 45, 47])

    // GP7 round-trip succeeds cleanly.
    const gpBytes = new exporter.Gp7Exporter().export(imported, settings)
    const reloaded = importer.ScoreLoader.loadScoreFromBytes(gpBytes, settings)
    expect(reloaded.masterBars.length).toBe(2)
  })

  it('quantizes jittered format-1 MIDI with guitar, bass, drums and barline ties', () => {
    // 480 TPQ: 1 quarter = 480, 1 bar of 4/4 = 1920.
    // Tempo 110 BPM (545454 us/beat = 0x08 0x52 0xae), 4/4.
    const metaTrack = [
      0x00, 0xff, 0x51, 0x03, 0x08, 0x52, 0xae, 0x00, 0xff, 0x58, 0x04, 4, 2, 24, 8,
    ]
    // Guitar on ch 0: slightly off-grid notes + a note crossing bar 1 -> bar 2.
    const gtrTrack = [
      0x00,
      0xc0,
      29, // overdriven guitar
      ...noteEvents(0, [
        { start: 18, dur: 465, pitch: 52 }, // snaps to 0, quarter
        { start: 470, dur: 245, pitch: 55 }, // snaps to 1/4, eighth
        { start: 1690, dur: 480, pitch: 57 }, // starts beat 4.5 (1680), crosses barline into bar 2
      ]),
    ]
    // Bass on ch 1 (program 33): low notes.
    const bassTrack = [0x00, 0xc1, 33, ...noteEvents(1, [{ start: 10, dur: 940, pitch: 28 }])]
    // Drums on ch 9: kick (36) + snare (38).
    const drumTrack = noteEvents(9, [
      { start: 0, dur: 120, pitch: 36 },
      { start: 485, dur: 120, pitch: 38 },
    ])

    const bytes = buildSmf(1, 480, [metaTrack, gtrTrack, bassTrack, drumTrack])
    const settings = new Settings()
    const score = importMidiToScore(bytes, settings, { grid: '1/16', title: 'Demo' })

    expect(score.tempo).toBe(110)
    expect(score.tracks).toHaveLength(3)
    expect(score.tracks[1]!.staves[0]!.stringTuning.tunings).toEqual([43, 38, 33, 28])
    expect(score.tracks[2]!.staves[0]!.isPercussion).toBe(true)

    // Every bar of every track has exact bar capacity (3840).
    for (let ti = 0; ti < score.tracks.length; ti++) {
      for (let bi = 0; bi < score.masterBars.length; bi++) {
        expect(barFill(score, { ...startCursor(ti), bar: bi })).toEqual({
          used: 3840,
          capacity: 3840,
        })
      }
    }

    // Tied continuation in bar 2 of guitar keeps tie destination flag and survives GP7 export.
    const bar2Beats = score.tracks[0]!.staves[0]!.bars[1]!.voices[0]!.beats
    expect(bar2Beats[0]!.notes[0]!.isTieDestination).toBe(true)

    const gpBytes = new exporter.Gp7Exporter().export(score, settings)
    const reloaded = importer.ScoreLoader.loadScoreFromBytes(gpBytes, settings)
    expect(reloaded.tracks[2]!.staves[0]!.isPercussion).toBe(true)
    const drumBeat0 = reloaded.tracks[2]!.staves[0]!.bars[0]!.voices[0]!.beats[0]!
    expect(drumId(reloaded.tracks[2]!, drumBeat0.notes[0]!)).toBe(36)
  })

  it('splits format-0 multi-channel MIDI and rejects invalid or SMPTE files', () => {
    const bytes = buildSmf(0, 480, [
      [
        ...noteEvents(0, [{ start: 0, dur: 480, pitch: 64 }]),
        ...noteEvents(9, [{ start: 0, dur: 240, pitch: 38 }]),
      ],
    ])
    const parsed = parseMidiFile(bytes)
    expect(parsed.format).toBe(0)
    expect(parsed.tracks).toHaveLength(2)
    expect(parsed.tracks.some((t) => t.channel === 9)).toBe(true)

    expect(() => parseMidiFile(new Uint8Array([1, 2, 3, 4]))).toThrow(/MThd/)
    // SMPTE division (high bit set: 0xe728).
    const smpte = buildSmf(0, 0xe728, [[]])
    expect(() => parseMidiFile(smpte)).toThrow(/SMPTE/)
  })
})
