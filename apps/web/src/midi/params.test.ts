// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { useGraphStore } from '../state/graphStore'
import { applyMidiParamValue, midiValueToParam } from './params'

/** chorus.mix is min 0 / max 1 / step 0.01 - simple math for the mapping tests. */
function seedChorus(id = 'b1') {
  useGraphStore.setState({
    blocks: [{ id, kind: 'chorus', row: 0, col: 0, params: {} }],
    edges: [],
  })
}

describe('midiValueToParam', () => {
  beforeEach(() => {
    useGraphStore.setState({ blocks: [], edges: [] })
    seedChorus()
  })

  it('maps CC 0/127 to min/max', () => {
    expect(midiValueToParam('b1', 'mix', 0)).toBe(0)
    expect(midiValueToParam('b1', 'mix', 127)).toBe(1)
  })

  it('quantizes to the schema step like a dragged knob', () => {
    // 64/127 ≈ 0.504 -> 0.5 on the 0.01 lattice.
    expect(midiValueToParam('b1', 'mix', 64)).toBe(0.5)
  })

  it('clamps out-of-range MIDI values', () => {
    expect(midiValueToParam('b1', 'mix', 200)).toBe(1)
    expect(midiValueToParam('b1', 'mix', -5)).toBe(0)
  })

  it('returns null for a removed block', () => {
    expect(midiValueToParam('gone', 'mix', 64)).toBeNull()
  })

  it('returns null for an unknown param key', () => {
    expect(midiValueToParam('b1', 'nope', 64)).toBeNull()
  })

  it('returns null for a select-type field (chorus Image)', () => {
    expect(midiValueToParam('b1', 'stereo', 64)).toBeNull()
  })
})

describe('applyMidiParamValue', () => {
  beforeEach(() => {
    useGraphStore.setState({ blocks: [], edges: [] })
    seedChorus()
  })

  it('writes through graphStore so knobs follow incoming CC', () => {
    expect(applyMidiParamValue('b1', 'mix', 127)).toBe(true)
    expect(useGraphStore.getState().blocks.find((b) => b.id === 'b1')?.params).toEqual({
      mix: 1,
    })
  })

  it('is a silent no-op for orphaned mappings', () => {
    expect(applyMidiParamValue('gone', 'mix', 64)).toBe(false)
    expect(useGraphStore.getState().blocks).toHaveLength(1)
  })
})
