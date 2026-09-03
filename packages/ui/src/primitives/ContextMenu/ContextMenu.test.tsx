import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { clampMenuPosition } from './position'

const items: ContextMenuItem[] = [
  { id: 'bypass', label: 'Bypass', onSelect: vi.fn() },
  { id: 'remove', label: 'Remove', danger: true, onSelect: vi.fn() },
  { id: 'disabled', label: 'Unavailable', disabled: true, onSelect: vi.fn() },
]

function openMenu(overrides: Partial<Parameters<typeof ContextMenu>[0]> = {}) {
  const onClose = vi.fn()
  render(
    <ContextMenu open anchor={{ x: 100, y: 120 }} items={items} onClose={onClose} {...overrides} />,
  )
  return { onClose }
}

describe('ContextMenu', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <ContextMenu open={false} anchor={{ x: 0, y: 0 }} items={items} onClose={() => {}} />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(document.body.querySelector('[role="menu"]')).toBeNull()
  })

  it('renders the items in a portal with menu semantics', () => {
    openMenu()
    const menu = screen.getByRole('menu', { name: 'Context menu' })
    expect(menu).toBeInTheDocument()
    expect(screen.getAllByRole('menuitem')).toHaveLength(3)
    expect(screen.getByRole('menuitem', { name: 'Bypass' })).toBeInTheDocument()
  })

  it('selecting an item calls onSelect then onClose', () => {
    const { onClose } = openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Bypass' }))
    expect(items[0]?.onSelect).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a disabled item cannot be selected', () => {
    const { onClose } = openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unavailable' }))
    expect(items[2]?.onSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Escape closes the menu', () => {
    const { onClose } = openMenu()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a pointer-down outside the menu closes it', () => {
    const { onClose } = openMenu()
    fireEvent.pointerDown(document.body, { bubbles: true })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a pointer-down inside the menu does not close it', () => {
    const { onClose } = openMenu()
    fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'Bypass' }), { bubbles: true })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('arrow keys move focus between enabled items', () => {
    openMenu()
    // Opening the menu focuses the first enabled item.
    expect(screen.getByRole('menuitem', { name: 'Bypass' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Remove' })).toHaveFocus()
    // The disabled entry is skipped - focus wraps back to the first item.
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Bypass' })).toHaveFocus()
  })
})

describe('clampMenuPosition', () => {
  const viewport = { width: 800, height: 600 }
  const menuSize = { width: 200, height: 150 }

  it('leaves a comfortably-inside anchor alone', () => {
    expect(clampMenuPosition({ x: 100, y: 100 }, menuSize, viewport)).toEqual({ x: 100, y: 100 })
  })

  it('pulls the menu back from the right and bottom edges', () => {
    expect(clampMenuPosition({ x: 750, y: 550 }, menuSize, viewport)).toEqual({
      x: 592,
      y: 442,
    })
  })

  it('never goes past the top-left margin', () => {
    expect(clampMenuPosition({ x: 2, y: 0 }, menuSize, viewport)).toEqual({ x: 8, y: 8 })
  })
})
