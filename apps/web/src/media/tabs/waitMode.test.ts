// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { importer, Settings } from '@coderline/alphatab'

import { startCursor } from './scoreEdit'
import { frequencyToMidi, matches, midiName, nextTarget, targetFor } from './waitMode'

function load(tex: string) {
  const imp = new importer.AlphaTexImporter()
  imp.initFromString(tex, new Settings())
  return imp.readScore()
}
const hz = (midi: number, cents = 0) => 440 * 2 ** ((midi + cents / 100 - 69) / 12)

describe('wait mode', () => {
  const score = load(
    '\\track "G"\n\\staff {tabs}\n\\tuning (E4 B3 G3 D3 A2 E2)\n3.6.4 r.4 (0.1 2.2).4 x.3.4 | 5.5.1',
  )

  it('names what to play with sounding pitch, string and fret', () => {
    const t = targetFor(score, startCursor())!
    expect(t.midi).toEqual([43]) // low E + 3 = G2
    expect(t.label).toBe('G2 (6th string, fret 3)')
    expect(targetFor(score, { ...startCursor(), beat: 1 })).toBeNull() // rest
    expect(targetFor(score, { ...startCursor(), beat: 2 })!.label).toBe(
      'C♯4 (2nd string, fret 2) + E4 (1st string, open)',
    )
  })

  it('matches within 50 cents, also an octave away, and rejects wrong notes', () => {
    const t = targetFor(score, startCursor())!
    expect(matches(hz(43, 30), t)).toBe(true)
    expect(matches(hz(55, -20), t)).toBe(true) // octave up
    expect(matches(hz(44), t)).toBe(false)
    expect(matches(0, t)).toBe(false)
    expect(Math.round(frequencyToMidi(440))).toBe(69)
    expect(midiName(40)).toBe('E2')
  })

  it('steps over rests and dead notes, across bars, to the end', () => {
    const c = startCursor()
    expect(nextTarget(score, c, true)).toMatchObject({ bar: 0, beat: 0 })
    expect(nextTarget(score, c)).toMatchObject({ bar: 0, beat: 2 })
    expect(nextTarget(score, { ...c, beat: 2 })).toMatchObject({ bar: 1, beat: 0 })
    expect(nextTarget(score, { ...c, bar: 1, beat: 0 })).toBeNull()
  })
})
