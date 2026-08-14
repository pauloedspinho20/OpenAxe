import { beforeEach, describe, expect, it } from 'vitest'
import { deletePreset, getPreset, listPresets, savePreset } from '../presets/presetStore'
import { clearStore, STORE_SCENES } from '../storage/db'
import { loadSceneBank, saveSceneBank, createEmptyBank } from './sceneBankStore'
import {
  DEFAULT_SCENE_NAME,
  STARTER_PRESETS,
  installFactoryScenes,
  starterPresetId,
} from './factoryScenes'

beforeEach(async () => {
  for (const preset of await listPresets()) await deletePreset(preset.id)
  await clearStore(STORE_SCENES)
})

describe('installFactoryScenes', () => {
  it('seeds all 8 starter presets and a bank with scene 0 pointing at them', async () => {
    await installFactoryScenes()

    const ids = (await listPresets()).map((p) => p.id).sort()
    expect(ids).toEqual([...STARTER_PRESETS.map((p) => p.id)].sort())

    const bank = await loadSceneBank()
    expect(bank?.scenes[0]?.name).toBe(DEFAULT_SCENE_NAME)
    expect(bank?.scenes[0]?.slots).toEqual(Array.from({ length: 8 }, (_, i) => starterPresetId(i)))
    for (let i = 1; i < 64; i++) {
      expect(bank?.scenes[i]?.slots.every((s) => s === null)).toBe(true)
    }
  })

  it('a second call is a no-op', async () => {
    await installFactoryScenes()
    const first = await loadSceneBank()
    await installFactoryScenes()
    const second = await loadSceneBank()
    expect(second).toEqual(first)
  })

  it('never overwrites a bank the user has already modified', async () => {
    const bank = createEmptyBank()
    bank.activeScene = 12
    await saveSceneBank(bank)

    await installFactoryScenes()

    const loaded = await loadSceneBank()
    expect(loaded?.activeScene).toBe(12)
    expect(loaded?.scenes[0]?.slots.every((s) => s === null)).toBe(true)
  })

  it('never overwrites a customized starter preset', async () => {
    const first = STARTER_PRESETS[0]!
    await savePreset({ ...first, name: 'My Customized Version' })

    await installFactoryScenes()

    expect((await getPreset(first.id))?.name).toBe('My Customized Version')
  })
})
