import { beforeEach, describe, expect, it } from 'vitest'
import { clearStore, STORE_PRESET_BANK } from '../storage/db'
import {
  createEmptyPresetBank,
  loadPresetBank,
  normalizePresetBank,
  savePresetBank,
} from './presetBankStore'
import { PRESET_SLOT_COUNT } from './presetBank'

beforeEach(async () => {
  await clearStore(STORE_PRESET_BANK)
})

describe('presetBankStore', () => {
  it('returns null when nothing has been saved', async () => {
    expect(await loadPresetBank()).toBeNull()
  })

  it('round-trips a bank', async () => {
    const bank = createEmptyPresetBank()
    bank.slots[0] = 'preset-1'
    bank.slots[511] = 'preset-2'
    await savePresetBank(bank)
    const loaded = await loadPresetBank()
    expect(loaded?.slots[0]).toBe('preset-1')
    expect(loaded?.slots[511]).toBe('preset-2')
  })

  it('overwrites the singleton rather than accumulating rows', async () => {
    await savePresetBank(createEmptyPresetBank())
    const second = createEmptyPresetBank()
    second.slots[5] = 'x'
    await savePresetBank(second)
    expect((await loadPresetBank())?.slots[5]).toBe('x')
  })

  it('createEmptyPresetBank has exactly PRESET_SLOT_COUNT null slots', () => {
    const bank = createEmptyPresetBank()
    expect(bank.slots).toHaveLength(PRESET_SLOT_COUNT)
    expect(bank.slots.every((s) => s === null)).toBe(true)
  })
})

describe('normalizePresetBank', () => {
  it('returns null for non-object input', () => {
    expect(normalizePresetBank(null)).toBeNull()
    expect(normalizePresetBank('nope')).toBeNull()
  })

  it('pads a short slots array out to the full fixed size', () => {
    const result = normalizePresetBank({ slots: ['a', 'b'] })
    expect(result?.slots).toHaveLength(PRESET_SLOT_COUNT)
    expect(result?.slots[0]).toBe('a')
    expect(result?.slots[1]).toBe('b')
    expect(result?.slots[2]).toBeNull()
  })

  it('drops non-string slot values', () => {
    const result = normalizePresetBank({ slots: ['ok', 42, null, {}, true] })
    expect(result?.slots[0]).toBe('ok')
    expect(result?.slots[1]).toBeNull()
    expect(result?.slots[2]).toBeNull()
    expect(result?.slots[3]).toBeNull()
    expect(result?.slots[4]).toBeNull()
  })
})
