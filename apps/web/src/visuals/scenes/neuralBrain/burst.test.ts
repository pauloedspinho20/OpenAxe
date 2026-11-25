import { describe, expect, it } from 'vitest'

import { EdgeTrigger, pickClusters } from './burst'

describe('pickClusters', () => {
  it('returns distinct ids in range, clamped to the total', () => {
    const ids = pickClusters(10, 4)
    expect(new Set(ids).size).toBe(4)
    expect(ids.every((i) => i >= 0 && i < 10)).toBe(true)
    expect(pickClusters(3, 9)).toHaveLength(3)
    expect(pickClusters(5, -1)).toEqual([])
  })
})

describe('EdgeTrigger', () => {
  it('fires on a quick rise only, never on a held or falling level', () => {
    const t = new EdgeTrigger(0.05)
    expect(t.step(0)).toBe(0)
    expect(t.step(0.8)).toBe(0.8)
    expect(t.step(0.8)).toBe(0)
    expect(t.step(0.5)).toBe(0)
    expect(t.step(0.52)).toBe(0)
    expect(t.step(0.9)).toBe(0.9)
  })
})
