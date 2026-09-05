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

const { executeMidiAction, executeMidiParamAction } = await import('./dispatch')
const { useGraphStore } = await import('../state/graphStore')

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

describe('executeMidiParamAction', () => {
  it('writes the CC value through to the mapped param', () => {
    useGraphStore.setState({
      blocks: [{ id: 'b1', kind: 'chorus', row: 0, col: 0, params: {} }],
      edges: [],
    })
    expect(executeMidiParamAction('b1', 'mix', 127)).toBe(true)
    expect(useGraphStore.getState().blocks.find((b) => b.id === 'b1')?.params).toEqual({
      mix: 1,
    })
  })

  it('returns false for an orphaned target instead of throwing', () => {
    useGraphStore.setState({ blocks: [], edges: [] })
    expect(executeMidiParamAction('gone', 'mix', 64)).toBe(false)
  })
})
