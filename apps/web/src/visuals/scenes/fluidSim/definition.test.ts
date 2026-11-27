import { describe, expect, it } from 'vitest'

import { DYE_RESOLUTIONS, SIM_RESOLUTIONS, fluidSim } from './definition'

describe('fluidSim definition', () => {
  it('rebuilds for exactly the render-target sizes', () => {
    const rebuild = fluidSim.params.filter((p) => p.rebuild).map((p) => p.key)
    expect(rebuild.sort()).toEqual(['dyeResolution', 'simResolution'])
  })

  it('defaults the resolutions to listed options', () => {
    const def = (key: string) => fluidSim.params.find((p) => p.key === key)
    const sim = def('simResolution')
    const dye = def('dyeResolution')
    expect(sim?.type === 'select' && sim.options.map((o) => o.value)).toEqual(
      SIM_RESOLUTIONS.map(String),
    )
    expect(dye?.type === 'select' && dye.options.map((o) => o.value)).toEqual(
      DYE_RESOLUTIONS.map(String),
    )
  })
})
