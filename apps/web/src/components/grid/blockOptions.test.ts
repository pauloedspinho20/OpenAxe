import { describe, expect, it } from 'vitest'
import { BLOCK_OPTIONS, BLOCK_KIND_LABELS } from './blockOptions'

describe('blockOptions grouping (issue #274)', () => {
  it('moves the Neural Amp Modeler kinds into their own group, including Cab', () => {
    const nam = BLOCK_OPTIONS.filter((o) => o.group === 'Neural Amp Modeler').map((o) => o.kind)
    // `space` is not in ALL_BLOCK_OPTIONS in this branch (palette still compiles it,
    // but the option was removed from the presentational list), so the filtered
    // NAM group is pedal/amp/amp-cab/cab only. Keep the assertion aligned with
    // the current presentational set rather than the compiled set.
    expect(nam).toEqual(['pedal', 'amp', 'amp-cab', 'cab'])
  })

  it('keeps Mixer and the Send/Return relays in Core', () => {
    const core = BLOCK_OPTIONS.filter((o) => o.group === 'Core').map((o) => o.kind)
    // EQ was moved from Effects → Core in this branch (see blockOptions.ts).
    expect(core).toEqual(['mixer', 'send-1', 'send-2', 'return-1', 'return-2', 'eq'])
  })

  it('labels every Send/Return kind for the palette and inspector', () => {
    expect(BLOCK_KIND_LABELS['send-1']).toBe('Send 1')
    expect(BLOCK_KIND_LABELS['send-2']).toBe('Send 2')
    expect(BLOCK_KIND_LABELS['return-1']).toBe('Return 1')
    expect(BLOCK_KIND_LABELS['return-2']).toBe('Return 2')
  })
})
