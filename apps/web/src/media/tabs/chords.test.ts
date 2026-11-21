import { describe, expect, it } from 'vitest'

import { nameChord, QUALITIES, standardShift, voicings } from './chords'
import { openPitches } from './fretboard'

const STD = [64, 59, 55, 50, 45, 40]
const EB = STD.map((p) => p - 1)
const DROP_D = [64, 59, 55, 50, 45, 38]

/** Sounding pitches of a voicing (frets low string first). */
const sound = (tunings: number[], frets: number[]) => {
  const open = openPitches(tunings).slice(1)
  return frets.flatMap((f, i) => (f < 0 ? [] : [open[i]! + f]))
}

describe('chord library', () => {
  it('recognises standard-shaped tunings', () => {
    expect(standardShift(STD)).toBe(0)
    expect(standardShift(EB)).toBe(-1)
    expect(standardShift(DROP_D)).toBeNull()
    expect(voicings(DROP_D, 0, '')).toEqual([])
  })

  it('every voicing spells its chord, for every root and quality', () => {
    for (const tunings of [STD, EB]) {
      for (let root = 0; root < 12; root++) {
        for (const q of QUALITIES) {
          for (const v of voicings(tunings, root, q.id)) {
            const pcs = new Set(sound(tunings, v.frets).map((p) => ((p % 12) + 12) % 12))
            const want = new Set(q.intervals.map((i) => (root + i) % 12))
            for (const p of pcs)
              expect(want.has(p), `${root}${q.id} ${v.shape} ${v.frets}`).toBe(true)
            expect(pcs.has(root), `${root}${q.id} ${v.shape} root`).toBe(true)
            // Lowest sounding note is the root.
            const low = Math.min(...sound(tunings, v.frets))
            expect(((low % 12) + 12) % 12, `${root}${q.id} ${v.shape} bass`).toBe(root)
          }
        }
      }
    }
  })

  it('offers open and barre voicings', () => {
    const g = voicings(STD, 7, '')
    expect(g[0]).toEqual({ frets: [3, 2, 0, 0, 0, 3], shape: 'open' })
    expect(g.map((v) => v.shape)).toContain('E shape')
    expect(voicings(STD, 9, 'm').map((v) => v.shape)).toEqual(['open', 'E shape', 'A shape'])
    // E♭ standard: the "E" shape sounds E♭.
    expect(voicings(EB, 3, '')[0]).toEqual({ frets: [0, 2, 2, 1, 0, 0], shape: 'open' })
  })
})

describe('chord finder', () => {
  it('names chords from sounding pitches', () => {
    expect(nameChord(sound(STD, [-1, 0, 2, 2, 1, 0]))).toBe('Am')
    expect(nameChord(sound(STD, [3, 2, 0, 0, 0, 3]))).toBe('G')
    expect(nameChord(sound(STD, [-1, 0, 2, 0, 1, 0]))).toBe('Am7')
    expect(nameChord(sound(STD, [0, 2, 2, -1, -1, -1]))).toBe('E5')
    expect(nameChord(sound(STD, [3, 3, 2, 0, 1, 0]))).toBe('C/G')
    expect(nameChord(sound(STD, [-1, 3, 2, 0, 1, 0]).map((p) => p + 2))).toBe('D')
    expect(nameChord([60])).toBeNull()
  })
})
