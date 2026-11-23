// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useRegisterViewHistory,
  type RegisterViewHistoryInput,
} from '../hooks/useRegisterViewHistory'
import {
  getActiveViewHistory,
  resetViewHistoryForTests,
  useViewHistoryStore,
} from './viewHistoryStore'

describe('viewHistoryStore', () => {
  beforeEach(() => {
    resetViewHistoryForTests()
  })

  it('keeps controllers isolated per view and switches cleanly with activeView', () => {
    const rigUndo = vi.fn()
    const rigRedo = vi.fn()
    const learnUndo = vi.fn()
    const learnRedo = vi.fn()

    const store = useViewHistoryStore.getState()
    store.register('rig', {
      id: Symbol('rig'),
      label: 'rig change',
      canUndo: true,
      canRedo: false,
      undo: rigUndo,
      redo: rigRedo,
    })
    store.register('learn', {
      id: Symbol('learn'),
      label: 'tab edit',
      canUndo: false,
      canRedo: true,
      undo: learnUndo,
      redo: learnRedo,
    })

    expect(getActiveViewHistory()?.label).toBe('rig change')
    void getActiveViewHistory()?.undo()
    expect(rigUndo).toHaveBeenCalledOnce()
    expect(learnUndo).not.toHaveBeenCalled()

    store.setActiveView('learn')
    expect(getActiveViewHistory()?.label).toBe('tab edit')
    void getActiveViewHistory()?.redo()
    expect(learnRedo).toHaveBeenCalledOnce()
    expect(rigRedo).not.toHaveBeenCalled()
  })

  it('does not clear a newer owner when an older owner unregisters', () => {
    const oldOwner = Symbol('old')
    const newOwner = Symbol('new')
    const store = useViewHistoryStore.getState()

    store.register('learn', {
      id: oldOwner,
      label: 'old tab',
      canUndo: true,
      canRedo: false,
      undo: vi.fn(),
      redo: vi.fn(),
    })
    store.register('learn', {
      id: newOwner,
      label: 'new tab',
      canUndo: false,
      canRedo: true,
      undo: vi.fn(),
      redo: vi.fn(),
    })

    store.unregister('learn', oldOwner)
    store.setActiveView('learn')
    expect(getActiveViewHistory()?.label).toBe('new tab')
    expect(getActiveViewHistory()?.id).toBe(newOwner)

    store.unregister('learn', newOwner)
    expect(getActiveViewHistory()).toBeNull()
  })
})

describe('useRegisterViewHistory', () => {
  beforeEach(() => {
    resetViewHistoryForTests()
  })

  it('registers, updates reactively, unregisters on null and unmount, and protects replacement owners', () => {
    useViewHistoryStore.getState().setActiveView('learn')
    const undo = vi.fn()
    const redo = vi.fn()

    const first = renderHook(
      ({ input }: { input: RegisterViewHistoryInput | null }) =>
        useRegisterViewHistory('learn', input),
      {
        initialProps: {
          input: { label: 'tab edit', canUndo: false, canRedo: false, undo, redo },
        } as { input: RegisterViewHistoryInput | null },
      },
    )

    expect(getActiveViewHistory()?.canUndo).toBe(false)

    first.rerender({ input: { label: 'tab edit', canUndo: true, canRedo: true, undo, redo } })
    expect(getActiveViewHistory()?.canUndo).toBe(true)
    expect(getActiveViewHistory()?.canRedo).toBe(true)

    first.rerender({ input: null })
    expect(getActiveViewHistory()).toBeNull()

    // Re-register then mount a replacement before unmounting first.
    first.rerender({ input: { label: 'first tab', canUndo: true, canRedo: false, undo, redo } })
    const secondUndo = vi.fn()
    const second = renderHook(() =>
      useRegisterViewHistory('learn', {
        label: 'second tab',
        canUndo: false,
        canRedo: true,
        undo: secondUndo,
        redo,
      }),
    )

    first.unmount()
    expect(getActiveViewHistory()?.label).toBe('second tab')
    void getActiveViewHistory()?.undo()
    expect(secondUndo).toHaveBeenCalledOnce()

    second.unmount()
    expect(getActiveViewHistory()).toBeNull()
  })
})
