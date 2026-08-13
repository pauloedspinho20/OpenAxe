import { beforeEach, describe, expect, it } from 'vitest'
import { clearStore, STORE_SCENES } from '../storage/db'
import { createEmptyBank, loadSceneBank, normalizeBank, saveSceneBank } from './sceneBankStore'
import { SCENE_COUNT, SLOTS_PER_SCENE } from './types'

beforeEach(async () => {
  await clearStore(STORE_SCENES)
})

describe('sceneBankStore', () => {
  it('returns null when nothing has been saved', async () => {
    expect(await loadSceneBank()).toBeNull()
  })

  it('round-trips a bank', async () => {
    const bank = createEmptyBank()
    bank.scenes[0]!.name = 'Default'
    bank.scenes[0]!.slots[0] = 'preset-1'
    await saveSceneBank(bank)
    const loaded = await loadSceneBank()
    expect(loaded?.scenes[0]?.name).toBe('Default')
    expect(loaded?.scenes[0]?.slots[0]).toBe('preset-1')
  })

  it('overwrites the singleton rather than accumulating rows', async () => {
    await saveSceneBank(createEmptyBank())
    const second = createEmptyBank()
    second.activeScene = 5
    await saveSceneBank(second)
    const loaded = await loadSceneBank()
    expect(loaded?.activeScene).toBe(5)
  })

  it('createEmptyBank has exactly SCENE_COUNT scenes of SLOTS_PER_SCENE null slots', () => {
    const bank = createEmptyBank()
    expect(bank.scenes).toHaveLength(SCENE_COUNT)
    for (const scene of bank.scenes) {
      expect(scene.slots).toHaveLength(SLOTS_PER_SCENE)
      expect(scene.slots.every((s) => s === null)).toBe(true)
    }
  })
})

describe('normalizeBank', () => {
  it('returns null for non-object input', () => {
    expect(normalizeBank(null)).toBeNull()
    expect(normalizeBank('nope')).toBeNull()
  })

  it('pads a short scenes/slots array out to the full fixed size', () => {
    const result = normalizeBank({
      id: 'default',
      version: 1,
      scenes: [{ index: 0, name: 'Only One', slots: ['a', 'b'] }],
      activeScene: 0,
      activeSlot: 0,
      updatedAt: 0,
    })
    expect(result?.scenes).toHaveLength(SCENE_COUNT)
    expect(result?.scenes[0]?.slots).toHaveLength(SLOTS_PER_SCENE)
    expect(result?.scenes[0]?.slots[0]).toBe('a')
    expect(result?.scenes[0]?.slots[1]).toBe('b')
    expect(result?.scenes[0]?.slots[2]).toBeNull()
    expect(result?.scenes[1]?.name).toBe('')
  })

  it('drops non-string slot values and clamps out-of-range indices', () => {
    const result = normalizeBank({
      scenes: [{ index: 0, name: 'X', slots: [42, null, {}, 'ok'] }],
      activeScene: 999,
      activeSlot: -1,
    })
    expect(result?.scenes[0]?.slots[0]).toBeNull()
    expect(result?.scenes[0]?.slots[3]).toBe('ok')
    expect(result?.activeScene).toBe(0)
    expect(result?.activeSlot).toBe(0)
  })
})
