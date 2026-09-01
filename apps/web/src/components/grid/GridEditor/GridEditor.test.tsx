// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GridEditor } from './GridEditor'
import { useGraphStore } from '../../../state/graphStore'
import { getShellKind } from '../../../native/openaxe'

vi.mock('../../../native/openaxe', () => ({
  getOpenAxe: vi.fn(() => null),
  getShellKind: vi.fn(() => 'web'),
}))

describe('components/GridEditor', () => {
  beforeEach(() => {
    useGraphStore.setState({ blocks: [], edges: [], masterMuted: false })
    vi.mocked(getShellKind).mockReturnValue('web')
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const baseProps = {
    rig: null,
    tunerAnalyser: null,
    analyser: null,
    outputSelectionSupported: false,
    context: null,
    engine: {
      status: 'off',
      error: null,
      rig: null,
      context: null,
      analyser: null,
      tunerAnalyser: null,
      micGranted: false,
      noSound: false,
      diPlaying: false,
      diSampleId: null,
      diError: null,
      powerOn: async () => {},
      powerOff: async () => {},
      playDI: async () => {},
      stopDI: () => {},
    } as never,
  }

  it('renders the block palette, the inspector placeholder, and the master output rail', () => {
    const { container } = render(<GridEditor {...baseProps} />)
    expect(container.textContent).toContain('Amp')
    expect(container.textContent).toContain('Cab')
    expect(container.textContent).toContain('Select a block in the grid')
    expect(screen.getByRole('button', { name: 'MUTE' })).toBeInTheDocument()
  })

  it('toggles master mute through the graph store', () => {
    const spy = vi.spyOn(useGraphStore.getState(), 'setMasterMuted')
    render(<GridEditor {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'MUTE' }))
    expect(spy).toHaveBeenCalledWith(true)
  })

  describe('the IN/OUT rails in a plugin', () => {
    // A plugin has no devices of its own: the DAW routes a track in and takes
    // the result back, so a device picker there chooses nothing.
    it('offers device pickers on the web', () => {
      render(<GridEditor {...baseProps} />)
      const inButton = screen.getByRole('button', { name: 'IN' })
      expect(inButton).not.toBeDisabled()

      fireEvent.click(inButton)
      expect(screen.getByText('Default input')).toBeInTheDocument()
    })

    it('offers the channel but not the device in a plugin', () => {
      vi.mocked(getShellKind).mockReturnValue('plugin')
      render(<GridEditor {...baseProps} />)

      const inButton = screen.getByRole('button', { name: 'IN' })
      expect(inButton).toHaveAttribute('title', 'Input channel')

      fireEvent.click(inButton)
      // No device to pick — the DAW decides what feeds the plugin — but which
      // channel of that feed reaches the rig is the player's choice.
      expect(screen.queryByText('Default input')).not.toBeInTheDocument()
      expect(screen.getByText('Ch 1+2')).toBeInTheDocument()
    })

    it('does not open an output device picker in a plugin either', () => {
      vi.mocked(getShellKind).mockReturnValue('plugin')
      render(<GridEditor {...baseProps} />)

      const outButton = screen.getByRole('button', { name: 'OUT' })
      expect(outButton).toBeDisabled()
      fireEvent.click(outButton)
      expect(screen.queryByText('Default output')).not.toBeInTheDocument()
    })

    it('keeps the rails themselves, since they are still the jacks cables land on', () => {
      vi.mocked(getShellKind).mockReturnValue('plugin')
      render(<GridEditor {...baseProps} />)
      expect(screen.getByRole('button', { name: 'IN' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'OUT' })).toBeInTheDocument()
    })
  })
})
