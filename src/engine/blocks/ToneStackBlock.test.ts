// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { ToneStackBlock } from './ToneStackBlock'

vi.stubGlobal(
  'BiquadFilterNode',
  class {
    connect = vi.fn()
    disconnect = vi.fn()
    gain = { setTargetAtTime: vi.fn() }
  },
)

function createMockContext(): BaseAudioContext {
  return { currentTime: 0 } as BaseAudioContext
}

describe('ToneStackBlock', () => {
  it('defaults every band to 0dB', () => {
    const block = new ToneStackBlock(createMockContext())
    expect(block.getParams()).toEqual({ bass: 0, mid: 0, treble: 0, presence: 0 })
  })

  it('clamps each band to +/-12dB', () => {
    const block = new ToneStackBlock(createMockContext())
    block.setBass(50)
    block.setPresence(-50)
    expect(block.getBass()).toBe(12)
    expect(block.getPresence()).toBe(-12)
  })

  it('round-trips via getParams/setParams', () => {
    const block = new ToneStackBlock(createMockContext())
    block.setParams({ bass: 3, mid: -2, treble: 5, presence: -1 })
    expect(block.getParams()).toEqual({ bass: 3, mid: -2, treble: 5, presence: -1 })
  })

  it('wires bass -> mid -> treble -> presence in series', () => {
    const block = new ToneStackBlock(createMockContext())
    expect(block.inputNode).not.toBe(block.outputNode)
  })

  it('dispose is idempotent', () => {
    const block = new ToneStackBlock(createMockContext())
    expect(() => {
      block.dispose()
      block.dispose()
    }).not.toThrow()
  })
})
