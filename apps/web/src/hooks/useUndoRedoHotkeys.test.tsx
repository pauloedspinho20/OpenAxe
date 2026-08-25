// @vitest-environment jsdom
import { render, renderHook } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUndoRedoHotkeys } from './useUndoRedoHotkeys'

const undoMock = vi.fn()
const redoMock = vi.fn()

vi.mock('../state/historyStore', () => ({
  useHistoryStore: {
    getState: () => ({ undo: undoMock, redo: redoMock }),
  },
}))

describe('useUndoRedoHotkeys', () => {
  beforeEach(() => {
    undoMock.mockClear()
    redoMock.mockClear()
  })

  it('Ctrl+Z triggers undo', () => {
    renderHook(() => useUndoRedoHotkeys())
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(undoMock).toHaveBeenCalledOnce()
    expect(redoMock).not.toHaveBeenCalled()
  })

  it('Meta+Z triggers undo', () => {
    renderHook(() => useUndoRedoHotkeys())
    fireEvent.keyDown(window, { key: 'z', metaKey: true })
    expect(undoMock).toHaveBeenCalledOnce()
  })

  it('Ctrl+Shift+Z triggers redo', () => {
    renderHook(() => useUndoRedoHotkeys())
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true })
    expect(redoMock).toHaveBeenCalledOnce()
    expect(undoMock).not.toHaveBeenCalled()
  })

  it('Meta+Shift+Z triggers redo', () => {
    renderHook(() => useUndoRedoHotkeys())
    fireEvent.keyDown(window, { key: 'Z', metaKey: true, shiftKey: true })
    expect(redoMock).toHaveBeenCalledOnce()
  })

  it('Ctrl+Y triggers redo (and Cmd+Y)', () => {
    renderHook(() => useUndoRedoHotkeys())
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true })
    expect(redoMock).toHaveBeenCalledOnce()
    redoMock.mockClear()
    fireEvent.keyDown(window, { key: 'y', metaKey: true })
    expect(redoMock).toHaveBeenCalledOnce()
  })

  it('ignores repeated keys and composing', () => {
    renderHook(() => useUndoRedoHotkeys())
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, repeat: true })
    expect(undoMock).not.toHaveBeenCalled()
    const e = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true })
    Object.defineProperty(e, 'isComposing', { value: true })
    window.dispatchEvent(e)
    expect(undoMock).not.toHaveBeenCalled()
  })

  it('ignores when no modifier is held', () => {
    renderHook(() => useUndoRedoHotkeys())
    fireEvent.keyDown(window, { key: 'z' })
    expect(undoMock).not.toHaveBeenCalled()
    expect(redoMock).not.toHaveBeenCalled()
  })

  it('ignores when a text input is focused', () => {
    renderHook(() => useUndoRedoHotkeys())
    const { getByTestId } = render(<input data-testid="inp" />)
    const input = getByTestId('inp')
    input.focus()
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true })
    expect(undoMock).not.toHaveBeenCalled()
  })

  it('ignores when contentEditable is focused', () => {
    renderHook(() => useUndoRedoHotkeys())
    const { getByTestId } = render(<div data-testid="ed" contentEditable />)
    const ed = getByTestId('ed')
    // jsdom requires explicit isContentEditable true
    Object.defineProperty(ed, 'isContentEditable', { value: true, configurable: true })
    ed.focus()
    fireEvent.keyDown(ed, { key: 'z', ctrlKey: true })
    expect(undoMock).not.toHaveBeenCalled()
  })

  it('removes listener on unmount', () => {
    const { unmount } = renderHook(() => useUndoRedoHotkeys())
    unmount()
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(undoMock).not.toHaveBeenCalled()
  })
})
