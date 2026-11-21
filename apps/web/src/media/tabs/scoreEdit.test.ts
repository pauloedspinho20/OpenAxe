// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { exporter, importer, model, Settings } from '@coderline/alphatab'

import {
  beatAt,
  clampCursor,
  deleteBar,
  deleteBeat,
  deleteNote,
  duplicateBar,
  insertBar,
  makeRest,
  moveLeft,
  moveRight,
  moveString,
  noteAt,
  setFret,
  setTempo,
  setTimeSignature,
  startCursor,
  stepDuration,
  tempoAt,
  toggleDot,
  toggleNoteEffect,
  toggleRepeat,
  transposeBar,
} from './scoreEdit'

const TEX = [
  '\\title "Test"',
  '\\tempo 120',
  '\\track "Guitar"',
  '\\staff {tabs}',
  '\\tuning (E4 B3 G3 D3 A2 E2)',
  'r.1 | r.1',
].join('\n')

function load(tex = TEX) {
  const settings = new Settings()
  const imp = new importer.AlphaTexImporter()
  imp.initFromString(tex, settings)
  return { score: imp.readScore(), settings }
}

function roundTrip(score: model.Score, settings: Settings) {
  const bytes = new exporter.Gp7Exporter().export(score, settings)
  return importer.ScoreLoader.loadScoreFromBytes(bytes, settings)
}

const frets = (score: model.Score, bar: number) =>
  score.tracks[0]!.staves[0]!.bars[bar]!.voices[0]!.beats.map((b) =>
    b.notes.map((n) => `${n.string}:${n.fret}`).join(','),
  )

describe('scoreEdit', () => {
  it('enters notes GP-style and survives a .gp round trip', () => {
    const { score, settings } = load()
    let c = startCursor()
    stepDuration(score, c, 1, settings) // whole -> half
    stepDuration(score, c, 1, settings) // half -> quarter
    setFret(score, c, 3, settings)
    expect(beatAt(score, c)!.duration).toBe(model.Duration.Quarter)
    c = moveRight(score, c, settings) // bar has room: appends a rest beat
    expect(c.beat).toBe(1)
    c = moveString(score, c, 1)
    setFret(score, c, 5, settings)
    expect(frets(score, 0)).toEqual(['1:3', '2:5'])
    const back = roundTrip(score, settings)
    expect(frets(back, 0)).toEqual(['1:3', '2:5'])
  })

  it('moves into the next bar once the bar is full, creating one at the end', () => {
    const { score, settings } = load('\\track "G"\n\\staff {tabs}\n0.6.1')
    let c = startCursor()
    expect(score.masterBars.length).toBe(1)
    c = moveRight(score, c, settings)
    expect(c.bar).toBe(1)
    expect(score.masterBars.length).toBe(2)
    expect(moveLeft(score, c).bar).toBe(0)
  })

  it('deletes notes, rests and beats', () => {
    const { score, settings } = load('\\track "G"\n\\staff {tabs}\n(0.6 2.5).4 3.4 5.4 7.4')
    const c = { ...startCursor(), string: 1 }
    deleteNote(score, c, settings)
    expect(frets(score, 0)[0]).toBe('2:2')
    makeRest(score, { ...c, beat: 1 }, settings)
    expect(beatAt(score, { ...c, beat: 1 })!.isRest).toBe(true)
    const next = deleteBeat(score, { ...c, beat: 3 }, settings)
    expect(frets(score, 0).length).toBe(3)
    expect(next.beat).toBe(2)
  })

  it('inserts, duplicates and deletes bars across tracks', () => {
    const { score, settings } = load(
      '\\track "A"\n\\staff {tabs}\n3.6.1 | 5.6.1\n\\track "B"\n\\staff {tabs}\n7.6.1 | 9.6.1',
    )
    const at = insertBar(score, 0, settings)
    expect(at).toBe(1)
    expect(score.masterBars.length).toBe(3)
    expect(score.tracks[1]!.staves[0]!.bars.length).toBe(3)
    expect(frets(score, 2)).toEqual(['1:5'])
    const dup = duplicateBar(score, 0, settings)
    expect(frets(score, dup)).toEqual(['1:3'])
    deleteBar(score, 1, settings)
    expect(score.masterBars.length).toBe(3)
    expect(score.masterBars.map((m) => m.index)).toEqual([0, 1, 2])
    const back = roundTrip(score, settings)
    expect(back.masterBars.length).toBe(3)
  })

  it('edits durations, dots, effects, time signature, repeats, tempo and transposition', () => {
    const { score, settings } = load('\\track "G"\n\\staff {tabs}\n5.3.4 5.3.4 5.3.4 5.3.4')
    const c = { ...startCursor(), string: 4 }
    toggleDot(score, c, settings)
    expect(beatAt(score, c)!.dots).toBe(1)
    expect(toggleNoteEffect(score, c, 'palmMute', settings)).toBe(true)
    expect(noteAt(score, c)!.isPalmMute).toBe(true)
    expect(toggleNoteEffect(score, c, 'bend', settings)).toBe(true)
    expect(noteAt(score, c)!.hasBend).toBe(true)
    toggleNoteEffect(score, c, 'bend', settings)
    expect(noteAt(score, c)!.hasBend).toBe(false)
    setTimeSignature(score, 0, 3, 4, settings)
    expect(score.masterBars[0]!.timeSignatureNumerator).toBe(3)
    toggleRepeat(score, 0, 'start', settings)
    expect(score.masterBars[0]!.isRepeatStart).toBe(true)
    setTempo(score, 0, 90, settings)
    expect(tempoAt(score, 0)).toBe(90)
    transposeBar(score, c, 2, settings)
    expect(noteAt(score, c)!.fret).toBe(7)
    const back = roundTrip(score, settings)
    expect(back.masterBars[0]!.timeSignatureNumerator).toBe(3)
    expect(tempoAt(back, 0)).toBe(90)
  })

  it('clamps cursors onto the score', () => {
    const { score } = load()
    expect(
      clampCursor(score, { track: 5, staff: 3, bar: 99, voice: 2, beat: 9, string: 12 }),
    ).toEqual({
      track: 0,
      staff: 0,
      bar: 1,
      voice: 0,
      beat: 0,
      string: 6,
    })
  })
})
