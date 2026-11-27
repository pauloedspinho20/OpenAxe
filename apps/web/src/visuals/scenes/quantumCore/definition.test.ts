import { describe, expect, it } from 'vitest'

import { quantumCore } from './definition'

describe('quantumCore definition', () => {
  it('rebuilds for exactly the shader loop bounds', () => {
    const rebuild = quantumCore.params.filter((p) => p.rebuild).map((p) => p.key)
    expect(rebuild.sort()).toEqual(['foldSteps', 'traceSteps'])
  })

  it('keeps the loop bounds within what the shader supports', () => {
    const max = (key: string) => {
      const p = quantumCore.params.find((q) => q.key === key)
      return p?.type === 'number' ? p.max : undefined
    }
    expect(max('traceSteps')).toBeLessThanOrEqual(128)
    expect(max('foldSteps')).toBeLessThanOrEqual(8)
  })
})
