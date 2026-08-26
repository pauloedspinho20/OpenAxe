// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { PresetManager } from './PresetManager'
import { usePresetManager } from '../../../state/presetManager'
import { useSceneStore } from '../../../state/sceneStore'
import { usePresetBankStore } from '../../../state/presetBankStore'
import { savePreset, listPresets } from '../../../presets/presetStore'
import { createEmptyPresetBank } from '../../../presets/presetBankStore'
import { clearStore, STORE_PRESETS } from '../../../storage/db'
import type { GraphRig } from '../../../engine/GraphRig'
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

const fakeRig = { getBlock: () => null } as unknown as GraphRig

describe('PresetManager', () => {
  beforeEach(async () => {
    await clearStore(STORE_PRESETS)
    usePresetManager.setState({ open: false, pickTarget: null })
    useSceneStore.setState({ scenes: [], activeScene: 0, activeSlot: 0 })
    usePresetBankStore.getState().reset()
    usePresetBankStore.getState().hydrate(createEmptyPresetBank())
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
    usePresetBankStore.getState().reset()
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

  it('renders the 512-slot bank grid with empty slots', async () => {
    act(() => usePresetManager.setState({ open: true }))
    render(<PresetManager rig={null} context={null} />)
    expect(screen.getAllByText('Empty').length).toBe(512)
    expect(screen.getByText('001')).toBeInTheDocument()
    expect(screen.getByText('512')).toBeInTheDocument()
  })

  it('lists unplaced presets under an Unplaced section', async () => {
    await savePreset(makePreset('p1', 'Clean'))
    await savePreset(makePreset('p2', 'Dirty', true))
    act(() => usePresetManager.setState({ open: true }))
    render(<PresetManager rig={null} context={null} />)
    await waitFor(() => expect(screen.getByText('Clean')).toBeInTheDocument(), {
      timeout: 5000,
    })
    expect(screen.getByText('Dirty')).toBeInTheDocument()
    expect(screen.getByText('Unplaced')).toBeInTheDocument()
  })

  it('shows a placed preset in its bank slot row', async () => {
    await savePreset(makePreset('p1', 'Clean'))
    usePresetBankStore.getState().setSlot(3, 'p1')
    act(() => usePresetManager.setState({ open: true }))
    render(<PresetManager rig={null} context={null} />)
    await waitFor(() => expect(screen.getByText('Clean')).toBeInTheDocument(), {
      timeout: 5000,
    })
    // Slot 004 (index 3) shows the preset; slot 001 stays Empty.
    expect(screen.getByText('004')).toBeInTheDocument()
  })

  it('saving the current rig into an empty slot places a new preset there', async () => {
    act(() => usePresetManager.setState({ open: true }))
    render(<PresetManager rig={fakeRig} context={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save current rig into slot 1' }))
    await waitFor(async () => expect(await listPresets()).toHaveLength(1), { timeout: 5000 })
    const presets = await listPresets()
    expect(usePresetBankStore.getState().slots[0]).toBe(presets[0]!.id)
  })

  it('deletes an unplaced preset', async () => {
    await savePreset(makePreset('p1', 'Clean'))
    act(() => usePresetManager.setState({ open: true }))
    render(<PresetManager rig={null} context={null} />)
    await waitFor(() => expect(screen.getByText('Clean')).toBeInTheDocument(), {
      timeout: 5000,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Delete Clean' }))
    await waitFor(() => expect(screen.queryByText('Clean')).toBeNull(), { timeout: 5000 })
  })

  it('toggles a preset favorite', async () => {
    await savePreset(makePreset('p1', 'Clean'))
    act(() => usePresetManager.setState({ open: true }))
    render(<PresetManager rig={null} context={null} />)
    await waitFor(() => expect(screen.getByText('Clean')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Favorite Clean' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Favorite Clean' }))
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'Unfavorite Clean' })).toBeInTheDocument(),
      { timeout: 5000 },
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

  it('assigns an unplaced preset to a scene slot via the first free bank slot', async () => {
    const assignSpy = vi.spyOn(useSceneStore.getState(), 'assignSlot')
    await savePreset(makePreset('p1', 'Clean'))
    act(() => usePresetManager.setState({ open: true, pickTarget: { scene: 2, slot: 3 } }))
    render(<PresetManager rig={null} context={null} />)
    await waitFor(() => expect(screen.getByText('Clean')).toBeInTheDocument(), {
      timeout: 5000,
    })
    expect(screen.getByText('ASSIGN TO SCENE 3 · SLOT 4')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Assign Clean' }))
    expect(usePresetBankStore.getState().slots[0]).toBe('p1')
    expect(assignSpy).toHaveBeenCalledWith(2, 3, 0)
  })

  it('assigns a placed preset by pointing the scene slot at its bank slot', async () => {
    const assignSpy = vi.spyOn(useSceneStore.getState(), 'assignSlot')
    await savePreset(makePreset('p1', 'Clean'))
    usePresetBankStore.getState().setSlot(7, 'p1')
    act(() => usePresetManager.setState({ open: true, pickTarget: { scene: 1, slot: 0 } }))
    render(<PresetManager rig={null} context={null} />)
    await waitFor(() => expect(screen.getByText('Clean')).toBeInTheDocument(), {
      timeout: 5000,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Assign Clean' }))
    expect(assignSpy).toHaveBeenCalledWith(1, 0, 7)
  })
})
