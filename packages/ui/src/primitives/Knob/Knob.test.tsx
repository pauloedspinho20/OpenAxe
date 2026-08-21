import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Knob } from './Knob'

// jsdom doesn't implement pointer capture; Knob's drag gesture calls it
// unconditionally on pointerdown/up, so stub it once for every test here.
beforeAll(() => {
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})

describe('Knob', () => {
  it('renders as a slider with the value reflected in ARIA attributes', () => {
    render(<Knob label="Drive" value={0.5} min={0} max={1} onChange={() => {}} />)
    const slider = screen.getByRole('slider', { name: 'Drive' })
    expect(slider).toHaveAttribute('aria-valuemin', '0')
    expect(slider).toHaveAttribute('aria-valuemax', '1')
    expect(slider).toHaveAttribute('aria-valuenow', '0.5')
    // SVG attribute lookups are case-sensitive in the DOM, unlike HTML's;
    // React reflects the tabIndex prop as the lowercase "tabindex" attribute.
    expect(slider).toHaveAttribute('tabindex', '0')
  })

  it('shows the formatted value when formatValue is given', () => {
    render(
      <Knob
        label="Time"
        value={250}
        min={0}
        max={1000}
        onChange={() => {}}
        formatValue={(v) => `${v}ms`}
      />,
    )
    expect(screen.getByText('250ms')).toBeInTheDocument()
  })

  it('steps up/down on arrow keys, clamped to [min, max]', () => {
    const onChange = vi.fn()
    render(<Knob label="Rate" value={0.98} min={0} max={1} step={0.05} onChange={onChange} />)
    const slider = screen.getByRole('slider', { name: 'Rate' })

    fireEvent.keyDown(slider, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith(1) // clamped to max, not 1.03

    fireEvent.keyDown(slider, { key: 'ArrowDown' })
    expect(onChange.mock.calls.at(-1)?.[0]).toBeCloseTo(0.95)
  })

  it('Home/End jump to min/max', () => {
    const onChange = vi.fn()
    render(<Knob label="Mix" value={0.5} min={0} max={1} onChange={onChange} />)
    const slider = screen.getByRole('slider', { name: 'Mix' })

    fireEvent.keyDown(slider, { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith(1)
    fireEvent.keyDown(slider, { key: 'Home' })
    expect(onChange).toHaveBeenLastCalledWith(0)
  })

  it('PageUp/PageDown move by (max-min)/20, independent of step', () => {
    const onChange = vi.fn()
    render(<Knob label="Depth" value={10} min={0} max={200} step={1} onChange={onChange} />)
    const slider = screen.getByRole('slider', { name: 'Depth' })

    fireEvent.keyDown(slider, { key: 'PageUp' })
    expect(onChange).toHaveBeenLastCalledWith(20) // 10 + (200-0)/20

    fireEvent.keyDown(slider, { key: 'PageDown' })
    expect(onChange).toHaveBeenLastCalledWith(0) // 10 - 10
  })

  it('double-click resets to defaultValue', () => {
    const onChange = vi.fn()
    render(<Knob label="Feedback" value={0.9} defaultValue={0.3} onChange={onChange} />)
    fireEvent.doubleClick(screen.getByRole('slider', { name: 'Feedback' }))
    expect(onChange).toHaveBeenCalledWith(0.3)
  })

  it('double-click is a no-op when no defaultValue is given', () => {
    const onChange = vi.fn()
    render(<Knob label="Feedback" value={0.9} onChange={onChange} />)
    fireEvent.doubleClick(screen.getByRole('slider', { name: 'Feedback' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('drags vertically to change the value, and ignores drag when disabled', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <Knob label="Level" value={0.5} min={0} max={1} onChange={onChange} />,
    )
    const slider = screen.getByRole('slider', { name: 'Level' })

    fireEvent.pointerDown(slider, { clientY: 100 })
    fireEvent.pointerMove(slider, { clientY: 50 }) // dragged up -> value increases
    expect(onChange).toHaveBeenCalled()
    const [firstArg] = onChange.mock.calls[0]
    expect(firstArg).toBeGreaterThan(0.5)
    fireEvent.pointerUp(slider) // clear drag state before switching to disabled below

    onChange.mockClear()
    rerender(<Knob label="Level" value={0.5} min={0} max={1} onChange={onChange} disabled />)
    fireEvent.pointerDown(screen.getByRole('slider', { name: 'Level' }), { clientY: 100 })
    fireEvent.pointerMove(screen.getByRole('slider', { name: 'Level' }), { clientY: 50 })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('is keyboard-inert and untabbable when disabled', () => {
    const onChange = vi.fn()
    render(<Knob label="Tone" value={0.5} onChange={onChange} disabled />)
    const slider = screen.getByRole('slider', { name: 'Tone' })
    expect(slider).toHaveAttribute('tabindex', '-1')
    expect(slider).toHaveAttribute('aria-disabled', 'true')
    fireEvent.keyDown(slider, { key: 'ArrowUp' })
    expect(onChange).not.toHaveBeenCalled()
  })
})
