// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyPresetBank } from '../presets/presetBankStore'

const { savePresetBankMock } = vi.hoisted(() => ({ savePresetBankMock: vi.fn() }))
vi.mock('../presets/presetBankStore', async () => {
  const actual = await vi.importActual<typeof import('../presets/presetBankStore')>(
    '../presets/presetBankStore',
  )
  return { ...actual, savePresetBank: savePresetBankMock }
})

import { usePresetBankStore, flushPresetBank } from './presetBankStore'
import { PRESET_SLOT_COUNT } from '../presets/presetBank'

describe('presetBankStore (zustand)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    savePresetBankMock.mockClear()
    usePresetBankStore.getState().reset()
  })
  afterEach(() => vi.useRealTimers())

  it('does not persist anything before hydrate() runs', () => {
    usePresetBankStore.getState().setSlot(0, 'x')
    vi.advanceTimersByTime(1000)
    expect(savePresetBankMock).not.toHaveBeenCalled()
  })

  it('setSlot writes only the targeted slot', () => {
    usePresetBankStore.getState().hydrate(createEmptyPresetBank())
    usePresetBankStore.getState().setSlot(3, 'preset-x')
    usePresetBankStore.getState().setSlot(3, null)
    expect(usePresetBankStore.getState().slots[3]).toBeNull()
  })

  it('out-of-range slot indices are no-ops rather than throwing', () => {
    usePresetBankStore.getState().hydrate(createEmptyPresetBank())
    expect(() => usePresetBankStore.getState().setSlot(PRESET_SLOT_COUNT, 'x')).not.toThrow()
    expect(() => usePresetBankStore.getState().setSlot(-1, 'x')).not.toThrow()
    expect(usePresetBankStore.getState().slots.every((s) => s === null)).toBe(true)
  })

  it('debounces rapid placements into a single persisted write carrying the final state', () => {
    usePresetBankStore.getState().hydrate(createEmptyPresetBank())
    savePresetBankMock.mockClear()

    usePresetBankStore.getState().setSlot(0, 'a')
    vi.advanceTimersByTime(100)
    usePresetBankStore.getState().setSlot(0, 'b')
    vi.advanceTimersByTime(250)

    expect(savePresetBankMock).toHaveBeenCalledTimes(1)
    expect(savePresetBankMock.mock.calls[0]![0].slots[0]).toBe('b')
  })

  it('flushPresetBank forces an immediate write of the current state', () => {
    usePresetBankStore.getState().hydrate(createEmptyPresetBank())
    savePresetBankMock.mockClear()
    usePresetBankStore.getState().setSlot(9, 'urgent')
    flushPresetBank()
    expect(savePresetBankMock).toHaveBeenCalledTimes(1)
  })
})
