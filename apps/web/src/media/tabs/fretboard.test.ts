import { describe, expect, it } from 'vitest'

import { beatPositions, isBlackKey, noteName, openPitches, pitchAt, placePitch } from './fretboard'

// Standard guitar tuning as alphaTab lists it: high E first.
const STD = [64, 59, 55, 50, 45, 40]

describe('fretboard', () => {
  it('maps alphaTab strings (1 = lowest) to open pitches', () => {
    expect(openPitches(STD)).toEqual([0, 40, 45, 50, 55, 59, 64])
    expect(pitchAt(STD, { string: 1, fret: 5 })).toBe(45)
    expect(pitchAt(STD, { string: 6, fret: 0 })).toBe(64)
  })

  it('names notes', () => {
    expect(noteName(60)).toBe('C4')
    expect(noteName(61, false)).toBe('C♯')
    expect(isBlackKey(61)).toBe(true)
    expect(isBlackKey(64)).toBe(false)
  })

  it('places a pitch on the preferred string when it fits', () => {
    expect(placePitch(STD, 45, 1, 24)).toEqual({ string: 1, fret: 5 })
    // A3 on the A string is open.
    expect(placePitch(STD, 45, 2, 24)).toEqual({ string: 2, fret: 0 })
  })

  it('falls back to the lowest fret on a free string', () => {
    // E2 (40) can't go on the G string; only the low E fits.
    expect(placePitch(STD, 40, 4, 24)).toEqual({ string: 1, fret: 0 })
    // B3 (59) from the high E string: the open B string, or the G string's
    // 4th fret when the B string already has a note; if nothing free fits, any.
    expect(placePitch(STD, 59, 6, 24)).toEqual({ string: 5, fret: 0 })
    expect(placePitch(STD, 59, 6, 24, [5])).toEqual({ string: 4, fret: 4 })
    expect(placePitch(STD, 59, 6, 3, [5])).toEqual({ string: 5, fret: 0 })
    // The preferred string already holds a note: don't overwrite it.
    expect(placePitch(STD, 60, 3, 24, [3])).toEqual({ string: 5, fret: 1 })
    expect(placePitch(STD, 30, 1, 24)).toBeNull()
    expect(placePitch(STD, 100, 6, 24)).toBeNull()
  })

  it('reads a beat as positions', () => {
    expect(
      beatPositions({
        notes: [
          { string: 1, fret: 3 },
          { string: 2, fret: 5 },
        ],
      }),
    ).toEqual([
      { string: 1, fret: 3 },
      { string: 2, fret: 5 },
    ])
    expect(beatPositions(null)).toEqual([])
  })
})
