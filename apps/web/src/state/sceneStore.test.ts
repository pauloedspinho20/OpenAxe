// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyBank } from '../scenes/sceneBankStore'

const { saveSceneBankMock } = vi.hoisted(() => ({ saveSceneBankMock: vi.fn() }))
vi.mock('../scenes/sceneBankStore', async () => {
  const actual = await vi.importActual<typeof import('../scenes/sceneBankStore')>(
    '../scenes/sceneBankStore',
  )
  return { ...actual, saveSceneBank: saveSceneBankMock }
})

import { useSceneStore, flushSceneBank } from './sceneStore'

describe('sceneStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    saveSceneBankMock.mockClear()
    useSceneStore.getState().reset()
  })
  afterEach(() => vi.useRealTimers())

  it('does not persist anything before hydrate() runs', () => {
    useSceneStore.getState().renameScene(0, 'nope')
    vi.advanceTimersByTime(1000)
    expect(saveSceneBankMock).not.toHaveBeenCalled()
  })

  it('renameScene produces a new scenes array without mutating the previous one', () => {
    useSceneStore.getState().hydrate(createEmptyBank())
    const before = useSceneStore.getState().scenes
    useSceneStore.getState().renameScene(3, 'My Scene')
    const after = useSceneStore.getState().scenes

    expect(after).not.toBe(before)
    expect(before[3]?.name).toBe('')
    expect(after[3]?.name).toBe('My Scene')
  })

  it('assignSlot sets only the targeted scene/slot', () => {
    useSceneStore.getState().hydrate(createEmptyBank())
    useSceneStore.getState().assignSlot(2, 5, 7)

    const scenes = useSceneStore.getState().scenes
    expect(scenes[2]?.slots[5]).toBe(7)
    expect(scenes[2]?.slots[4]).toBeNull()
    expect(scenes[1]?.slots.every((s) => s === null)).toBe(true)
  })

  it('assignSlot accepts null to empty a scene slot', () => {
    useSceneStore.getState().hydrate(createEmptyBank())
    useSceneStore.getState().assignSlot(0, 0, 3)
    useSceneStore.getState().assignSlot(0, 0, null)
    expect(useSceneStore.getState().scenes[0]?.slots[0]).toBeNull()
  })

  it('out-of-range indices are no-ops rather than throwing', () => {
    useSceneStore.getState().hydrate(createEmptyBank())
    expect(() => useSceneStore.getState().assignSlot(999, 0, 3)).not.toThrow()
    expect(() => useSceneStore.getState().assignSlot(0, 0, 512)).not.toThrow()
    expect(() => useSceneStore.getState().renameScene(-1, 'x')).not.toThrow()
    expect(() => useSceneStore.getState().setActive(64, 0)).not.toThrow()
    expect(useSceneStore.getState().activeScene).toBe(0)
  })

  it('debounces rapid mutations into a single persisted write carrying the final state', () => {
    useSceneStore.getState().hydrate(createEmptyBank())
    saveSceneBankMock.mockClear()

    useSceneStore.getState().renameScene(0, 'a')
    vi.advanceTimersByTime(100)
    useSceneStore.getState().renameScene(0, 'b')
    vi.advanceTimersByTime(100)
    useSceneStore.getState().renameScene(0, 'final')
    vi.advanceTimersByTime(250)

    expect(saveSceneBankMock).toHaveBeenCalledTimes(1)
    expect(saveSceneBankMock.mock.calls[0]![0].scenes[0].name).toBe('final')
  })

  it('flushSceneBank forces an immediate write of the current state', () => {
    useSceneStore.getState().hydrate(createEmptyBank())
    saveSceneBankMock.mockClear()
    useSceneStore.getState().renameScene(0, 'urgent')
    flushSceneBank()
    expect(saveSceneBankMock).toHaveBeenCalledTimes(1)
  })
})
