// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { exporter, importer, midi, model, Settings } from '@coderline/alphatab'

import { startCursor } from './scoreEdit'
import {
  addGraceNote,
  addTrack,
  drumId,
  duplicateTrack,
  moveTrack,
  setTrackMix,
  copyRange,
  deleteRange,
  DRUM_KIT,
  ensureVoice,
  INSTRUMENTS,
  moveRangeString,
  newSongTex,
  paste,
  rangeBeats,
  removeTrack,
  setBarGrid,
  setBend,
  setCapo,
  setChord,
  setDynamics,
  setSection,
  setSlide,
  setTremolo,
  setTrill,
  setTuning,
  toggleDrumHit,
  transposeRange,
  barSpan,
  deleteBars,
  insertBars,
  moveBars,
  setRepeat,
  setTimeSignatureFrom,
  insertVoicing,
} from './scoreOps'

function load(tex: string) {
  const settings = new Settings()
  const imp = new importer.AlphaTexImporter()
  imp.initFromString(tex, settings)
  return { score: imp.readScore(), settings }
}
const GTR = '\\track "G"\n\\staff {tabs}\n\\tuning (E4 B3 G3 D3 A2 E2)\n'
const roundTrip = (score: model.Score, settings: Settings) =>
  importer.ScoreLoader.loadScoreFromBytes(
    new exporter.Gp7Exporter().export(score, settings),
    settings,
  )
const frets = (score: model.Score, bar: number, track = 0, voice = 0) =>
  score.tracks[track]!.staves[0]!.bars[bar]!.voices[voice]!.beats.map((b) =>
    b.isRest ? 'r' : b.notes.map((n) => `${n.string}:${n.fret}`).join(','),
  )

describe('scoreOps: ranges and clipboard', () => {
  it('copies and pastes beats, replacing an empty bar', () => {
    const { score, settings } = load(GTR + '3.6.4 5.6.4 7.6.4 8.6.4 | r.1')
    const c = startCursor()
    const refs = rangeBeats(score, c, { bar: 0, beat: 2 }, { bar: 0, beat: 1 })
    expect(refs).toEqual([
      { bar: 0, beat: 1 },
      { bar: 0, beat: 2 },
    ])
    const clip = copyRange(score, c, refs)!
    expect(clip.kind).toBe('beats')
    paste(score, { ...c, bar: 1, beat: 0 }, clip, settings)
    expect(frets(score, 1)).toEqual(['1:5', '1:7'])
  })

  it('copies whole bars and pastes them as new bars in every track', () => {
    const { score, settings } = load(
      GTR + '3.6.2 5.6.2 | 7.6.1\n\\track "B"\n\\staff {tabs}\n0.4.1 | 2.4.1',
    )
    const c = startCursor()
    const clip = copyRange(
      score,
      c,
      rangeBeats(score, c, { bar: 0, beat: 0 }, { bar: 0, beat: 1 }),
    )!
    expect(clip.kind).toBe('bars')
    paste(score, c, clip, settings)
    expect(score.masterBars.length).toBe(3)
    expect(frets(score, 1)).toEqual(['1:3', '1:5'])
    expect(frets(score, 1, 1)).toEqual(['r'])
    expect(frets(roundTrip(score, settings), 1)).toEqual(['1:3', '1:5'])
  })

  it('deletes a range across bars, leaving rests in emptied bars', () => {
    const { score, settings } = load(GTR + '3.6.2 5.6.2 | 7.6.2 8.6.2')
    const c = startCursor()
    const next = deleteRange(
      score,
      c,
      rangeBeats(score, c, { bar: 0, beat: 1 }, { bar: 1, beat: 1 }),
      settings,
    )
    expect(frets(score, 0)).toEqual(['1:3'])
    expect(frets(score, 1)).toEqual(['r'])
    // Bar 1 now has one beat, so the cursor clamps onto it.
    expect(next).toMatchObject({ bar: 0, beat: 0 })
  })

  it('transposes and moves a range between strings keeping pitch', () => {
    const { score, settings } = load(GTR + '5.6.4 7.5.4 r.2')
    const c = startCursor()
    const refs = rangeBeats(score, c, { bar: 0, beat: 0 }, { bar: 0, beat: 1 })
    transposeRange(score, c, refs, 2, settings)
    expect(frets(score, 0)).toEqual(['1:7', '2:9', 'r'])
    // low E fret 7 (B) -> A string fret 2; A fret 9 (F#) -> D string fret 4
    moveRangeString(score, c, refs, 1, settings)
    expect(frets(score, 0)).toEqual(['2:2', '3:4', 'r'])
  })
})

