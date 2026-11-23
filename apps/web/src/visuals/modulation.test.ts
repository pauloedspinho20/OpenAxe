import { describe, expect, it } from 'vitest'

import { emptyFeatures } from './audio/features'
import { Modulator, shape } from './modulation'
import type { Modulation, SceneParam } from './types'

const params: SceneParam[] = [
  { key: 'a', label: 'A', group: 'G', type: 'number', min: 0, max: 10, step: 0.1, default: 5 },
  {
    key: 'hue',
    label: 'Hue',
    group: 'G',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.9,
    wrap: true,
  },
  {
    key: 'n',
    label: 'N',
    group: 'G',
    type: 'number',
    min: 1,
    max: 8,
    step: 1,
    default: 4,
    rebuild: true,
  },
]

const mod = (patch: Partial<Modulation>): Modulation => ({
  id: 'm',
  param: 'a',
  source: 'volume',
  amount: 0.5,
  curve: 'linear',
  attack: 0,
  release: 0,
  enabled: true,
  ...patch,
})

describe('shape', () => {
  it('maps the ends to 0 and 1 for every curve', () => {
    for (const c of ['linear', 'ease', 'expo', 'gate'] as const) {
      expect(shape(c, 0)).toBe(0)
      expect(shape(c, 1)).toBe(1)
    }
    expect(shape('expo', 0.5)).toBeLessThan(0.5)
  })
})

describe('Modulator', () => {
  const base = { a: 5, hue: 0.9, n: 4 }

  it('adds amount x feature x range and clamps', () => {
    const audio = { ...emptyFeatures(), volume: 1 }
    const out = new Modulator().apply(params, base, [mod({})], audio, 1 / 60, {})
    expect(out.a).toBe(10) // 5 + 0.5 * 1 * 10
    const neg = new Modulator().apply(params, base, [mod({ amount: -1 })], audio, 1 / 60, {})
    expect(neg.a).toBe(0)
  })

  it('wraps wrap params instead of clamping', () => {
    const audio = { ...emptyFeatures(), volume: 0.5 }
    const out = new Modulator().apply(
      params,
      base,
      [mod({ param: 'hue', amount: 0.4 })],
      audio,
      1 / 60,
      {},
    )
    expect(out.hue).toBeCloseTo(0.1, 6) // 0.9 + 0.2 wraps to 0.1
  })

  it('ignores disabled routes and rebuild params', () => {
    const audio = { ...emptyFeatures(), volume: 1 }
    const out = new Modulator().apply(
      params,
      base,
      [mod({ enabled: false }), mod({ id: 'r', param: 'n', amount: 1 })],
      audio,
      1 / 60,
      {},
    )
    expect(out.a).toBe(5)
    expect(out.n).toBe(4)
  })

  it('smooths cyclic sources along the shortest arc', () => {
    const m = new Modulator()
    const route = mod({ param: 'hue', source: 'pitchClass', amount: 1, attack: 0.5 })
    const zeroBase = { ...base, hue: 0 }
    m.apply(params, zeroBase, [route], { ...emptyFeatures(), pitchClass: 0.95 }, 1 / 60, {})
    // Jump across the wrap point: the value must move up through 1.0, not back down through 0.5.
    const out = m.apply(
      params,
      zeroBase,
      [route],
      { ...emptyFeatures(), pitchClass: 0.05 },
      0.05,
      {},
    )
    const hue = out.hue as number
    expect(hue > 0.95 || hue < 0.05).toBe(true)
  })

  it('applies attack/release smoothing per route', () => {
    const m = new Modulator()
    const route = mod({ attack: 1, release: 1 })
    m.apply(params, base, [route], emptyFeatures(), 1 / 60, {})
    const out = m.apply(params, base, [route], { ...emptyFeatures(), volume: 1 }, 1 / 60, {})
    expect(out.a as number).toBeGreaterThan(5)
    expect(out.a as number).toBeLessThan(5.2)
  })
})
