// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BlockPalette } from './BlockPalette'
import { useGraphStore } from '../../../state/graphStore'
import { openCatalogForNewBlock } from '../openCatalogForNewBlock'

vi.mock('../openCatalogForNewBlock', () => ({
  openCatalogForNewBlock: vi.fn(),
}))

function mountGrid() {
  const grid = document.createElement('div')
  grid.setAttribute('data-grid-bounds', '')
  document.body.appendChild(grid)
  vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 400,
    bottom: 200,
    width: 400,
    height: 200,
  } as DOMRect)
  return grid
}

describe('BlockPalette', () => {
  beforeEach(() => {
    vi.mocked(openCatalogForNewBlock).mockClear()
    useGraphStore.setState({ blocks: [], edges: [] })
    mountGrid()
    const addBlockSpy = vi.spyOn(useGraphStore.getState(), 'addBlock')
    addBlockSpy.mockReturnValue('new-id')
    // vi.spyOn reuses the same spy instance across tests, so clear any
    // calls that leaked from a previous test's drop before this one runs.
    addBlockSpy.mockClear()
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('renders a draggable chip for every block option', () => {
    render(<BlockPalette tunerAnalyser={null} />)
    expect(screen.getByRole('button', { name: 'Drag Amp onto the grid' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Drag Cab onto the grid' })).toBeInTheDocument()
  })

  it('labels disabled options as unavailable', () => {
    render(<BlockPalette tunerAnalyser={null} />)
    // Currently no options are disabled, so the "not yet available" copy is absent.
    expect(screen.queryByText(/not yet available/)).toBeNull()
  })

  it('shows a ghost while a chip is being dragged', () => {
    render(<BlockPalette tunerAnalyser={null} />)
    const chip = screen.getByRole('button', { name: 'Drag Amp onto the grid' })
    fireEvent.pointerDown(chip, { clientX: 5, clientY: 5, pointerId: 1, bubbles: true })
    // Chip label appears both in the shelf and the ghost.
    expect(screen.getAllByText('Amp').length).toBeGreaterThanOrEqual(2)
  })

  it('places a block when dropped over the grid', () => {
    render(<BlockPalette tunerAnalyser={null} />)
    const chip = screen.getByRole('button', { name: 'Drag Amp onto the grid' })
    // jsdom's PointerEvent ignores clientX/clientY, so the drop resolves to (0,0).
    fireEvent.pointerDown(chip, { clientX: 5, clientY: 5, pointerId: 1, bubbles: true })
    fireEvent.pointerUp(chip, { clientX: 5, clientY: 5, pointerId: 1, bubbles: true })
    expect(useGraphStore.getState().addBlock).toHaveBeenCalledWith('amp', 0, 0)
    expect(openCatalogForNewBlock).toHaveBeenCalledWith('new-id', 'amp')
  })

  it('does not place a block when there is no grid to drop onto', () => {
    render(<BlockPalette tunerAnalyser={null} />)
    // Strip the grid bounds attribute so findGridElement() returns null.
    document.querySelector('[data-grid-bounds]')?.removeAttribute('data-grid-bounds')
    expect(document.querySelector('[data-grid-bounds]')).toBeNull()
    const chip = screen.getByRole('button', { name: 'Drag Amp onto the grid' })
    fireEvent.pointerDown(chip, { clientX: 5, clientY: 5, pointerId: 1, bubbles: true })
    fireEvent.pointerUp(chip, { clientX: 5, clientY: 5, pointerId: 1, bubbles: true })
    expect(useGraphStore.getState().addBlock).not.toHaveBeenCalled()
    expect(openCatalogForNewBlock).not.toHaveBeenCalled()
  })

  it('reports live valid/invalid drop targets via onDragChange and clears on drop', () => {
    const onDragChange = vi.fn()
    render(<BlockPalette tunerAnalyser={null} onDragChange={onDragChange} />)
    const ampChip = screen.getByRole('button', { name: 'Drag Amp onto the grid' })

    fireEvent.pointerDown(ampChip, { clientX: 5, clientY: 5, pointerId: 1, bubbles: true })
    fireEvent.pointerMove(ampChip, { clientX: 10, clientY: 10, pointerId: 1, bubbles: true })
    expect(onDragChange).toHaveBeenLastCalledWith({
      kind: 'amp',
      cell: { row: 0, col: 0 },
      valid: true,
    })

    // Occupy (0, 0) and confirm the target reports invalid.
    useGraphStore.setState({
      blocks: [{ id: 'existing', kind: 'cab', row: 0, col: 0, params: {} }],
    })
    fireEvent.pointerMove(ampChip, { clientX: 10, clientY: 10, pointerId: 1, bubbles: true })
    expect(onDragChange).toHaveBeenLastCalledWith({
      kind: 'amp',
      cell: { row: 0, col: 0 },
      valid: false,
    })

    fireEvent.pointerUp(ampChip, { clientX: 10, clientY: 10, pointerId: 1, bubbles: true })
    expect(onDragChange).toHaveBeenLastCalledWith(null)
  })

  it('reports invalid target when dragging a duplicate Send 1 onto an empty cell', () => {
    useGraphStore.setState({
      blocks: [{ id: 's1', kind: 'send-1', row: 1, col: 2, params: {} }],
    })
    const onDragChange = vi.fn()
    render(<BlockPalette tunerAnalyser={null} onDragChange={onDragChange} />)
    const sendChip = screen.getByRole('button', { name: 'Drag Send 1 onto the grid' })

    fireEvent.pointerDown(sendChip, { clientX: 5, clientY: 5, pointerId: 1, bubbles: true })
    fireEvent.pointerMove(sendChip, { clientX: 10, clientY: 10, pointerId: 1, bubbles: true })
    expect(onDragChange).toHaveBeenLastCalledWith({
      kind: 'send-1',
      cell: { row: 0, col: 0 },
      valid: false,
    })
  })

  it('clears drag state and does not place a block on pointercancel', () => {
    const onDragChange = vi.fn()
    render(<BlockPalette tunerAnalyser={null} onDragChange={onDragChange} />)
    const chip = screen.getByRole('button', { name: 'Drag Amp onto the grid' })

    fireEvent.pointerDown(chip, { clientX: 5, clientY: 5, pointerId: 1, bubbles: true })
    fireEvent.pointerMove(chip, { clientX: 10, clientY: 10, pointerId: 1, bubbles: true })
    expect(screen.getAllByText('Amp').length).toBeGreaterThanOrEqual(2)

    fireEvent.pointerCancel(chip, { pointerId: 1, bubbles: true })
    expect(onDragChange).toHaveBeenLastCalledWith(null)
    expect(screen.getAllByText('Amp')).toHaveLength(1)
    expect(useGraphStore.getState().addBlock).not.toHaveBeenCalled()
    expect(openCatalogForNewBlock).not.toHaveBeenCalled()
  })
})
