import { describe, expect, it } from 'vitest'

import { plasmaGlobe } from './definition'

describe('plasmaGlobe definition', () => {
  it('only rebuilds for the detail tier', () => {
    expect(plasmaGlobe.params.filter((p) => p.rebuild).map((p) => p.key)).toEqual(['quality'])
  })

  it('offers every gas the scene knows', () => {
    const gas = plasmaGlobe.params.find((p) => p.key === 'gas')
    const values = gas?.type === 'select' ? gas.options.map((o) => o.value) : []
    expect(values).toEqual(['classic', 'neon', 'argon', 'xenon'])
  })

  it('lets audio place the touch', () => {
    const routed = new Set(plasmaGlobe.modulations.map((m) => m.param))
    for (const key of ['touch', 'touchAngle', 'touchReach']) expect(routed.has(key), key).toBe(true)
  })
})
