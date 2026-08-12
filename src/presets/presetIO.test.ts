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
    chainA: {
      modelId: 'm1',
      modelName: 'Deluxe',
      irId: 'ir1',
      irName: 'Celestion',
      irMix: 0.8,
      level: 1,
      pan: -1,
      mute: false,
      solo: false,
      preFx: [{ kind: 'drive', bypass: false, mix: 1, params: { drive: 0.5 } }],
      postFx: [],
    },
    chainB: {
      modelId: null,
      modelName: null,
      irId: null,
      irName: null,
      irMix: 1,
      level: 1,
      pan: 1,
      mute: false,
      solo: false,
      preFx: [],
      postFx: [],
    },
    masterLevel: 1,
    linked: false,
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

  it('throws when a chain is missing required fields', () => {
    const broken = { ...makePreset(), chainA: { level: 1 } }
    expect(() => presetFromJson(JSON.stringify(broken))).toThrow(/chainA/)
  })

  it('throws when an effect entry is missing required fields', () => {
    const preset = makePreset()
    preset.chainA.preFx = [{ kind: 'drive' } as never]
    expect(() => presetFromJson(JSON.stringify(preset))).toThrow(/bypass/)
  })

  it('defaults missing optional fields (tags/favorite/timestamps) rather than throwing', () => {
    const minimal = {
      id: 'p1',
      name: 'Minimal',
      chainA: makePreset().chainA,
      chainB: makePreset().chainB,
      masterLevel: 1,
      linked: false,
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
