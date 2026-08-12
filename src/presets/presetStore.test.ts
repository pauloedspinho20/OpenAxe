import { beforeEach, describe, expect, it } from 'vitest'
import { deletePreset, getPreset, listPresets, savePreset } from './presetStore'
import type { Preset } from './types'

function makePreset(id: string, overrides: Partial<Preset> = {}): Preset {
  return {
    id,
    name: `Preset ${id}`,
    tags: [],
    favorite: false,
    createdAt: 0,
    updatedAt: 0,
    blocks: [],
    edges: [],
    masterLevel: 1,
    masterMuted: false,
    ...overrides,
  }
}

describe('presetStore', () => {
  beforeEach(async () => {
    for (const preset of await listPresets()) await deletePreset(preset.id)
  })

  it('returns null for a preset that was never saved', async () => {
    expect(await getPreset('missing')).toBeNull()
  })

  it('round-trips a saved preset', async () => {
    const preset = makePreset('p1', { name: 'Ambient Pad' })
    await savePreset(preset)

    expect(await getPreset('p1')).toEqual(preset)
  })

  it('overwrites an existing preset with the same id', async () => {
    await savePreset(makePreset('p1', { name: 'First' }))
    await savePreset(makePreset('p1', { name: 'Second' }))

    expect((await getPreset('p1'))?.name).toBe('Second')
  })

  it('deletes a preset', async () => {
    await savePreset(makePreset('p1'))
    await deletePreset('p1')

    expect(await getPreset('p1')).toBeNull()
  })

  it('lists every saved preset', async () => {
    await savePreset(makePreset('p1'))
    await savePreset(makePreset('p2'))

    const presets = await listPresets()
    expect(presets.map((p) => p.id).sort()).toEqual(['p1', 'p2'])
  })
})
