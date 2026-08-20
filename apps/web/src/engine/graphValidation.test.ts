// @vitest-environment node
//
// graphValidation.ts is the UI's pre-check for the connection rules; the core's
// graph_validation.cpp is the source of truth the audio thread actually enforces
// (issue #55). These two must never disagree - the audio thread rejects a cable
// this test allows (or vice-versa) is a silent routing bug. So this file and
// packages/core/tests/graph_validation_test.cpp are deliberate mirrors of each
// other: every rule case here is ported there ("Ports every case in
// apps/web/src/engine/graphValidation.test.ts") and vice-versa. If you change a
// rule in either, port it to the other.
import { describe, expect, it } from 'vitest'
import { canConnect, canMoveTo, isEdgeOrderValid, type ValidatableBlock } from './graphValidation'
import { GRID_COLS, jack } from './gridConfig'

function blocks(entries: Array<[string, ValidatableBlock['kind'], number]>) {
  const map = new Map<string, ValidatableBlock>()
  for (const [id, kind, col] of entries) map.set(id, { id, kind, col })
  return map
}

describe('canConnect', () => {
  it('allows a forward connection between two real blocks', () => {
    const result = canConnect(
      blocks([
        ['a', 'compressor', 0],
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
        ['a', 'compressor', 2],
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
        ['a', 'compressor', 3],
        ['b', 'eq', 3],
      ]),
      [],
      jack('a'),
      jack('b'),
    )
    expect(result.ok).toBe(false)
  })

  it('rejects connecting a jack to itself', () => {
    const result = canConnect(blocks([['a', 'compressor', 0]]), [], jack('a'), jack('a'))
    expect(result.ok).toBe(false)
  })

  it('rejects an unknown source or target block', () => {
    const map = blocks([['a', 'compressor', 0]])
    expect(canConnect(map, [], jack('ghost'), jack('a')).ok).toBe(false)
    expect(canConnect(map, [], jack('a'), jack('ghost')).ok).toBe(false)
  })

  it('allows IN as a source and OUT as a target regardless of real column numbers', () => {
    const map = blocks([['a', 'compressor', 0]])
    expect(canConnect(map, [], jack('IN'), jack('a')).ok).toBe(true)
    expect(canConnect(map, [], jack('a'), jack('OUT')).ok).toBe(true)
  })

  // Regression for issue #61: the rightmost valid UI column must reach OUT.
  // OUT sorts at column GRID_COLS, so a block at GRID_COLS-1 (the last placeable
  // column) must connect to OUT - otherwise the rightmost columns produce no
  // sound on the native path where the C++ core mirrors this rule.
  it('connects a block in the last grid column to OUT', () => {
    expect(
      canConnect(blocks([['a', 'compressor', GRID_COLS - 1]]), [], jack('a'), jack('OUT')).ok,
    ).toBe(true)
  })

  it('rejects a second cable into the same jack on a normal block', () => {
    const map = blocks([
      ['a', 'compressor', 0],
      ['b', 'eq', 1],
      ['c', 'reverb', 0],
    ])
    const existing = [{ from: jack('a'), to: jack('b') }]
    const result = canConnect(map, existing, jack('c'), jack('b'))
    expect(result.ok).toBe(false)
  })

  it('allows several cables into a Mixer as long as each targets a different port', () => {
    const map = blocks([
      ['a', 'compressor', 0],
      ['b', 'eq', 0],
      ['m', 'mixer', 1],
    ])
    const existing = [{ from: jack('a'), to: jack('m', 0) }]
    const result = canConnect(map, existing, jack('b'), jack('m', 1))
    expect(result.ok).toBe(true)
  })

  it('rejects a second cable into the same Mixer port', () => {
    const map = blocks([
      ['a', 'compressor', 0],
      ['b', 'eq', 0],
      ['m', 'mixer', 1],
    ])
    const existing = [{ from: jack('a'), to: jack('m', 0) }]
    const result = canConnect(map, existing, jack('b'), jack('m', 0))
    expect(result.ok).toBe(false)
  })

  it('rejects a port index beyond a Mixer input count', () => {
    const map = blocks([
      ['a', 'compressor', 0],
      ['m', 'mixer', 1],
    ])
    const result = canConnect(map, [], jack('a'), jack('m', 4))
    expect(result.ok).toBe(false)
  })

  it('rejects any non-zero port on a non-Mixer block', () => {
    const map = blocks([
      ['a', 'compressor', 0],
      ['b', 'eq', 1],
    ])
    const result = canConnect(map, [], jack('a'), jack('b', 1))
    expect(result.ok).toBe(false)
  })

  it('allows several cables out of a Splitter as long as each comes from a different port', () => {
    const map = blocks([
      ['s', 'splitter', 0],
      ['a', 'compressor', 1],
      ['b', 'eq', 1],
    ])
    const existing = [{ from: jack('s', 0), to: jack('a') }]
    const result = canConnect(map, existing, jack('s', 1), jack('b'))
    expect(result.ok).toBe(true)
  })

  it('rejects a port index beyond a Splitter output count', () => {
    const map = blocks([
      ['s', 'splitter', 0],
      ['a', 'compressor', 1],
    ])
    const result = canConnect(map, [], jack('s', 4), jack('a'))
    expect(result.ok).toBe(false)
  })

  it('rejects any non-zero source port on a non-Splitter block', () => {
    const map = blocks([
      ['a', 'compressor', 0],
      ['b', 'eq', 1],
    ])
    const result = canConnect(map, [], jack('a', 1), jack('b'))
    expect(result.ok).toBe(false)
  })
})

