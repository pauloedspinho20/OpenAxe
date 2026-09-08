// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BlockCard } from './BlockCard'
import { useGraphStore, type BlockInstance } from '../../../state/graphStore'
import { useSelection } from '../../../state/selection'

function inst(over: Partial<BlockInstance>): BlockInstance {
  return { id: 'b1', kind: 'reverb', row: 0, col: 0, params: {}, ...over }
}

describe('BlockCard', () => {
  beforeEach(() => {
    useSelection.setState({ selectedBlockId: null })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the label, a bypass toggle, and an actions menu for an effect block', () => {
    render(<BlockCard instance={inst({ kind: 'reverb' })} rig={null} />)
    const card = screen.getByRole('button', { name: /Reverb block/ })
    expect(card).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bypass Reverb' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Actions for Reverb' })).toBeInTheDocument()
  })

  it('renders the amp label without inline asset status text', () => {
    render(<BlockCard instance={inst({ kind: 'amp' })} rig={null} />)
    expect(screen.getByText('Amp')).toBeInTheDocument()
    expect(screen.queryByText('No model')).not.toBeInTheDocument()
  })

  it('renders the cab label without inline asset status text', () => {
    render(<BlockCard instance={inst({ kind: 'cab' })} rig={null} />)
    expect(screen.getByText('Cab')).toBeInTheDocument()
    expect(screen.queryByText('No IR')).not.toBeInTheDocument()
  })

  it('renders one input/output jack for a single-io block', () => {
    const { container } = render(<BlockCard instance={inst({ kind: 'reverb' })} rig={null} />)
    expect(container.querySelectorAll('[data-jack-side="in"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-jack-side="out"]')).toHaveLength(1)
  })

  it('renders four input jacks for a mixer', () => {
    const { container } = render(<BlockCard instance={inst({ kind: 'mixer' })} rig={null} />)
    expect(container.querySelectorAll('[data-jack-side="in"]')).toHaveLength(4)
  })

  it('renders a single output jack for an effect', () => {
    // The splitter was the only kind with more than one, and it is gone, so
    // every kind except a send now draws exactly one output jack.
    const { container } = render(<BlockCard instance={inst({ kind: 'reverb' })} rig={null} />)
    expect(container.querySelectorAll('[data-jack-side="out"]')).toHaveLength(1)
  })

  it('renders no output jack for a send', () => {
    const { container } = render(<BlockCard instance={inst({ kind: 'send-1' })} rig={null} />)
    expect(container.querySelectorAll('[data-jack-side="out"]')).toHaveLength(0)
  })

  it('toggles bypass through the graph store', () => {
    const spy = vi.spyOn(useGraphStore.getState(), 'setBlockBypass')
    render(<BlockCard instance={inst({ kind: 'reverb', bypass: false })} rig={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Bypass Reverb' }))
    expect(spy).toHaveBeenCalledWith('b1', true)
  })

  it('opens the actions menu for the block', () => {
    const onOpenMenu = vi.fn()
    render(<BlockCard instance={inst({ kind: 'reverb' })} rig={null} onOpenMenu={onOpenMenu} />)
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Reverb' }))
    expect(onOpenMenu).toHaveBeenCalled()
  })

  it('moves the block with arrow keys', () => {
    const spy = vi.spyOn(useGraphStore.getState(), 'moveBlock')
    render(<BlockCard instance={inst({ kind: 'reverb', row: 1, col: 1 })} rig={null} />)
    fireEvent.keyDown(screen.getByRole('button', { name: /Reverb block/ }), {
      key: 'ArrowRight',
    })
    expect(spy).toHaveBeenCalledWith('b1', 1, 2)
  })

  it('selects the block on a click (pointer down + up without movement)', () => {
    const spy = vi.spyOn(useSelection.getState(), 'select')
    render(<BlockCard instance={inst({ kind: 'reverb' })} rig={null} />)
    const card = screen.getByRole('button', { name: /Reverb block/ })
    fireEvent.pointerDown(card, { clientX: 10, clientY: 10, pointerId: 1, bubbles: true })
    fireEvent.pointerUp(card, { clientX: 10, clientY: 10, pointerId: 1, bubbles: true })
    expect(spy).toHaveBeenCalledWith('b1')
  })

  it('opens a context menu on right-click with bypass and remove entries', () => {
    render(<BlockCard instance={inst({ kind: 'reverb' })} rig={null} />)
    fireEvent.contextMenu(screen.getByRole('button', { name: /Reverb block/ }), {
      clientX: 50,
      clientY: 60,
    })
    expect(screen.getByRole('menu', { name: 'Reverb actions' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Bypass block' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Disconnect all cables' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Remove block' })).toBeInTheDocument()
  })

  it('right-click selects the block without opening the action sheet', () => {
    const select = vi.spyOn(useSelection.getState(), 'select')
    const onOpenMenu = vi.fn()
    render(<BlockCard instance={inst({ kind: 'reverb' })} rig={null} onOpenMenu={onOpenMenu} />)
    fireEvent.contextMenu(screen.getByRole('button', { name: /Reverb block/ }), {
      clientX: 50,
      clientY: 60,
    })
    expect(select).toHaveBeenCalledWith('b1')
    expect(onOpenMenu).not.toHaveBeenCalled()
  })

  it('removes the block from the context menu', () => {
    const spy = vi.spyOn(useGraphStore.getState(), 'removeBlock')
    render(<BlockCard instance={inst({ kind: 'reverb' })} rig={null} />)
    fireEvent.contextMenu(screen.getByRole('button', { name: /Reverb block/ }), {
      clientX: 50,
      clientY: 60,
    })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove block' }))
    expect(spy).toHaveBeenCalledWith('b1')
  })

  it('opens the action sheet from the context menu More actions entry', () => {
    const onOpenMenu = vi.fn()
    render(<BlockCard instance={inst({ kind: 'reverb' })} rig={null} onOpenMenu={onOpenMenu} />)
    fireEvent.contextMenu(screen.getByRole('button', { name: /Reverb block/ }), {
      clientX: 50,
      clientY: 60,
    })
    fireEvent.click(screen.getByRole('menuitem', { name: 'More actions…' }))
    expect(onOpenMenu).toHaveBeenCalledTimes(1)
  })
})