describe('scoreOps: tracks and songs', () => {
  it('adds guitar, bass and drum tracks with distinct channels, then removes one', () => {
    const { score, settings } = load(GTR + '3.6.1 | r.1')
    addTrack(
      score,
      INSTRUMENTS.find((i) => i.id === 'bass-4')!,
      'Bass',
      settings,
    )
    addTrack(
      score,
      INSTRUMENTS.find((i) => i.id === 'drums')!,
      'Drums',
      settings,
    )
    const ch = score.tracks.map((t) => t.playbackInfo.primaryChannel)
    expect(ch[2]).toBe(9)
    expect(new Set(ch).size).toBe(3)
    expect(score.tracks[1]!.staves[0]!.bars.length).toBe(2)
    const back = roundTrip(score, settings)
    expect(back.tracks.map((t) => t.name)).toEqual(['G', 'Bass', 'Drums'])
    expect(back.tracks[2]!.staves[0]!.isPercussion).toBe(true)
    removeTrack(score, 1, settings)
    expect(score.tracks.map((t) => [t.name, t.index])).toEqual([
      ['G', 0],
      ['Drums', 1],
    ])
  })

  it('retunes (dropping notes on removed strings) and sets the capo', () => {
    const { score, settings } = load(GTR + '(3.1 5.6).1')
    setTuning(score, 0, [43, 38, 33, 28], settings)
    expect(frets(score, 0)).toEqual(['1:5'])
    setCapo(score, 0, 3, settings)
    expect(roundTrip(score, settings).tracks[0]!.staves[0]!.capo).toBe(3)
  })

  it('builds a parseable new song', () => {
    for (const inst of INSTRUMENTS) {
      const { score } = load(
        newSongTex({
          title: 'New "One"',
          artist: 'Me',
          tempo: 90,
          numerator: 3,
          denominator: 4,
          bars: 8,
          instrument: inst,
        }),
      )
      expect(score.title).toBe('New "One"')
      expect(score.masterBars.length).toBe(8)
      expect(score.masterBars[0]!.timeSignatureNumerator).toBe(3)
      expect(score.tracks[0]!.staves[0]!.isPercussion).toBe(!!inst.percussion)
    }
  })
})

describe('scoreOps: notation tools', () => {
  it('applies bends, slides, tremolo, trill, grace, chord, section, dynamics and survives export', () => {
    const { score, settings } = load(GTR + '(3.6 2.5 0.4 0.3 0.2 3.1).4 7.3.4 7.3.4 7.3.4')
    const c = startCursor()
    setChord(score, c, 'G', settings)
    const b1 = { ...c, beat: 1, string: 4 }
    setBend(score, b1, 'bendRelease', settings)
    setSlide(score, b1, 'inBelow', settings)
    setTrill(score, { ...c, beat: 2, string: 4 }, 9, settings)
    setTremolo(score, { ...c, beat: 3 }, 2, settings)
    setDynamics(score, { ...c, beat: 3 }, 'FF', settings)
    const after = addGraceNote(score, { ...c, beat: 3, string: 4 }, 5, settings)
    expect(after.beat).toBe(4)
    setSection(score, 0, 'Intro', settings)

    const back = roundTrip(score, settings)
    const staff = back.tracks[0]!.staves[0]!
    const beats = staff.bars[0]!.voices[0]!.beats
    expect(staff.getChord(beats[0]!.chordId!)?.name).toBe('G')
    expect(staff.getChord(beats[0]!.chordId!)?.strings).toEqual([3, 0, 0, 0, 2, 3])
    expect(beats[1]!.notes[0]!.bendType).toBe(model.BendType.BendRelease)
    expect(beats[1]!.notes[0]!.slideInType).toBe(model.SlideInType.IntoFromBelow)
    expect(beats[2]!.notes[0]!.isTrill).toBe(true)
    expect(beats[3]!.graceType).toBe(model.GraceType.BeforeBeat)
    expect(beats[4]!.tremoloPicking?.marks).toBe(2)
    expect(beats[4]!.dynamics).toBe(model.DynamicValue.FF)
    expect(back.masterBars[0]!.section?.text).toBe('Intro')
    // SMF1 export copes with the bend/trill events.
    const file = new midi.MidiFile()
    new midi.MidiFileGenerator(
      back,
      settings,
      new midi.AlphaSynthMidiFileHandler(file, true),
    ).generate()
    expect(file.toBinary().length).toBeGreaterThan(100)
  })
})

