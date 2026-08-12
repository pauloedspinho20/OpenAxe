// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectsChain } from './EffectsChain'
import type { Effect } from './Effect'

function createMockAudioNode() {
  return { connect: vi.fn(), disconnect: vi.fn() }
}

function createMockContext(): BaseAudioContext {
  return {} as BaseAudioContext
}

function createMockEffect(name: string): Effect {
  return {
    name,
    inputNode: createMockAudioNode() as unknown as AudioNode,
    outputNode: createMockAudioNode() as unknown as AudioNode,
    setMix: vi.fn(),
    getMix: vi.fn(() => 1),
    setBypass: vi.fn(),
    isBypassed: vi.fn(() => false),
    dispose: vi.fn(),
  }
}

// GainNode isn't available in the `node` test environment, so stub the two
// calls EffectsChain makes on `new GainNode(context)`.
vi.stubGlobal(
  'GainNode',
  class {
    connect = vi.fn()
    disconnect = vi.fn()
  },
)

describe('EffectsChain', () => {
  let chain: EffectsChain

  beforeEach(() => {
    chain = new EffectsChain(createMockContext())
  })

  it('starts empty', () => {
    expect(chain.list()).toEqual([])
  })

  it('inserts effects in order by default', () => {
    const a = createMockEffect('a')
    const b = createMockEffect('b')
    chain.insert(a)
    chain.insert(b)
    expect(chain.list().map((e) => e.name)).toEqual(['a', 'b'])
  })

  it('inserts at a specific index', () => {
    const a = createMockEffect('a')
    const b = createMockEffect('b')
    const c = createMockEffect('c')
    chain.insert(a)
    chain.insert(b)
    chain.insert(c, 1)
    expect(chain.list().map((e) => e.name)).toEqual(['a', 'c', 'b'])
  })

  it('wires input -> effect1.input, effect1.output -> effect2.input on insert', () => {
    const a = createMockEffect('a')
    const b = createMockEffect('b')
    chain.insert(a)
    chain.insert(b)

    expect(chain.inputNode.connect).toHaveBeenCalledWith(a.inputNode)
    expect(a.outputNode.connect).toHaveBeenCalledWith(b.inputNode)
    expect(b.outputNode.connect).toHaveBeenCalledWith(chain.outputNode)
  })

  it('removes an effect and rewires around it, without disposing it', () => {
    const a = createMockEffect('a')
    const b = createMockEffect('b')
    const c = createMockEffect('c')
    chain.insert(a)
    chain.insert(b)
    chain.insert(c)

    chain.remove(b)

    expect(chain.list().map((e) => e.name)).toEqual(['a', 'c'])
    expect(a.outputNode.connect).toHaveBeenCalledWith(c.inputNode)
    expect(b.dispose).not.toHaveBeenCalled()
  })

  it('moves an effect to a new position', () => {
    const a = createMockEffect('a')
    const b = createMockEffect('b')
    const c = createMockEffect('c')
    chain.insert(a)
    chain.insert(b)
    chain.insert(c)

    chain.move(0, 2)

    expect(chain.list().map((e) => e.name)).toEqual(['b', 'c', 'a'])
  })

  it('throws on an out-of-range move', () => {
    chain.insert(createMockEffect('a'))
    expect(() => chain.move(0, 5)).toThrow(RangeError)
  })

  it('connects input directly to output when empty', () => {
    expect(chain.inputNode.connect).toHaveBeenCalledWith(chain.outputNode)
  })
})
