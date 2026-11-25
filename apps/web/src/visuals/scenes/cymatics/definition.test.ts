import { describe, expect, it } from 'vitest'

import { cymatics } from './definition'
import { MAX_MODES, PATTERN_PRESETS, modesFromFrequency } from './patterns'

describe('cymatics definition', () => {
  it('lists every preset as a pattern option, with unique ids', () => {
    const pattern = cymatics.params.find((p) => p.key === 'pattern')
    expect(pattern?.type).toBe('select')
    const values = pattern?.type === 'select' ? pattern.options.map((o) => o.value) : []
    expect(new Set(values).size).toBe(values.length)
    for (const preset of PATTERN_PRESETS) expect(values).toContain(preset.id)
  })

  it('keeps presets within the modes the shader superposes', () => {
    for (const preset of PATTERN_PRESETS) {
      expect(preset.modes.length, preset.id).toBeGreaterThan(0)
      expect(preset.modes.length, preset.id).toBeLessThanOrEqual(MAX_MODES)
    }
  })

  it('only rebuilds for the particle count', () => {
    const rebuild = cymatics.params.filter((p) => p.rebuild).map((p) => p.key)
    expect(rebuild).toEqual(['particleCount'])
  })
})

describe('modesFromFrequency', () => {
  it('maps 220 Hz to the classic (3, 5) plate', () => {
    expect(modesFromFrequency(220)).toEqual({ m: 3, n: 5 })
  })

  it('gets busier with pitch and stays in 1..20', () => {
    const low = modesFromFrequency(82.4)
    const high = modesFromFrequency(1318.5)
    expect(high.m).toBeGreaterThan(low.m)
    expect(high.n).toBeGreaterThan(low.n)
    expect(modesFromFrequency(0)).toEqual({ m: 1, n: 1 })
    expect(modesFromFrequency(1e6)).toEqual({ m: 20, n: 20 })
  })
})
