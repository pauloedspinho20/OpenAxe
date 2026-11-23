import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { WorkspacePopover } from './WorkspaceControls'

afterEach(() => {
  cleanup()
})

describe('WorkspacePopover', () => {
  it('toggles open/closed on click, Escape, and outside pointerdown', () => {
    render(
      <div>
        <button type="button">Outside</button>
        <WorkspacePopover label="View" badge="ON" triggerText="100%">
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
    expect(trigger).toHaveTextContent('100%')
    expect(trigger).toHaveTextContent('ON')

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
