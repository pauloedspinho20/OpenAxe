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

  describe('snapTo detent', () => {
    const setup = (onChange = vi.fn()) => {
      render(
        <Fader
          label="Band"
          value={3}
          min={-12}
          max={12}
          step={0.5}
          snapTo={0}
          onChange={onChange}
        />,
      )
      return { onChange, input: screen.getByRole('slider', { name: 'Band' }) }
    }

    it('snaps a pointer drag that lands near the detent', () => {
      const { onChange, input } = setup()
      fireEvent.pointerDown(input)
      fireEvent.change(input, { target: { value: '0.5' } })
      expect(onChange).toHaveBeenLastCalledWith(0)
      fireEvent.change(input, { target: { value: '5' } })
      expect(onChange).toHaveBeenLastCalledWith(5)
    })

    it('does not snap keyboard steps, so fine adjustment stays reachable', () => {
      const { onChange, input } = setup()
      fireEvent.keyDown(input, { key: 'ArrowUp' })
      fireEvent.change(input, { target: { value: '0.5' } })
      expect(onChange).toHaveBeenLastCalledWith(0.5)
    })

    it('resets to the detent on double-click', () => {
      const { onChange, input } = setup()
      fireEvent.doubleClick(input)
      expect(onChange).toHaveBeenCalledWith(0)
    })
  })

  it('shows the value in a tooltip instead of a label when valueDisplay is tooltip', () => {
    const { container } = render(
      <Fader
        label="Band"
        value={2}
        onChange={() => {}}
        formatValue={(v) => `${v}dB`}
        valueDisplay="tooltip"
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('2dB')
    expect(container.querySelectorAll('[class*="value"]')).toHaveLength(0)
  })
})
