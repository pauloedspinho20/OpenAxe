import { describe, expect, it } from 'vitest'

import { neuralBrain } from './definition'

describe('neuralBrain definition', () => {
  it('rebuilds for exactly the generator inputs', () => {
    const rebuild = neuralBrain.params.filter((p) => p.rebuild).map((p) => p.key)
    const geometry = neuralBrain.params
      .filter((p) => p.group === 'Geometry' && p.type !== 'action')
      .map((p) => p.key)
    expect(rebuild).toEqual(geometry)
    expect(rebuild).toContain('seed')
  })
})

describe('neuralBrain impulses', () => {
  it('stays still in silence: nothing fires and the dots stay steady by default', () => {
    const d = (k: string) => neuralBrain.params.find((p) => p.key === k)
    expect(d('fire')).toMatchObject({ default: 0 })
    expect(d('dotPulse')).toMatchObject({ default: 0 })
  })

  it('fires from attacks and note changes', () => {
    const fire = neuralBrain.modulations.filter((m) => m.param === 'fire').map((m) => m.source)
    expect(fire).toEqual(['onset', 'noteChange'])
  })
})
