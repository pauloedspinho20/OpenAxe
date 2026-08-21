import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Toggle } from './Toggle'

describe('Toggle', () => {
  it('renders as a switch reflecting checked state', () => {
    render(<Toggle label="Bypass" checked onChange={() => {}} />)
    expect(screen.getByRole('switch', { name: 'Bypass' })).toHaveAttribute('aria-checked', 'true')
  })

  it('calls onChange with the inverted state on click', () => {
    const onChange = vi.fn()
    render(<Toggle label="Bypass" checked={false} onChange={onChange} />)
    screen.getByRole('switch', { name: 'Bypass' }).click()
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('does not call onChange when disabled', () => {
    const onChange = vi.fn()
    render(<Toggle label="Bypass" checked={false} onChange={onChange} disabled />)
    const toggle = screen.getByRole('switch', { name: 'Bypass' })
    expect(toggle).toBeDisabled()
    toggle.click()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('renders the label text', () => {
    render(<Toggle label="Tuner Mute" checked={false} onChange={() => {}} />)
    expect(screen.getByText('Tuner Mute')).toBeInTheDocument()
  })
})
