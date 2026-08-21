import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HardwareButton } from './HardwareButton'
import styles from './HardwareButton.module.css'

describe('HardwareButton', () => {
  it('renders the label and calls onClick when clicked', () => {
    const onClick = vi.fn()
    render(<HardwareButton label="Tap" onClick={onClick} />)
    screen.getByRole('button', { name: 'Tap' }).click()
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('reflects active state via aria-pressed and a visual class', () => {
    const { container, rerender } = render(<HardwareButton label="Tap" active onClick={() => {}} />)
    const button = screen.getByRole('button', { name: 'Tap' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button).toHaveClass(styles.active)

    rerender(<HardwareButton label="Tap" active={false} onClick={() => {}} />)
    expect(container.querySelector('button')).not.toHaveClass(styles.active)
  })

  it('applies the requested variant class', () => {
    render(<HardwareButton label="Reset" variant="danger" onClick={() => {}} />)
    expect(screen.getByRole('button', { name: 'Reset' })).toHaveClass(styles.danger)
  })

  it('is disabled and inert when disabled', () => {
    const onClick = vi.fn()
    render(<HardwareButton label="Tap" onClick={onClick} disabled />)
    const button = screen.getByRole('button', { name: 'Tap' })
    expect(button).toBeDisabled()
    button.click()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('forwards the title attribute for a tooltip', () => {
    render(<HardwareButton label="Tap" onClick={() => {}} title="Tap tempo" />)
    expect(screen.getByRole('button', { name: 'Tap' })).toHaveAttribute('title', 'Tap tempo')
  })
})
