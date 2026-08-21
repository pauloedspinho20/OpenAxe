import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deletePreset, getPreset, listPresets, savePreset } from '../presets/presetStore'
import { clearStore, STORE_SCENES } from '../storage/db'
import { loadSceneBank, saveSceneBank, createEmptyBank } from './sceneBankStore'
import { DEFAULT_SCENE_NAME, STARTER_PRESETS, installFactoryScenes } from './factoryScenes'

beforeEach(async () => {
  for (const preset of await listPresets()) await deletePreset(preset.id)
  await clearStore(STORE_SCENES)
  // installFactoryScenes fetches+caches whatever default gear its starter
  // presets reference (see factoryScenes.ts's gearUsedByStarterPresets) -
  // stub a generic successful response so this works the same whether or
  // not real default gear files happen to be present on disk right now.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(['x'])) }),
  )
})

describe('installFactoryScenes', () => {
  it('seeds every starter preset and a bank with scene 0 pointing at them, named "Guitar rig"', async () => {
    await installFactoryScenes()

    const ids = (await listPresets()).map((p) => p.id).sort()
    expect(ids).toEqual([...STARTER_PRESETS.map((p) => p.id)].sort())

    const bank = await loadSceneBank()
    expect(bank?.scenes[0]?.name).toBe(DEFAULT_SCENE_NAME)
    expect(bank?.scenes[0]?.slots.slice(0, STARTER_PRESETS.length)).toEqual(
      STARTER_PRESETS.map((p) => p.id),
    )
    for (let i = 1; i < 64; i++) {
      expect(bank?.scenes[i]?.slots.every((s) => s === null)).toBe(true)
    }
  })

  it('always includes a plain Bypass preset, gear-independent', () => {
    expect(STARTER_PRESETS.some((p) => p.name === 'Bypass' && p.blocks.length === 0)).toBe(true)
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

  it('retrofits an existing install whose scene 0 is still exactly the legacy "Default" name', async () => {
    const bank = createEmptyBank()
    bank.scenes[0] = {
      index: 0,
      name: 'Default',
      slots: [null, null, null, null, null, null, null, null],
    }
    await saveSceneBank(bank)

    await installFactoryScenes()

    const loaded = await loadSceneBank()
    expect(loaded?.scenes[0]?.name).toBe(DEFAULT_SCENE_NAME)
    // Retrofit only renames - it must not seed/overwrite presets or slots.
    expect(loaded?.scenes[0]?.slots.every((s) => s === null)).toBe(true)
    expect(await listPresets()).toEqual([])
  })

  it('leaves a scene 0 the user renamed to something else alone', async () => {
    const bank = createEmptyBank()
    bank.scenes[0] = {
      index: 0,
      name: 'My Rig',
      slots: [null, null, null, null, null, null, null, null],
    }
    await saveSceneBank(bank)

    await installFactoryScenes()

    expect((await loadSceneBank())?.scenes[0]?.name).toBe('My Rig')
  })

  it('still installs the scene and presets even if fetching a default gear file fails', async () => {
    // App.tsx fire-and-forgets installFactoryScenes() with no .catch() - a
    // rejection here would surface as an unhandled rejection, not just a
    // failed install (regression: this genuinely happened once real default
    // gear files existed for fetch() to fail on - see the issue #101 PR).
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')))

    await expect(installFactoryScenes()).resolves.toBeUndefined()

    const ids = (await listPresets()).map((p) => p.id).sort()
    expect(ids).toEqual([...STARTER_PRESETS.map((p) => p.id)].sort())
    expect((await loadSceneBank())?.scenes[0]?.name).toBe(DEFAULT_SCENE_NAME)
  })
})
