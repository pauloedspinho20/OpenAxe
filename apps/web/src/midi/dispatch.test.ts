// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

const { goToSlotMock, goToSceneMock, nextSceneMock, prevSceneMock } = vi.hoisted(() => ({
  goToSlotMock: vi.fn(),
  goToSceneMock: vi.fn(),
  nextSceneMock: vi.fn(),
  prevSceneMock: vi.fn(),
}))
vi.mock('../scenes/sceneNavigator', () => ({
  SceneNavigator: {
    goToSlot: goToSlotMock,
    goToScene: goToSceneMock,
    nextScene: nextSceneMock,
    prevScene: prevSceneMock,
  },
}))

const { executeMidiAction } = await import('./dispatch')

describe('executeMidiAction', () => {
  it('calls goToSlot for a slot action', () => {
    executeMidiAction({ kind: 'slot', slot: 3 })
    expect(goToSlotMock).toHaveBeenCalledWith(3, { source: 'midi' })
  })

  it('calls goToScene for a scene action', () => {
    executeMidiAction({ kind: 'scene', scene: 12 })
    expect(goToSceneMock).toHaveBeenCalledWith(12, { source: 'midi' })
  })

  it('calls nextScene/prevScene', () => {
    executeMidiAction({ kind: 'nextScene' })
    expect(nextSceneMock).toHaveBeenCalledWith({ source: 'midi' })
    executeMidiAction({ kind: 'prevScene' })
    expect(prevSceneMock).toHaveBeenCalledWith({ source: 'midi' })
  })
})
