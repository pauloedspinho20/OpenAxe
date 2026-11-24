import { describe, expect, it } from 'vitest'

import { FEATURE_IDS } from '../../audio/features'
import { isModulatable } from '../../types'
import { holoGrid } from './definition'

describe('holoGrid definition', () => {
  it('has unique param keys and number defaults inside their range', () => {
    const keys = holoGrid.params.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const p of holoGrid.params) {
      if (p.type !== 'number') continue
      expect(p.default, p.key).toBeGreaterThanOrEqual(p.min)
      expect(p.default, p.key).toBeLessThanOrEqual(p.max)
      expect(p.step, p.key).toBeGreaterThan(0)
    }
  })

  it('routes known features to modulatable params with unique ids', () => {
    const targets = new Set(holoGrid.params.filter(isModulatable).map((p) => p.key))
    const ids = holoGrid.modulations.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const m of holoGrid.modulations) {
      expect(targets.has(m.param), `${m.id} -> ${m.param}`).toBe(true)
      expect(FEATURE_IDS).toContain(m.source)
      expect(Math.abs(m.amount)).toBeLessThanOrEqual(1)
    }
  })

  it('keeps the shader-constant params as rebuild params', () => {
    const rebuild = holoGrid.params
      .filter((p) => p.type === 'number' && p.rebuild)
      .map((p) => p.key)
    expect(rebuild.sort()).toEqual(['aa', 'aoSamples', 'interiorSteps', 'maxSteps'])
  })
})
