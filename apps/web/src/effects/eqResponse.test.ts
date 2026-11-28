import { describe, expect, it } from 'vitest'
import { graphicResponseDb, peakingResponseDb } from './eqResponse'

describe('eqResponse', () => {
  it('hits the set gain at the band centre', () => {
    for (const hz of [125, 1000, 4000]) {
      expect(peakingResponseDb(hz, 9, hz)).toBeCloseTo(9, 2)
      expect(peakingResponseDb(hz, -9, hz)).toBeCloseTo(-9, 2)
    }
  })

  it('is flat with every band at 0 dB', () => {
    const flat = Array(10).fill(0)
    expect(graphicResponseDb(flat, 1234)).toBe(0)
  })

  it('barely moves a frequency far from the band', () => {
    expect(Math.abs(peakingResponseDb(1000, 12, 62.5))).toBeLessThan(0.6)
  })
})
