import { describe, expect, it } from 'vitest'

import { autoFinger } from './fingering'
import { openPitches } from './fretboard'

const STD = [64, 59, 55, 50, 45, 40]
const open = openPitches(STD)
const pitches = (beats: { string: number; fret: number }[][]) =>
  beats.map((b) => b.map((x) => open[x.string]! + x.fret))

describe('auto-fingering', () => {
  it('keeps pitches and pulls a scattered run into one place', () => {
    // A minor pentatonic run written all over the neck.
    const run = [
      [{ string: 1, fret: 5 }], // A2
      [{ string: 2, fret: 3 }], // C3
      [{ string: 1, fret: 12 }], // E3 (could be A string 7 / D string 2)
      [{ string: 3, fret: 0 }], // D3 (open D)
      [{ string: 4, fret: 2 }], // A3
    ]
    const out = autoFinger(STD, run)
    expect(pitches(out)).toEqual(pitches(run))
    // No jump to the 12th fret any more.
    expect(Math.max(...out.flat().map((x) => x.fret))).toBeLessThanOrEqual(7)
  })

  it('stays in a chosen position', () => {
    const line = [[{ string: 1, fret: 5 }], [{ string: 2, fret: 0 }], [{ string: 3, fret: 2 }]]
    const out = autoFinger(STD, line, { position: 5 })
    expect(pitches(out)).toEqual(pitches(line))
    for (const x of out.flat()) expect(x.fret === 0 || (x.fret >= 5 && x.fret <= 9)).toBe(true)
  })

  it('places chords on distinct strings within a hand span', () => {
    const chord = [
      [
        { string: 1, fret: 3 },
        { string: 2, fret: 2 },
        { string: 6, fret: 3 },
      ],
    ]
    const out = autoFinger(STD, chord)
    expect(pitches(out)).toEqual(pitches(chord))
    const strings = out[0]!.map((x) => x.string)
    expect(new Set(strings).size).toBe(3)
    const fretted = out[0]!.map((x) => x.fret).filter((f) => f > 0)
    expect(Math.max(...fretted) - Math.min(...fretted)).toBeLessThanOrEqual(4)
  })

  it('leaves an already good fingering alone', () => {
    const am = [
      [
        { string: 2, fret: 0 },
        { string: 3, fret: 2 },
        { string: 4, fret: 2 },
        { string: 5, fret: 1 },
        { string: 6, fret: 0 },
      ],
    ]
    expect(autoFinger(STD, am)).toEqual(am)
  })
})
