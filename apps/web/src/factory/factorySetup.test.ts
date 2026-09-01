// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { deletePreset, listPresets } from '../presets/presetStore'
import { loadPresetBank } from '../presets/presetBankStore'
import { loadSceneBank, saveSceneBank, createEmptyBank } from '../scenes/sceneBankStore'
import { clearStore, STORE_SCENES, STORE_PRESET_BANK } from '../storage/db'
import {
  bootstrapFactorySetup,
  getFactorySetupDone,
  hasExistingSession,
  installOfflineFactorySetup,
  setFactorySetupDone,
} from './factorySetup'

beforeEach(async () => {
  for (const preset of await listPresets()) await deletePreset(preset.id)
  await clearStore(STORE_SCENES)
  await clearStore(STORE_PRESET_BANK)
  localStorage.removeItem('openaxe:factory-setup-dismissed')
})

describe('hasExistingSession', () => {
  it('is false on a truly fresh browser and true once a scene bank exists', async () => {
    expect(await hasExistingSession()).toBe(false)
    await saveSceneBank(createEmptyBank())
    expect(await hasExistingSession()).toBe(true)
  })
})

describe('getFactorySetupDone / setFactorySetupDone', () => {
  it('round-trips the persisted flag', () => {
    expect(getFactorySetupDone()).toBe(false)
    setFactorySetupDone()
    expect(getFactorySetupDone()).toBe(true)
  })
})

describe('installOfflineFactorySetup', () => {
  it('seeds the preset bank with the 8 starters and scene 0 referencing bank slots 0-7', async () => {
    await installOfflineFactorySetup()

    const presetBank = await loadPresetBank()
    expect(presetBank?.slots.slice(0, 8).every((s) => typeof s === 'string')).toBe(true)
    expect(presetBank?.slots.slice(8).every((s) => s === null)).toBe(true)

    const sceneBank = await loadSceneBank()
    expect(sceneBank?.scenes[0]?.slots).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })
})

describe('bootstrapFactorySetup', () => {
  it('returns pending on a fresh browser', async () => {
    expect(await bootstrapFactorySetup()).toBe('pending')
  })

  it('seeds + hydrates once the flag is set', async () => {
    setFactorySetupDone()
    expect(await bootstrapFactorySetup()).toBe('done')
    expect(await loadPresetBank()).not.toBeNull()
    expect(await loadSceneBank()).not.toBeNull()
  })

  it('returns done when a session already exists, regardless of the flag', async () => {
    const bank = createEmptyBank()
    bank.activeScene = 3
    await saveSceneBank(bank)
    expect(await bootstrapFactorySetup()).toBe('done')
    expect((await loadSceneBank())?.activeScene).toBe(3)
  })
})
