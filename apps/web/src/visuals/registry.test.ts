import { describe, expect, it } from 'vitest'

import { FEATURE_IDS } from './audio/features'
import { SCENES, findScene } from './registry'
import { isModulatable } from './types'

/** Guards every scene definition, current and future, against config mistakes. */
describe.each(SCENES.map((s) => [s.id, s] as const))('scene %s', (_id, def) => {
  it('has unique param keys', () => {
    const keys = def.params.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('has number defaults inside their range', () => {
    for (const p of def.params) {
      if (p.type !== 'number') continue
      expect(p.default, p.key).toBeGreaterThanOrEqual(p.min)
      expect(p.default, p.key).toBeLessThanOrEqual(p.max)
      expect(p.step, p.key).toBeGreaterThan(0)
    }
  })

  it('only routes known features to modulatable params, with unique ids', () => {
    const targets = new Set(def.params.filter(isModulatable).map((p) => p.key))
    const ids = def.modulations.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const m of def.modulations) {
      expect(targets.has(m.param), `${m.id} -> ${m.param}`).toBe(true)
      expect(FEATURE_IDS).toContain(m.source)
      expect(Math.abs(m.amount)).toBeLessThanOrEqual(1)
    }
  })

  it('lazy-loads a module with createScene', () => {
    expect(typeof def.load).toBe('function')
  })
})

describe('findScene', () => {
  it('falls back to the first scene for unknown ids', () => {
    expect(findScene('nope')).toBe(SCENES[0])
    expect(findScene(null)).toBe(SCENES[0])
  })
})
