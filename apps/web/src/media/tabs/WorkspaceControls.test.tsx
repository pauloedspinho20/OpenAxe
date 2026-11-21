import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ToolbarButton, WorkspacePopover } from './WorkspaceControls'

afterEach(() => {
  cleanup()
})

describe('ToolbarButton', () => {
  it('omits aria-pressed on one-shot action buttons', () => {
    const onClick = vi.fn()
    render(<ToolbarButton label="Export" text="Export" onClick={onClick} />)
    const btn = screen.getByRole('button', { name: 'Export' })
    expect(btn.hasAttribute('aria-pressed')).toBe(false)
    fireEvent.click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('sets aria-pressed on toggle buttons and blocks clicks when aria-disabled', () => {
    const onClick = vi.fn()
    const { rerender } = render(
      <ToolbarButton label="Metronome" text="Click" pressed={false} onClick={onClick} />,
    )
    const btn = screen.getByRole('button', { name: 'Metronome' })
    expect(btn).toHaveAttribute('aria-pressed', 'false')

    rerender(
      <ToolbarButton label="Metronome" text="Click" pressed={true} disabled onClick={onClick} />,
    )
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    expect(btn).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('WorkspacePopover', () => {
  it('toggles open/closed on click, Escape, and outside pointerdown', () => {
    render(
      <div>
        <button type="button">Outside</button>
        <WorkspacePopover label="View">
          {(close) => (
            <button type="button" onClick={close}>
              Dark sheet
            </button>
          )}
        </WorkspacePopover>
      </div>,
    )
    const trigger = screen.getByRole('button', { name: 'View' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const item = screen.getByRole('button', { name: 'Dark sheet' })
    expect(item).toBeVisible()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }))
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })
})
