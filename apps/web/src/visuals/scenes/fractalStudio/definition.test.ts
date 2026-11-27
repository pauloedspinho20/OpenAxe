import { describe, expect, it } from 'vitest'

import { fractalStudio, juliaPreset } from './definition'

describe('fractalStudio definition', () => {
  it('rebuilds for exactly the shader constants', () => {
    const rebuild = fractalStudio.params.filter((p) => p.rebuild).map((p) => p.key)
    expect(rebuild.sort()).toEqual(['fractal', 'iterations', 'raySteps'])
  })

  it('resolves julia presets and leaves custom to the sliders', () => {
    expect(juliaPreset('chaos')).toMatchObject({ cx: -0.4, cy: -0.59 })
    expect(juliaPreset('custom')).toBeUndefined()
  })
})
