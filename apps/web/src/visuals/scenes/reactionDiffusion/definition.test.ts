import { describe, expect, it } from 'vitest'

import { reactionDiffusion } from './definition'
import { FEED_RANGE, KILL_RANGE, REGIMES, operatingPoint } from './presets'

describe('reactionDiffusion definition', () => {
  it('lists every regime plus custom as pattern options', () => {
    const regime = reactionDiffusion.params.find((p) => p.key === 'regime')
    const values = regime?.type === 'select' ? regime.options.map((o) => o.value) : []
    expect(values).toEqual([...REGIMES.map((r) => r.id), 'custom'])
  })

  it('only rebuilds for the grid size', () => {
    expect(reactionDiffusion.params.filter((p) => p.rebuild).map((p) => p.key)).toEqual([
      'gridSize',
    ])
  })
})

describe('operatingPoint', () => {
  it('uses the regime point, or the custom sliders for unknown regimes', () => {
    const zero = { feed: 0, kill: 0 }
    expect(operatingPoint('coral', { feed: 0.01, kill: 0.04 }, zero)).toEqual({
      feed: 0.0545,
      kill: 0.062,
    })
    expect(operatingPoint('custom', { feed: 0.03, kill: 0.05 }, zero)).toEqual({
      feed: 0.03,
      kill: 0.05,
    })
  })

  it('clamps drifted points into the stable band', () => {
    const p = operatingPoint('bubbles', { feed: 0, kill: 0 }, { feed: 0.5, kill: -0.5 })
    expect(p.feed).toBe(FEED_RANGE[1])
    expect(p.kill).toBe(KILL_RANGE[0])
  })
})
