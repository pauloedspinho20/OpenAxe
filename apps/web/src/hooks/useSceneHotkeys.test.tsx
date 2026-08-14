// @vitest-environment jsdom
import { render, renderHook } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSceneHotkeys } from './useSceneHotkeys'

const { goToSlotMock } = vi.hoisted(() => ({ goToSlotMock: vi.fn() }))
vi.mock('../scenes/sceneNavigator', () => ({ SceneNavigator: { goToSlot: goToSlotMock } }))

describe('useSceneHotkeys', () => {
  beforeEach(() => {
    goToSlotMock.mockClear()
  })

  it('digit keys 1-8 switch to the matching slot (0-indexed)', () => {
    renderHook(() => useSceneHotkeys())

    fireEvent.keyDown(window, { key: '3' })
    expect(goToSlotMock).toHaveBeenCalledWith(2, { source: 'keyboard' })

    fireEvent.keyDown(window, { key: '8' })
    expect(goToSlotMock).toHaveBeenCalledWith(7, { source: 'keyboard' })
  })

  it('ignores keys outside 1-8', () => {
    renderHook(() => useSceneHotkeys())
    fireEvent.keyDown(window, { key: '9' })
    fireEvent.keyDown(window, { key: '0' })
    fireEvent.keyDown(window, { key: 'a' })
    expect(goToSlotMock).not.toHaveBeenCalled()
  })

  it('ignores the key while a modifier is held', () => {
    renderHook(() => useSceneHotkeys())
    fireEvent.keyDown(window, { key: '1', ctrlKey: true })
    fireEvent.keyDown(window, { key: '1', metaKey: true })
    fireEvent.keyDown(window, { key: '1', shiftKey: true })
    fireEvent.keyDown(window, { key: '1', altKey: true })
    expect(goToSlotMock).not.toHaveBeenCalled()
  })

  it('ignores a repeated key (held down)', () => {
    renderHook(() => useSceneHotkeys())
    fireEvent.keyDown(window, { key: '1', repeat: true })
    expect(goToSlotMock).not.toHaveBeenCalled()
  })

  it('does nothing while a text input is focused', () => {
    renderHook(() => useSceneHotkeys())
    const { getByTestId } = render(<input data-testid="name" />)
    const input = getByTestId('name')
    input.focus()
    fireEvent.keyDown(input, { key: '1' })
    expect(goToSlotMock).not.toHaveBeenCalled()
  })

  it('does nothing while a select is focused', () => {
    renderHook(() => useSceneHotkeys())
    const { getByTestId } = render(
      <select data-testid="sel">
        <option>a</option>
      </select>,
    )
    const select = getByTestId('sel')
    select.focus()
    fireEvent.keyDown(select, { key: '1' })
    expect(goToSlotMock).not.toHaveBeenCalled()
  })

  it('removes the listener on unmount', () => {
    const { unmount } = renderHook(() => useSceneHotkeys())
    unmount()
    fireEvent.keyDown(window, { key: '1' })
    expect(goToSlotMock).not.toHaveBeenCalled()
  })
})