describe('isEdgeOrderValid', () => {
  it('is true while the source column stays left of the target column', () => {
    const map = blocks([
      ['a', 'compressor', 0],
      ['b', 'eq', 1],
    ])
    expect(isEdgeOrderValid(map, { from: jack('a'), to: jack('b') })).toBe(true)
  })

  it('is false once a moved block makes the source column land on or after the target', () => {
    const map = blocks([
      ['a', 'compressor', 3],
      ['b', 'eq', 1],
    ])
    expect(isEdgeOrderValid(map, { from: jack('a'), to: jack('b') })).toBe(false)
  })
})

describe('canMoveTo', () => {
  it('allows a block with no cables to move to any column', () => {
    const map = blocks([['a', 'compressor', 0]])
    expect(canMoveTo(map, [], 'a', 7).ok).toBe(true)
  })

  it("rejects a move that would put an input's source cable on or to its right", () => {
    const map = blocks([
      ['a', 'compressor', 0],
      ['b', 'eq', 5],
    ])
    const edge = { from: jack('a'), to: jack('b') }
    expect(canMoveTo(map, [edge], 'b', 0).ok).toBe(false)
    expect(canMoveTo(map, [edge], 'b', 1).ok).toBe(true)
  })

  it("rejects a move that would put an output's target cable on or to its left", () => {
    const map = blocks([
      ['a', 'compressor', 0],
      ['b', 'eq', 5],
    ])
    const edge = { from: jack('a'), to: jack('b') }
    expect(canMoveTo(map, [edge], 'a', 5).ok).toBe(false)
    expect(canMoveTo(map, [edge], 'a', 3).ok).toBe(true)
  })

  it('leaves a mid-chain block free to move within its cable band', () => {
    const map = blocks([
      ['a', 'compressor', 1],
      ['b', 'eq', 3],
      ['c', 'delay', 6],
    ])
    const edges = [
      { from: jack('a'), to: jack('b') },
      { from: jack('b'), to: jack('c') },
    ]
    expect(canMoveTo(map, edges, 'b', 2).ok).toBe(true)
    expect(canMoveTo(map, edges, 'b', 4).ok).toBe(true)
    expect(canMoveTo(map, edges, 'b', 1).ok).toBe(false)
    expect(canMoveTo(map, edges, 'b', 6).ok).toBe(false)
  })
})
