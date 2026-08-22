// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { PresetManager } from './PresetManager'
import { usePresetManager } from '../../../state/presetManager'
import { useSceneStore } from '../../../state/sceneStore'
import { savePreset } from '../../../presets/presetStore'
import { clearStore, STORE_PRESETS } from '../../../storage/db'
import type { Preset } from '../../../presets/types'

function makePreset(id: string, name: string, favorite = false): Preset {
  return {
    id,
    name,
    tags: favorite ? ['fav'] : [],
    favorite,
    createdAt: 1000,
    updatedAt: 1000,
    blocks: [{ id: 'b', kind: 'reverb', row: 0, col: 0, params: {} }],
    edges: [],
    masterLevel: 1,
    masterMuted: false,
  }
}

describe('PresetManager', () => {
  beforeEach(async () => {
    await clearStore(STORE_PRESETS)
    usePresetManager.setState({ open: false, pickTarget: null })
    useSceneStore.setState({ scenes: [], activeScene: 0, activeSlot: 0 })
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue('blob:x'),
      revokeObjectURL: vi.fn(),
    })
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    await clearStore(STORE_PRESETS)
    usePresetManager.setState({ open: false, pickTarget: null })
  })

  it('renders nothing when closed', () => {
    render(<PresetManager rig={null} context={null} />)
    expect(screen.queryByText('PRESETS')).toBeNull()
  })

  it('prompts to power on and disables Save when no rig is present', async () => {
    act(() => usePresetManager.setState({ open: true }))
    render(<PresetManager rig={null} context={null} />)
    expect(screen.getByText('Power on to save the current grid as a preset.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save Current' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Import…' })).toBeInTheDocument()
  })

  it('lists saved presets with their block counts', async () => {
    await savePreset(makePreset('p1', 'Clean'))
    await savePreset(makePreset('p2', 'Dirty', true))
    act(() => usePresetManager.setState({ open: true }))
    render(<PresetManager rig={null} context={null} />)
    await waitFor(() => expect(screen.getByText('Clean')).toBeInTheDocument())
    expect(screen.getByText('Dirty')).toBeInTheDocument()
    expect(screen.getAllByText(/1 block/).length).toBeGreaterThan(0)
  })

  it('deletes a preset', async () => {
    await savePreset(makePreset('p1', 'Clean'))
    act(() => usePresetManager.setState({ open: true }))
    render(<PresetManager rig={null} context={null} />)
    await waitFor(() => expect(screen.getByText('Clean')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Delete Clean' }))
    await waitFor(() => expect(screen.queryByText('Clean')).toBeNull())
  })

  it('toggles a preset favorite', async () => {
    await savePreset(makePreset('p1', 'Clean'))
    act(() => usePresetManager.setState({ open: true }))
    render(<PresetManager rig={null} context={null} />)
    await waitFor(() => expect(screen.getByText('Clean')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Favorite Clean' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Favorite Clean' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Unfavorite Clean' })).toBeInTheDocument(),
    )
  })

  it('shows an error when loading without power', async () => {
    await savePreset(makePreset('p1', 'Clean'))
    act(() => usePresetManager.setState({ open: true }))
    render(<PresetManager rig={null} context={null} />)
    await waitFor(() => expect(screen.getByText('Clean')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Load Clean' }))
    expect(await screen.findByText('Power on before loading a preset.')).toBeInTheDocument()
  })

  it('exports a preset without throwing', async () => {
    await savePreset(makePreset('p1', 'Clean'))
    act(() => usePresetManager.setState({ open: true }))
    render(<PresetManager rig={null} context={null} />)
    await waitFor(() => expect(screen.getByText('Clean')).toBeInTheDocument())
    expect(() =>
      fireEvent.click(screen.getByRole('button', { name: 'Export Clean' })),
    ).not.toThrow()
  })

  it('assigns a preset to a scene slot when opened as a picker', async () => {
    const assignSpy = vi.spyOn(useSceneStore.getState(), 'assignSlot')
    await savePreset(makePreset('p1', 'Clean'))
    act(() => usePresetManager.setState({ open: true, pickTarget: { scene: 2, slot: 3 } }))
    render(<PresetManager rig={null} context={null} />)
    await waitFor(() => expect(screen.getByText('Clean')).toBeInTheDocument())
    expect(screen.getByText('ASSIGN TO SCENE 3 · SLOT 4')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Assign Clean' }))
    expect(assignSpy).toHaveBeenCalledWith(2, 3, 'p1')
  })
})
