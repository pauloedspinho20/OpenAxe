// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { frequencyToNote } from './noteUtils'

describe('frequencyToNote', () => {
  it('identifies A4 at the reference frequency with 0 cents', () => {
    const note = frequencyToNote(440)
    expect(note).toEqual({ name: 'A', octave: 4, cents: 0 })
  })

  it('identifies E2 (low guitar E, ~82.41Hz)', () => {
    const note = frequencyToNote(82.41)
    expect(note.name).toBe('E')
    expect(note.octave).toBe(2)
    expect(Math.abs(note.cents)).toBeLessThan(2)
  })

  it('identifies E4 (high guitar E, ~329.63Hz)', () => {
    const note = frequencyToNote(329.63)
    expect(note.name).toBe('E')
    expect(note.octave).toBe(4)
  })

  it('reports positive cents when sharp of the nearest note', () => {
    // A4 + 20 cents: 440 * 2^(20/1200)
    const note = frequencyToNote(440 * 2 ** (20 / 1200))
    expect(note.name).toBe('A')
    expect(note.cents).toBeCloseTo(20, 0)
  })

  it('reports negative cents when flat of the nearest note', () => {
    const note = frequencyToNote(440 * 2 ** (-20 / 1200))
    expect(note.name).toBe('A')
    expect(note.cents).toBeCloseTo(-20, 0)
  })

  it('honors a custom A4 reference pitch', () => {
    const note = frequencyToNote(432, 432)
    expect(note).toEqual({ name: 'A', octave: 4, cents: 0 })
  })

  it('wraps correctly across an octave boundary (B3 -> C4)', () => {
    const b3 = frequencyToNote(246.94)
    expect(b3.name).toBe('B')
    expect(b3.octave).toBe(3)
    const c4 = frequencyToNote(261.63)
    expect(c4.name).toBe('C')
    expect(c4.octave).toBe(4)
  })
})
