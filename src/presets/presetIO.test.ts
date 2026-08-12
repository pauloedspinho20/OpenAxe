import { describe, expect, it } from 'vitest'
import { presetFromJson, presetToJson, sanitizeFilename } from './presetIO'
import type { Preset } from './types'

function makePreset(overrides: Partial<Preset> = {}): Preset {
  return {
    id: 'p1',
    name: 'Ambient Pad',
    tags: ['ambient'],
    favorite: true,
    createdAt: 100,
    updatedAt: 200,
    blocks: [
      {
        id: 'b1',
        kind: 'amp',
        row: 0,
        col: 0,
        params: {},
        modelId: 'm1',
        modelName: 'Deluxe',
        irId: null,
        irName: null,
      },
      {
        id: 'b2',
        kind: 'drive',
        row: 0,
        col: 1,
        bypass: false,
        params: { drive: 0.5 },
      },
    ],
    edges: [{ id: 'e1', from: { blockId: 'b1', port: 0 }, to: { blockId: 'b2', port: 0 } }],
    masterLevel: 1,
    masterMuted: false,
    ...overrides,
  }
}

describe('presetToJson / presetFromJson', () => {
  it('round-trips a full preset through JSON', () => {
    const preset = makePreset()
    expect(presetFromJson(presetToJson(preset))).toEqual(preset)
  })

  it('throws a clear error on invalid JSON', () => {
    expect(() => presetFromJson('{not json')).toThrow(/not valid JSON/)
  })

  it('throws when required top-level fields are missing', () => {
    expect(() => presetFromJson(JSON.stringify({ name: 'X' }))).toThrow(/'id'/)
  })

  it('throws when blocks is missing', () => {
    const broken = { ...makePreset(), blocks: undefined }
    expect(() => presetFromJson(JSON.stringify(broken))).toThrow(/'blocks'/)
  })

  it('throws when a block entry is missing required fields', () => {
    const preset = makePreset()
    preset.blocks = [{ kind: 'drive' } as never]
    expect(() => presetFromJson(JSON.stringify(preset))).toThrow(/'id'/)
  })

  it('throws when an edge entry is missing required fields', () => {
    const preset = makePreset()
    preset.edges = [{ id: 'e1' } as never]
    expect(() => presetFromJson(JSON.stringify(preset))).toThrow(/'from'/)
  })

  it('defaults missing optional fields (tags/favorite/timestamps) rather than throwing', () => {
    const minimal = {
      id: 'p1',
      name: 'Minimal',
      blocks: makePreset().blocks,
      edges: makePreset().edges,
      masterLevel: 1,
      masterMuted: false,
    }
    const preset = presetFromJson(JSON.stringify(minimal))
    expect(preset.tags).toEqual([])
    expect(preset.favorite).toBe(false)
    expect(typeof preset.createdAt).toBe('number')
  })
})

describe('sanitizeFilename', () => {
  it('strips characters unsafe for filenames', () => {
    expect(sanitizeFilename('My/Weird:Name?')).toBe('MyWeirdName')
  })

  it('falls back to a default name when nothing safe remains', () => {
    expect(sanitizeFilename('///???')).toBe('preset')
  })
})
