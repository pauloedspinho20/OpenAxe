// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GridEditor } from './GridEditor'
import { useGraphStore } from '../../../state/graphStore'

vi.mock('../../../native/openaxe', () => ({ getOpenAxe: vi.fn(() => null) }))

describe('components/GridEditor', () => {
  beforeEach(() => {
    useGraphStore.setState({ blocks: [], edges: [], masterMuted: false })
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
})
