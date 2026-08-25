import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { IconButton } from './IconButton'

describe('IconButton', () => {
  it('renders with aria-label and calls onClick', () => {
    const onClick = vi.fn()
    render(
      <IconButton label="Undo" onClick={onClick}>
        <span>↩</span>
      </IconButton>,
    )
    const btn = screen.getByRole('button', { name: 'Undo' })
    btn.click()
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('is disabled when disabled and inert', () => {
    const onClick = vi.fn()
    render(
      <IconButton label="Redo" onClick={onClick} disabled>
        <span>↪</span>
      </IconButton>,
    )
    const btn = screen.getByRole('button', { name: 'Redo' })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-disabled', 'true')
    btn.click()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('forwards title for tooltip', () => {
    render(
      <IconButton label="Undo" title="Undo (Ctrl+Z)" onClick={() => {}}>
        <span>↩</span>
      </IconButton>,
    )
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveAttribute('title', 'Undo (Ctrl+Z)')
  })
})
