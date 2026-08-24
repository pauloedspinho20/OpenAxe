import { describe, expect, it } from 'vitest'
import { BLOCK_OPTIONS, BLOCK_KIND_LABELS } from './blockOptions'

describe('blockOptions grouping (issue #274)', () => {
  it('moves the Neural Amp Modeler kinds into their own group, including Cab', () => {
    const nam = BLOCK_OPTIONS.filter((o) => o.group === 'Neural Amp Modeler').map((o) => o.kind)
    expect(nam).toEqual(['amp', 'amp-cab', 'cab', 'pedal', 'space', 'outboard'])
  })

  it('keeps Mixer/Splitter and the Send/Return relays in Core', () => {
    const core = BLOCK_OPTIONS.filter((o) => o.group === 'Core').map((o) => o.kind)
    expect(core).toEqual(['mixer', 'splitter', 'send-1', 'send-2', 'return-1', 'return-2'])
  })

  it('labels every Send/Return kind for the palette and inspector', () => {
    expect(BLOCK_KIND_LABELS['send-1']).toBe('Send 1')
    expect(BLOCK_KIND_LABELS['send-2']).toBe('Send 2')
    expect(BLOCK_KIND_LABELS['return-1']).toBe('Return 1')
    expect(BLOCK_KIND_LABELS['return-2']).toBe('Return 2')
  })
})
