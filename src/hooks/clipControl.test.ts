// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ClipControl } from './clipControl'

describe('ClipControl', () => {
  it('does not trip on a single transient peak', () => {
    const control = new ClipControl({ threshold: 0.98, sustainedMs: 400 })
    expect(control.update(1, 0)).toBe(false)
    expect(control.update(0.5, 100)).toBe(false)
  })

  it('trips once after the signal sits at/above threshold for sustainedMs', () => {
    const control = new ClipControl({ threshold: 0.98, sustainedMs: 400 })
    expect(control.update(0.99, 0)).toBe(false)
    expect(control.update(1, 100)).toBe(false)
    expect(control.update(1, 300)).toBe(false)
    expect(control.update(1, 400)).toBe(true)
    // Latched - further clipping polls don't re-trip.
    expect(control.update(1, 500)).toBe(false)
  })

  it('re-arms only after the signal drops back below threshold', () => {
    const control = new ClipControl({ threshold: 0.98, sustainedMs: 400 })
    expect(control.update(1, 0)).toBe(false)
    expect(control.update(1, 500)).toBe(true)
    control.update(0.5, 600)
    expect(control.update(1, 700)).toBe(false)
    expect(control.update(1, 1100)).toBe(true)
  })

  it('a below-threshold poll mid-episode resets the sustained window', () => {
    const control = new ClipControl({ threshold: 0.98, sustainedMs: 400 })
    expect(control.update(1, 0)).toBe(false)
    control.update(0.5, 300)
    expect(control.update(1, 400)).toBe(false)
    expect(control.update(1, 800)).toBe(true)
  })

  it('reset clears any in-progress or latched episode', () => {
    const control = new ClipControl({ threshold: 0.98, sustainedMs: 400 })
    expect(control.update(1, 0)).toBe(false)
    expect(control.update(1, 500)).toBe(true)
    control.reset()
    expect(control.update(1, 600)).toBe(false)
    expect(control.update(1, 1000)).toBe(true)
  })
})
