import { describe, expect, it } from 'vitest'

import { neonKaleidoscope } from './definition'

describe('neonKaleidoscope definition', () => {
  it('rebuilds only for the unrolled layer count', () => {
    const rebuild = neonKaleidoscope.params.filter((p) => p.rebuild).map((p) => p.key)
    expect(rebuild).toEqual(['iterations'])
  })

  it('keeps the iteration range within what the shader unrolls', () => {
    const it = neonKaleidoscope.params.find((p) => p.key === 'iterations')
    expect(it?.type === 'number' && it.max).toBe(12)
  })
})