describe('scoreOps: voices and drums', () => {
  it('adds a second voice to every bar', () => {
    const { score, settings } = load(GTR + '3.6.1 | 5.6.1')
    const c = ensureVoice(score, startCursor(), 1, settings)
    expect(c.voice).toBe(1)
    expect(score.tracks[0]!.staves[0]!.bars.every((b) => b.voices.length === 2)).toBe(true)
    expect(roundTrip(score, settings).tracks[0]!.staves[0]!.bars[1]!.voices.length).toBe(2)
  })

  it('grids a drum bar and toggles hits', () => {
    const { score, settings } = load(GTR + 'r.1')
    const t = addTrack(
      score,
      INSTRUMENTS.find((i) => i.id === 'drums')!,
      'Drums',
      settings,
    )
    const c = { ...startCursor(t) }
    setBarGrid(score, c, model.Duration.Eighth, settings)
    expect(score.tracks[t]!.staves[0]!.bars[0]!.voices[0]!.beats.length).toBe(8)
    const kick = DRUM_KIT.find((d) => d.label === 'Kick')!.id
    expect(toggleDrumHit(score, c, 0, kick, settings)).toBe(true)
    toggleDrumHit(score, c, 0, 42, settings)
    toggleDrumHit(score, c, 4, 38, settings)
    expect(toggleDrumHit(score, c, 0, 42, settings)).toBe(false)
    setBarGrid(score, c, model.Duration.Sixteenth, settings)
    const beats = score.tracks[t]!.staves[0]!.bars[0]!.voices[0]!.beats
    expect(beats.length).toBe(16)
    const drums = score.tracks[t]!
    expect(beats[0]!.notes.map((n) => drumId(drums, n))).toEqual([kick])
    expect(beats[8]!.notes.map((n) => drumId(drums, n))).toEqual([38])
    // After a .gp save the hits must still sound as kick/snare (GM 36/38), not
    // whatever sits at that index of the default articulation table.
    const back = roundTrip(score, settings)
    const backDrums = back.tracks[t]!
    const backBeats = backDrums.staves[0]!.bars[0]!.voices[0]!.beats
    expect(drumId(backDrums, backBeats[8]!.notes[0]!)).toBe(38)
    const file = new midi.MidiFile()
    new midi.MidiFileGenerator(
      back,
      settings,
      new midi.AlphaSynthMidiFileHandler(file, true),
    ).generate()
    const keys = file.tracks
      .flatMap((tr) => tr.events)
      .filter((e) => e.type === 0x90 && (e as unknown as { channel: number }).channel === 9)
      .map((e) => (e as unknown as { noteKey: number }).noteKey)
    expect(keys).toEqual([36, 38])
  })
})

describe('scoreOps: track list', () => {
  it('reorders, duplicates and mixes tracks, all surviving a .gp save', () => {
    const { score, settings } = load(
      '\\track "A"\n\\staff {tabs}\n3.6.1 | 5.6.1\n\\track "B"\n\\staff {tabs}\n7.6.1 | 9.6.1',
    )
    moveTrack(score, 1, 0, settings)
    expect(score.tracks.map((t) => [t.name, t.index])).toEqual([
      ['B', 0],
      ['A', 1],
    ])
    const copy = duplicateTrack(score, 0, settings)
    expect(copy).toBe(1)
    expect(score.tracks.map((t) => t.name)).toEqual(['B', 'B (copy)', 'A'])
    expect(frets(score, 1, 1)).toEqual(['1:9'])
    const channels = score.tracks.map((t) => t.playbackInfo.primaryChannel)
    expect(new Set(channels).size).toBe(3)
    setTrackMix(score, 2, { volume: 9, balance: 3 }, settings)
    const back = roundTrip(score, settings)
    expect(back.tracks.map((t) => t.name)).toEqual(['B', 'B (copy)', 'A'])
    expect(frets(back, 0, 1)).toEqual(['1:7'])
    expect([back.tracks[2]!.playbackInfo.volume, back.tracks[2]!.playbackInfo.balance]).toEqual([
      9, 3,
    ])
  })
})

