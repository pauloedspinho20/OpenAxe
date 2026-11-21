import { describe, expect, it } from 'vitest'

import { contrast, tickAt } from './videoExport'

describe('video export helpers', () => {
  const segs = [
    { start: 0, end: 2, tickStart: 0, tickEnd: 3840 },
    // A repeat plays the first bar again.
    { start: 2, end: 4, tickStart: 3840, tickEnd: 7680 },
  ]
  it('maps score time to ticks, clamped', () => {
    expect(tickAt(segs, -1)).toBe(0)
    expect(tickAt(segs, 1)).toBe(1920)
    expect(tickAt(segs, 3)).toBe(5760)
    expect(tickAt(segs, 99)).toBe(7679)
    expect(tickAt([], 1)).toBe(0)
  })
  it('picks readable text colours', () => {
    expect(contrast('#ffffff')).toBe('#111111')
    expect(contrast('#101010')).toBe('#F4F1EA')
  })
})
