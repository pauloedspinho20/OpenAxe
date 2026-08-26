import { beforeEach, describe, expect, it } from 'vitest'
import { deletePreset, getPreset, listPresets, savePreset } from '../presets/presetStore'
import { clearStore, STORE_SCENES, STORE_PRESET_BANK } from '../storage/db'
import { loadPresetBank } from '../presets/presetBankStore'
import { loadSceneBank, saveSceneBank, createEmptyBank } from './sceneBankStore'
import { DEFAULT_SCENE_NAME, STARTER_PRESETS, starterPresetId } from './factoryScenes'
import { FACTORY_PRESETS } from '../presets/factoryPresets'
import { installOfflineFactorySetup } from '../factory/factorySetup'

beforeEach(async () => {
  for (const preset of await listPresets()) await deletePreset(preset.id)
  await clearStore(STORE_SCENES)
  await clearStore(STORE_PRESET_BANK)
})

describe('installOfflineFactorySetup', () => {
  it('seeds the starter + factory presets into the bank and points scene 0 at bank slots 0-7', async () => {
    await installOfflineFactorySetup()

    const ids = (await listPresets()).map((p) => p.id).sort()
    expect(ids).toEqual([...STARTER_PRESETS, ...FACTORY_PRESETS].map((p) => p.id).sort())

    const presetBank = await loadPresetBank()
    expect(presetBank?.slots.slice(0, 8)).toEqual(STARTER_PRESETS.map((p) => p.id))
    expect(presetBank?.slots.slice(8).every((s) => s === null)).toBe(true)

    const sceneBank = await loadSceneBank()
    expect(sceneBank?.scenes[0]?.name).toBe(DEFAULT_SCENE_NAME)
    expect(sceneBank?.scenes[0]?.slots).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    for (let i = 1; i < 64; i++) {
      expect(sceneBank?.scenes[i]?.slots.every((s) => s === null)).toBe(true)
    }
  })

  it('a second call is a no-op', async () => {
    await installOfflineFactorySetup()
    const firstBank = await loadPresetBank()
    const firstScenes = await loadSceneBank()
    await installOfflineFactorySetup()
    expect(await loadPresetBank()).toEqual(firstBank)
    expect(await loadSceneBank()).toEqual(firstScenes)
  })

  it('never overwrites a scene bank the user has already modified', async () => {
    const bank = createEmptyBank()
    bank.activeScene = 12
    await saveSceneBank(bank)

    await installOfflineFactorySetup()

    const loaded = await loadSceneBank()
    expect(loaded?.activeScene).toBe(12)
    expect(loaded?.scenes[0]?.slots.every((s) => s === null)).toBe(true)
  })

  it('seeds the preset bank when none exists yet', async () => {
    expect(await loadPresetBank()).toBeNull()
    await installOfflineFactorySetup()
    expect(await loadPresetBank()).not.toBeNull()
  })

  it('never overwrites a customized starter preset', async () => {
    const first = STARTER_PRESETS[0]!
    await savePreset({ ...first, name: 'My Customized Version' })

    await installOfflineFactorySetup()

    expect((await getPreset(first.id))?.name).toBe('My Customized Version')
    expect((await loadPresetBank())?.slots[0]).toBe(starterPresetId(0))
  })
})
