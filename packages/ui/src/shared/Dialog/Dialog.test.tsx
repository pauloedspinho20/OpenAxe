import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Dialog } from './Dialog'

describe('Dialog', () => {
  it('closes on Escape and backdrop click unless closeDisabled is set', () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <Dialog open onClose={onClose} title="Shortcuts">
        <p>Help body</p>
      </Dialog>,
    )

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('dialog', { name: 'Shortcuts' }))
    expect(onClose).toHaveBeenCalledTimes(2)

    rerender(
      <Dialog open onClose={onClose} closeDisabled title="Shortcuts">
        <p>Help body</p>
      </Dialog>,
    )

    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('dialog', { name: 'Shortcuts' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
