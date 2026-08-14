// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { SplitterBlock, SPLITTER_OUTPUT_COUNT } from './SplitterBlock'

function stubAudioParam(initial: number) {
  const param = {
    value: initial,
    setTargetAtTime: vi.fn((v: number) => {
      param.value = v
      return param
    }),
  }
  return param
}

function stubNode() {
  return class {
    connect = vi.fn()
    disconnect = vi.fn()
    gain = stubAudioParam(1)
  }
}

vi.stubGlobal('GainNode', stubNode())

function createMockContext(): BaseAudioContext {
  return { currentTime: 0 } as BaseAudioContext
}

describe('SplitterBlock', () => {
  it('exposes a distinct jack per output slot', () => {
    const splitter = new SplitterBlock(createMockContext())
    const jacks = Array.from({ length: SPLITTER_OUTPUT_COUNT }, (_, i) => splitter.outputNodeAt(i))
    expect(new Set(jacks).size).toBe(SPLITTER_OUTPUT_COUNT)
  })

  it('outputNode is an alias for slot 0', () => {
    const splitter = new SplitterBlock(createMockContext())
    expect(splitter.outputNode).toBe(splitter.outputNodeAt(0))
  })

  it('round-trips level for every slot via getParams/setParams', () => {
    const splitter = new SplitterBlock(createMockContext())
    splitter.setParams({ out0_level: 0.5, out3_level: 1.2 })
    const params = splitter.getParams()
    expect(params.out0_level).toBe(0.5)
    expect(params.out3_level).toBe(1.2)
  })

  it('dispose is idempotent', () => {
    const splitter = new SplitterBlock(createMockContext())
    expect(() => {
      splitter.dispose()
      splitter.dispose()
    }).not.toThrow()
  })
})
