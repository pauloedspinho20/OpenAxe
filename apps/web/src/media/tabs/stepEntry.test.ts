import { describe, expect, it } from 'vitest'

import { ChordCollector, midiFromFrequency, placeChord, StepDetector } from './stepEntry'

const STD = [64, 59, 55, 50, 45, 40]

describe('step entry', () => {
  it('groups near-simultaneous MIDI notes into one chord', () => {
    const c = new ChordCollector(70)
    c.add(40, 0)
    c.add(47, 20)
    c.add(52, 40)
    expect(c.poll(80)).toBeNull()
    expect(c.poll(115)).toEqual([40, 47, 52])
    expect(c.poll(500)).toBeNull()
    c.add(45, 600)
    expect(c.poll(700)).toEqual([45])
  })

  it('accepts a held pitch once and re-arms after a gap', () => {
    const d = new StepDetector(100)
    const seq: (number | null)[] = []
    let t = 0
    const feed = (n: number | null, ms: number) => {
      for (let i = 0; i < ms; i += 20, t += 20) seq.push(d.feed(n, t))
    }
    feed(45, 200) // held A: written once
    feed(45, 200) // still ringing: not again
    feed(null, 60) // gap
    feed(45, 200) // picked again: written
    feed(47, 200) // a different note right away: written
    expect(seq.filter((x) => x !== null)).toEqual([45, 45, 47])
  })

  it('converts frequency to MIDI', () => {
    expect(midiFromFrequency(440)).toBe(69)
    expect(midiFromFrequency(82.41)).toBe(40)
  })

  it('places chords on separate strings', () => {
    // E power chord: E2 B2 E3 -> low E open, A string 2, D string 2.
    expect(placeChord(STD, [40, 47, 52], 1)).toEqual([
      { string: 3, fret: 2 },
      { string: 2, fret: 2 },
      { string: 1, fret: 0 },
    ])
    expect(placeChord(STD, [57], 2)).toEqual([{ string: 2, fret: 12 }])
    expect(placeChord(STD, [20], 2)).toEqual([])
  })

  it('keeps single notes near the hand', () => {
    // A3 after notes around fret 1: the G string's 2nd fret, not the low E's 17th.
    expect(placeChord(STD, [57], 1, 24, 1)).toEqual([{ string: 4, fret: 2 }])
    // Up at the 12th fret, the same A3 stays there (A string 12).
    expect(placeChord(STD, [57], 1, 24, 12)).toEqual([{ string: 2, fret: 12 }])
    // An open string is fine from a low position.
    expect(placeChord(STD, [55], 1, 24, 2)).toEqual([{ string: 4, fret: 0 }])
  })
})
