// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSceneStore } from '../../../state/sceneStore'
import { useSceneManager } from '../../../state/sceneManager'
import { createEmptyBank } from '../../../scenes/sceneBankStore'
import { SceneManager } from './SceneManager'

const { goToSceneMock } = vi.hoisted(() => ({ goToSceneMock: vi.fn(async () => ({ ok: true })) }))
vi.mock('../../../scenes/sceneNavigator', () => ({
  SceneNavigator: { goToScene: goToSceneMock },
}))

describe('SceneManager', () => {
  beforeEach(() => {
    goToSceneMock.mockClear()
    useSceneStore.getState().reset()
    useSceneStore.getState().hydrate(createEmptyBank())
    useSceneManager.getState().closeManager()
  })

  it('renders nothing when closed', () => {
    render(<SceneManager />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders all 64 scene rows when open', () => {
    useSceneManager.getState().openManager()
    render(<SceneManager />)
    expect(screen.getAllByPlaceholderText(/Scene \d+/)).toHaveLength(64)
  })

  it('typing in a row renames that scene', () => {
    useSceneManager.getState().openManager()
    render(<SceneManager />)
    const input = screen.getByPlaceholderText('Scene 12')
    fireEvent.change(input, { target: { value: 'Lead Bank' } })
    expect(useSceneStore.getState().scenes[11]?.name).toBe('Lead Bank')
  })

  it('Jump calls goToScene and closes the modal', () => {
    useSceneManager.getState().openManager()
    render(<SceneManager />)
    const jumpButtons = screen.getAllByRole('button', { name: /Jump to scene/ })
    fireEvent.click(jumpButtons[11]!)
    expect(goToSceneMock).toHaveBeenCalledWith(11, { source: 'ui' })
    expect(useSceneManager.getState().open).toBe(false)
  })

  it('Escape closes the modal', () => {
    useSceneManager.getState().openManager()
    render(<SceneManager />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(useSceneManager.getState().open).toBe(false)
  })
})
