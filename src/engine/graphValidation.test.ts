// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { canConnect, isEdgeOrderValid, type ValidatableBlock } from './graphValidation'
import { jack } from './gridConfig'

function blocks(entries: Array<[string, ValidatableBlock['kind'], number]>) {
  const map = new Map<string, ValidatableBlock>()
  for (const [id, kind, col] of entries) map.set(id, { id, kind, col })
  return map
}

describe('canConnect', () => {
  it('allows a forward connection between two real blocks', () => {
    const result = canConnect(
      blocks([
        ['a', 'drive', 0],
        ['b', 'eq', 1],
      ]),
      [],
      jack('a'),
      jack('b'),
    )
    expect(result).toEqual({ ok: true })
  })

  it('rejects a backward connection', () => {
    const result = canConnect(
      blocks([
        ['a', 'drive', 2],
        ['b', 'eq', 0],
      ]),
      [],
      jack('a'),
      jack('b'),
    )
    expect(result.ok).toBe(false)
  })

  it('rejects a same-column connection', () => {
    const result = canConnect(
      blocks([
        ['a', 'drive', 3],
        ['b', 'eq', 3],
      ]),
      [],
      jack('a'),
      jack('b'),
    )
    expect(result.ok).toBe(false)
  })

  it('rejects connecting a jack to itself', () => {
    const result = canConnect(blocks([['a', 'drive', 0]]), [], jack('a'), jack('a'))
    expect(result.ok).toBe(false)
  })

  it('rejects an unknown source or target block', () => {
    const map = blocks([['a', 'drive', 0]])
    expect(canConnect(map, [], jack('ghost'), jack('a')).ok).toBe(false)
    expect(canConnect(map, [], jack('a'), jack('ghost')).ok).toBe(false)
  })

  it('allows IN as a source and OUT as a target regardless of real column numbers', () => {
    const map = blocks([['a', 'drive', 0]])
    expect(canConnect(map, [], jack('IN'), jack('a')).ok).toBe(true)
    expect(canConnect(map, [], jack('a'), jack('OUT')).ok).toBe(true)
  })

  it('rejects a second cable into the same jack on a normal block', () => {
    const map = blocks([
      ['a', 'drive', 0],
      ['b', 'eq', 1],
      ['c', 'reverb', 0],
    ])
    const existing = [{ from: jack('a'), to: jack('b') }]
    const result = canConnect(map, existing, jack('c'), jack('b'))
    expect(result.ok).toBe(false)
  })

  it('allows several cables into a Mixer as long as each targets a different port', () => {
    const map = blocks([
      ['a', 'drive', 0],
      ['b', 'eq', 0],
      ['m', 'mixer', 1],
    ])
    const existing = [{ from: jack('a'), to: jack('m', 0) }]
    const result = canConnect(map, existing, jack('b'), jack('m', 1))
    expect(result.ok).toBe(true)
  })

  it('rejects a second cable into the same Mixer port', () => {
    const map = blocks([
      ['a', 'drive', 0],
      ['b', 'eq', 0],
      ['m', 'mixer', 1],
    ])
    const existing = [{ from: jack('a'), to: jack('m', 0) }]
    const result = canConnect(map, existing, jack('b'), jack('m', 0))
    expect(result.ok).toBe(false)
  })

  it('rejects a port index beyond a Mixer input count', () => {
    const map = blocks([
      ['a', 'drive', 0],
      ['m', 'mixer', 1],
    ])
    const result = canConnect(map, [], jack('a'), jack('m', 4))
    expect(result.ok).toBe(false)
  })

  it('rejects any non-zero port on a non-Mixer block', () => {
    const map = blocks([
      ['a', 'drive', 0],
      ['b', 'eq', 1],
    ])
    const result = canConnect(map, [], jack('a'), jack('b', 1))
    expect(result.ok).toBe(false)
  })
})

describe('isEdgeOrderValid', () => {
  it('is true while the source column stays left of the target column', () => {
    const map = blocks([
      ['a', 'drive', 0],
      ['b', 'eq', 1],
    ])
    expect(isEdgeOrderValid(map, { from: jack('a'), to: jack('b') })).toBe(true)
  })

  it('is false once a moved block makes the source column land on or after the target', () => {
    const map = blocks([
      ['a', 'drive', 3],
      ['b', 'eq', 1],
    ])
    expect(isEdgeOrderValid(map, { from: jack('a'), to: jack('b') })).toBe(false)
  })
})