describe('scoreOps: multi-bar operations', () => {
  const four = GTR + '1.6.1 | 2.6.1 | 3.6.1 | 4.6.1'
  const firsts = (score: model.Score) => score.masterBars.map((_, i) => frets(score, i)[0])

  it('inserts and deletes several bars', () => {
    const { score, settings } = load(four)
    expect(insertBars(score, 1, 3, settings)).toBe(2)
    expect(firsts(score)).toEqual(['1:1', '1:2', 'r', 'r', 'r', '1:3', '1:4'])
    deleteBars(score, 4, 2, settings)
    expect(firsts(score)).toEqual(['1:1', '1:2', '1:3', '1:4'])
    deleteBars(score, 0, 10, settings)
    expect(score.masterBars.length).toBe(1)
  })

  it('moves a block of bars, keeping their settings', () => {
    const { score, settings } = load(four)
    score.masterBars[1]!.isRepeatStart = true
    expect(moveBars(score, 1, 2, 1, settings)).toBe(2)
    expect(firsts(score)).toEqual(['1:1', '1:4', '1:2', '1:3'])
    expect(score.masterBars[2]!.isRepeatStart).toBe(true)
    expect(moveBars(score, 2, 3, -5, settings)).toBe(0)
    expect(firsts(score)).toEqual(['1:2', '1:3', '1:1', '1:4'])
    // Still a valid, linked score.
    expect(score.masterBars.map((m) => m.index)).toEqual([0, 1, 2, 3])
    expect(score.masterBars[1]!.previousMasterBar).toBe(score.masterBars[0])
  })

  it('changes the time signature up to the next change', () => {
    const { score, settings } = load(four)
    score.masterBars[3]!.timeSignatureNumerator = 3
    setTimeSignatureFrom(score, 1, 6, 8, settings)
    expect(
      score.masterBars.map((m) => `${m.timeSignatureNumerator}/${m.timeSignatureDenominator}`),
    ).toEqual(['4/4', '6/8', '6/8', '3/4'])
  })

  it('repeats a span N times and spans a selection', () => {
    const { score, settings } = load(four)
    setRepeat(score, 2, 1, 3, settings)
    expect(score.masterBars[1]!.isRepeatStart).toBe(true)
    expect(score.masterBars[2]!.repeatCount).toBe(3)
    setRepeat(score, 1, 2, 1, settings)
    expect(score.masterBars[1]!.isRepeatStart).toBe(false)
    expect(score.masterBars[2]!.repeatCount).toBe(0)
    const c = startCursor()
    expect(barSpan({ ...c, bar: 2 }, [])).toEqual([2, 2])
    expect(
      barSpan(c, [
        { bar: 3, beat: 0 },
        { bar: 1, beat: 2 },
      ]),
    ).toEqual([1, 3])
  })
})

describe('scoreOps: chord voicings', () => {
  it('writes a voicing into the beat with a named diagram', () => {
    const { score, settings } = load(GTR + '3.6.4 5.6.4 7.6.4 8.6.4')
    const c = startCursor()
    insertVoicing(score, c, [-1, 0, 2, 2, 1, 0], 'Am', settings)
    expect(frets(score, 0)[0]).toBe('2:0,3:2,4:2,5:1,6:0')
    const beat = score.tracks[0]!.staves[0]!.bars[0]!.voices[0]!.beats[0]!
    const chord = score.tracks[0]!.staves[0]!.getChord(beat.chordId!)
    expect(chord?.name).toBe('Am')
    expect(chord?.strings).toEqual([0, 1, 2, 2, 0, -1])
    // Survives a save.
    const back = roundTrip(score, settings)
    expect(frets(back, 0)[0]).toBe('2:0,3:2,4:2,5:1,6:0')
  })
})
