// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MidiManager } from './MidiManager'
import { useMidiManager } from '../../../state/midiManager'
import { useMidiStore } from '../../../state/midiStore'
import * as midiAccess from '../../../midi/midiAccess'

function openManager(state: Partial<ReturnType<typeof useMidiStore.getState>> = {}) {
  act(() => {
    useMidiManager.setState({ open: true })
    useMidiStore.setState({
      supported: true,
      permission: 'granted',
      inputs: [{ id: 'i1', name: 'Device 1' }],
      selectedInputId: 'i1',
      mappings: [],
      lastMessage: null,
      learning: null,
      ...state,
    })
  })
}

describe('MidiManager', () => {
  beforeEach(() => {
    vi.spyOn(midiAccess, 'armLearn').mockImplementation(() => {})
    vi.spyOn(midiAccess, 'requestMidiAccess').mockImplementation(() => Promise.resolve())
  })

  afterEach(() => {
    act(() => {
      useMidiManager.setState({ open: false })
      useMidiStore.setState({ supported: false, permission: 'unknown', inputs: [], mappings: [] })
    })
    vi.restoreAllMocks()
  })

  it('renders nothing when the manager is closed', () => {
    act(() => useMidiManager.setState({ open: false }))
    render(<MidiManager />)
    expect(screen.queryByText('MIDI CONTROL')).toBeNull()
  })

  it('prompts to use a supported browser when Web MIDI is unsupported', () => {
    openManager({ supported: false })
    render(<MidiManager />)
    expect(screen.getByText(/doesn't support the Web MIDI API/)).toBeInTheDocument()
  })

  it('shows an enable button when supported but not yet granted', () => {
    openManager({ permission: 'prompt' })
    render(<MidiManager />)
    fireEvent.click(screen.getByRole('button', { name: 'Enable MIDI' }))
    expect(midiAccess.requestMidiAccess).toHaveBeenCalled()
  })

  it('lists connected devices and renders mapping rows when connected', () => {
    openManager()
    render(<MidiManager />)
    expect(screen.getByText('1 device connected')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Device 1' })).toBeInTheDocument()
    // Slot 0 trigger row is present.
    expect(screen.getByRole('button', { name: 'Clear Slot 1' })).toBeInTheDocument()
  })

  it('arms learn when a mapping row Learn button is clicked', () => {
    openManager()
    render(<MidiManager />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Learn' })[0]!)
    expect(midiAccess.armLearn).toHaveBeenCalled()
  })

  it('shows a formatted binding and clears it via the Clear button', () => {
    const clearSpy = vi.spyOn(useMidiStore.getState(), 'clearMappingForAction')
    openManager({
      mappings: [
        {
          id: 'm1',
          action: { kind: 'slot', slot: 0 },
          match: { type: 'cc', channel: 0, number: 10 },
        },
      ],
    })
    render(<MidiManager />)
    // formatMidiMatch renders 'CC 10 (ch 1)' for the slot 0 binding.
    expect(screen.getByText('CC 10 (ch 1)')).toBeInTheDocument()
    const clear = screen.getByRole('button', { name: 'Clear Slot 1' })
    expect(clear).toBeEnabled()
    fireEvent.click(clear)
    expect(clearSpy).toHaveBeenCalled()
  })

  it('cancels an in-progress learn when the Learn button is clicked again', () => {
    const cancelSpy = vi.spyOn(useMidiStore.getState(), 'cancelLearn')
    openManager({
      learning: { actionKey: 'slot:0', action: { kind: 'slot', slot: 0 } },
    })
    render(<MidiManager />)
    fireEvent.click(screen.getByRole('button', { name: 'Listening…' }))
    expect(cancelSpy).toHaveBeenCalled()
  })

  it('resets all mappings via the danger button', () => {
    const resetSpy = vi.spyOn(useMidiStore.getState(), 'resetAll')
    openManager()
    render(<MidiManager />)
    fireEvent.click(screen.getByRole('button', { name: 'Reset all mappings' }))
    expect(resetSpy).toHaveBeenCalled()
  })
})
