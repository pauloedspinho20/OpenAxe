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

  it('keeps disabled button focusable with aria-disabled when focusableWhenDisabled is set', () => {
    const onClick = vi.fn()
    render(<HardwareButton label="Delete" onClick={onClick} disabled focusableWhenDisabled />)
    const button = screen.getByRole('button', { name: 'Delete' })
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveAttribute('data-disabled', 'true')
    button.click()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('forwards the title attribute for a tooltip', () => {
    render(<HardwareButton label="Tap" onClick={() => {}} title="Tap tempo" />)
    expect(screen.getByRole('button', { name: 'Tap' })).toHaveAttribute('title', 'Tap tempo')
  })

  it('omits aria-pressed for one-shot buttons and sets it explicitly on toggles', () => {
    const { rerender } = render(<HardwareButton label="Save" onClick={() => {}} />)
    expect(screen.getByRole('button', { name: 'Save' })).not.toHaveAttribute('aria-pressed')

    rerender(<HardwareButton label="Loop" active={false} onClick={() => {}} />)
    expect(screen.getByRole('button', { name: 'Loop' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('maps role="radio", role="tab", and ariaCurrent to the matching ARIA attributes', () => {
    const { rerender } = render(
      <HardwareButton role="radio" label="MIDI" active onClick={() => {}} />,
    )
    const radio = screen.getByRole('radio', { name: 'MIDI' })
    expect(radio).toHaveAttribute('aria-checked', 'true')
    expect(radio).not.toHaveAttribute('aria-pressed')

    rerender(<HardwareButton role="tab" label="Tracks" active={false} onClick={() => {}} />)
    const tab = screen.getByRole('tab', { name: 'Tracks' })
    expect(tab).toHaveAttribute('aria-selected', 'false')
    expect(tab).not.toHaveAttribute('aria-pressed')

    rerender(<HardwareButton label="RIG" ariaCurrent="page" onClick={() => {}} />)
    const pageBtn = screen.getByRole('button', { name: 'RIG' })
    expect(pageBtn).toHaveAttribute('aria-current', 'page')
    expect(pageBtn).not.toHaveAttribute('aria-pressed')
    expect(pageBtn).toHaveClass(styles.active)
  })

  it('renders badge, trailingIcon, hideLabelBelow accessible name, and ariaControls', () => {
    render(
      <HardwareButton
        label="View"
        hideLabelBelow="sm"
        badge={3}
        trailingIcon={<span data-testid="caret">v</span>}
        ariaControls="menu-id"
        onClick={() => {}}
      />,
    )
    const button = screen.getByRole('button', { name: /View/ })
    expect(button).toHaveAttribute('aria-label', 'View')
    expect(button).toHaveAttribute('aria-controls', 'menu-id')
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByTestId('caret')).toBeInTheDocument()
  })

  it('supports submit buttons without onClick, accent variant, ariaExpanded, and className', () => {
    render(
      <HardwareButton
        type="submit"
        label="Create"
        variant="accent"
        ariaExpanded={true}
        className="customCls"
      />,
    )
    const button = screen.getByRole('button', { name: 'Create' })
    expect(button).toHaveAttribute('type', 'submit')
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(button).toHaveClass(styles.accent)
    expect(button).toHaveClass('customCls')
  })
})
