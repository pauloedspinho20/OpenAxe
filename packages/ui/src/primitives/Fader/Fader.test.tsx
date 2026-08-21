import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Fader } from './Fader'

describe('Fader', () => {
  it('renders a range input with the value and label', () => {
    render(<Fader label="Output" value={0.8} onChange={() => {}} />)
    const input = screen.getByRole('slider', { name: 'Output' })
    expect(input).toHaveValue('0.8')
    expect(screen.getByText('Output')).toBeInTheDocument()
  })

  it('defaults to a 0-1.5 range', () => {
    render(<Fader label="Level" value={1} onChange={() => {}} />)
    const input = screen.getByRole('slider', { name: 'Level' })
    expect(input).toHaveAttribute('min', '0')
    expect(input).toHaveAttribute('max', '1.5')
  })

  it('calls onChange with a number when moved', () => {
    const onChange = vi.fn()
    render(<Fader label="Output" value={0.5} onChange={onChange} />)
    fireEvent.change(screen.getByRole('slider', { name: 'Output' }), { target: { value: '1.2' } })
    expect(onChange).toHaveBeenCalledWith(1.2)
  })

  it('shows the formatted value when formatValue is given', () => {
    render(<Fader label="Output" value={0.5} onChange={() => {}} formatValue={(v) => `${v}dB`} />)
    expect(screen.getByText('0.5dB')).toBeInTheDocument()
  })

  it('is disabled when disabled is set', () => {
    render(<Fader label="Output" value={0.5} onChange={() => {}} disabled />)
    expect(screen.getByRole('slider', { name: 'Output' })).toBeDisabled()
  })
})
