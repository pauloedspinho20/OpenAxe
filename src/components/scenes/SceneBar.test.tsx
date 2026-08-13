// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GraphRig } from '../../engine/GraphRig'
import { useGraphStore } from '../../state/graphStore'
import { useSceneStore } from '../../state/sceneStore'
import { useCurrentPresetStore } from '../../state/currentPresetStore'
import { usePresetManager } from '../../state/presetManager'
import { useSceneManager } from '../../state/sceneManager'
import { createEmptyBank } from '../../scenes/sceneBankStore'
import type { Preset } from '../../presets/types'
import { SceneBar } from './SceneBar'

const { goToSlotMock, prevSceneMock, nextSceneMock, listPresetsMock } = vi.hoisted(() => ({
  goToSlotMock: vi.fn(async () => ({ ok: true })),
  prevSceneMock: vi.fn(async () => ({ ok: true })),
  nextSceneMock: vi.fn(async () => ({ ok: true })),
  listPresetsMock: vi.fn(async (): Promise<Array<{ id: string; name: string }>> => []),
}))
vi.mock('../../scenes/sceneNavigator', () => ({
  SceneNavigator: { goToSlot: goToSlotMock, prevScene: prevSceneMock, nextScene: nextSceneMock },
}))
vi.mock('../../presets/presetStore', () => ({
  listPresets: listPresetsMock,
  getPreset: vi.fn(async () => null),
  savePreset: vi.fn(async () => undefined),
}))

function bankWithOnePreset() {
  const bank = createEmptyBank()
  bank.scenes[0]!.name = 'Default'
  bank.scenes[0]!.slots[4] = 'preset-x'
  return bank
}

function emptyPreset(overrides: Partial<Preset> = {}): Preset {
  return {
    id: 'preset-x',
    name: 'My Lead Tone',
    tags: [],
    favorite: false,
    createdAt: 0,
    updatedAt: 0,
    blocks: [],
    edges: [],
    masterLevel: 1,
    masterMuted: false,
    ...overrides,
  }
}

describe('SceneBar', () => {
  beforeEach(() => {
    goToSlotMock.mockClear()
    prevSceneMock.mockClear()
    nextSceneMock.mockClear()
    listPresetsMock.mockReset()
    listPresetsMock.mockResolvedValue([{ id: 'preset-x', name: 'My Lead Tone' }])
    useSceneStore.getState().reset()
    usePresetManager.getState().closeManager()
    useCurrentPresetStore.getState().setSaved(null)
    useGraphStore.setState({ blocks: [], edges: [], masterLevel: 1, masterMuted: false })
  })

  it('renders nothing until the scene store hydrates', () => {
    const { container } = render(<SceneBar rig={null} context={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders 8 slot buttons and highlights the active one', async () => {
    useSceneStore.getState().hydrate(bankWithOnePreset())
    useSceneStore.getState().setActive(0, 4)
    render(<SceneBar rig={null} context={null} />)

    const buttons = screen.getAllByRole('button', { name: /Pick a different preset for slot/ })
    expect(buttons).toHaveLength(8)
    await waitFor(() => expect(screen.getByText('My Lead Tone')).toBeInTheDocument())

    expect(screen.getByTitle('My Lead Tone')).toHaveAttribute('aria-pressed', 'true')
  })

  it('clicking a slot calls SceneNavigator.goToSlot with that index', () => {
    useSceneStore.getState().hydrate(bankWithOnePreset())
    render(<SceneBar rig={null} context={null} />)

    const slot1 = screen.getAllByTitle('Empty')[0]!
    slot1.click()
    expect(goToSlotMock).toHaveBeenCalledWith(0, { source: 'ui' })
  })

  it('prev/next arrows call the matching navigator methods', () => {
    useSceneStore.getState().hydrate(bankWithOnePreset())
    render(<SceneBar rig={null} context={null} />)

    screen.getByLabelText('Previous scene').click()
    expect(prevSceneMock).toHaveBeenCalledWith({ source: 'ui' })
    screen.getByLabelText('Next scene').click()
    expect(nextSceneMock).toHaveBeenCalledWith({ source: 'ui' })
  })

  it('the readout opens the scene manager', () => {
    useSceneManager.getState().closeManager()
    useSceneStore.getState().hydrate(bankWithOnePreset())
    render(<SceneBar rig={null} context={null} />)

    const readout = screen.getByRole('button', { name: /Default — open scene list/ })
    readout.click()
    expect(useSceneManager.getState().open).toBe(true)
  })

  it('the always-visible Save button is disabled when not powered on', () => {
    useSceneStore.getState().hydrate(bankWithOnePreset())
    render(<SceneBar rig={null} context={null} />)

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('the Library button opens the preset manager in normal (non-pick) mode', () => {
    usePresetManager.getState().closeManager()
    useSceneStore.getState().hydrate(bankWithOnePreset())
    render(<SceneBar rig={null} context={null} />)

    screen.getByRole('button', { name: 'Library' }).click()
    expect(usePresetManager.getState().open).toBe(true)
    expect(usePresetManager.getState().pickTarget).toBeNull()
  })

  it('the Save button stays disabled when the live rig matches the saved preset', () => {
    const fakeRig = { getBlock: () => null } as unknown as GraphRig
    useSceneStore.getState().hydrate(bankWithOnePreset())
    useCurrentPresetStore.getState().setSaved(emptyPreset())

    render(<SceneBar rig={fakeRig} context={null} />)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('the Save button enables once the live rig differs from the saved preset', () => {
    const fakeRig = { getBlock: () => null } as unknown as GraphRig
    useSceneStore.getState().hydrate(bankWithOnePreset())
    useCurrentPresetStore.getState().setSaved(emptyPreset())
    useGraphStore.getState().addBlock('compressor', 0, 0)

    render(<SceneBar rig={fakeRig} context={null} />)
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled()
  })

  it('a slot pointing at a preset id renders a name (or placeholder), not blank', async () => {
    const bank = createEmptyBank()
    bank.scenes[0]!.slots[0] = 'deleted-preset'
    listPresetsMock.mockResolvedValue([])
    useSceneStore.getState().hydrate(bank)
    render(<SceneBar rig={null} context={null} />)

    await waitFor(() => expect(screen.getByTitle('…')).toBeInTheDocument())
  })
})
