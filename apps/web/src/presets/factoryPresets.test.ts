import { beforeEach, describe, expect, it } from 'vitest'
import { deletePreset, getPreset, listPresets, savePreset } from './presetStore'
import { FACTORY_PRESETS, installFactoryPresets } from './factoryPresets'

describe('installFactoryPresets', () => {
  beforeEach(async () => {
    for (const preset of await listPresets()) await deletePreset(preset.id)
  })

  it('saves every factory preset when the store is empty', async () => {
    await installFactoryPresets()
    const ids = (await listPresets()).map((p) => p.id).sort()
    expect(ids).toEqual([...FACTORY_PRESETS.map((p) => p.id)].sort())
  })

  it('does not overwrite a factory preset the user has already customized', async () => {
    const first = FACTORY_PRESETS[0]!
    await savePreset({ ...first, name: 'My Customized Version' })

    await installFactoryPresets()

    expect((await getPreset(first.id))?.name).toBe('My Customized Version')
  })
})
