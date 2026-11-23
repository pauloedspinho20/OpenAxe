import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Stepper } from './Stepper'

describe('Stepper', () => {
  it('calls decrement, increment, and reset callbacks cleanly', () => {
    const onDecrement = vi.fn()
    const onIncrement = vi.fn()
    const onReset = vi.fn()

    render(
      <Stepper
        label="Speed"
        value="100%"
        onDecrement={onDecrement}
        onIncrement={onIncrement}
        onReset={onReset}
        decrementLabel="Slower"
        incrementLabel="Faster"
        resetLabel="Reset speed"
      />,
    )

    expect(screen.getByRole('group', { name: 'Speed' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Slower' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reset speed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Faster' }))

    expect(onDecrement).toHaveBeenCalledOnce()
    expect(onReset).toHaveBeenCalledOnce()
    expect(onIncrement).toHaveBeenCalledOnce()
  })

  it('renders an accessible output readout when onReset is omitted', () => {
    render(
      <Stepper
        label="Waveform zoom"
        value="fit"
        onDecrement={() => {}}
        onIncrement={() => {}}
        decrementLabel="Zoom out"
        incrementLabel="Zoom in"
        decrementDisabled
      />,
    )

    expect(screen.getByRole('status', { name: 'Waveform zoom' })).toHaveTextContent('fit')
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled()
  })
})
