import { model } from '@coderline/alphatab'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TouchFretPad } from './TouchFretPad'

afterEach(() => {
  cleanup()
})

// Standard 6-string tuning in alphaTab order (highest string first): E4, B3, G3, D3, A2, E2
const STANDARD = [64, 59, 55, 50, 45, 40]

function makeProps(overrides: Partial<React.ComponentProps<typeof TouchFretPad>> = {}) {
  return {
    tunings: STANDARD,
    capo: 0,
    cursorString: 1,
    cursorNotes: [{ string: 1, fret: 5 }],
    barIndex: 1,
    barCount: 8,
    beatIndex: 2,
    beatDuration: model.Duration.Quarter,
    beatDotted: false,
    beatIsRest: false,
    autoAdvance: true,
    onAutoAdvance: vi.fn(),
    onSelectString: vi.fn(),
    onEnterFret: vi.fn(),
    onClearNote: vi.fn(),
    onRest: vi.fn(),
    onDeadNote: vi.fn(),
    onMoveBeat: vi.fn(),
    onMoveBar: vi.fn(),
    onDuration: vi.fn(),
    onToggleDot: vi.fn(),
    ...overrides,
  }
}

describe('TouchFretPad', () => {
  it('renders string selector ordered high-to-low and allows selecting strings', () => {
    const props = makeProps()
    render(<TouchFretPad {...props} />)

    const lowE = screen.getByRole('button', { name: /String 6 \(E\), fret 5/i })
    expect(lowE).toHaveAttribute('aria-pressed', 'true')

    const highE = screen.getByRole('button', { name: /String 1 \(E\)$/i })
    expect(highE).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(highE)
    expect(props.onSelectString).toHaveBeenCalledWith(6)
  })

  it('switches between 0–12 and 13–24 fret banks and triggers fret entry & clear', () => {
    const props = makeProps()
    render(<TouchFretPad {...props} />)

    const fret5 = screen.getByRole('button', { name: 'Fret 5' })
    expect(fret5).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Fret 7' }))
    expect(props.onEnterFret).toHaveBeenCalledWith(7)

    fireEvent.click(screen.getByRole('button', { name: 'Frets 13 to 24' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fret 15' }))
    expect(props.onEnterFret).toHaveBeenCalledWith(15)

    fireEvent.click(screen.getByRole('button', { name: 'Clear note on active string' }))
    expect(props.onClearNote).toHaveBeenCalledTimes(1)
  })

  it('handles navigation, duration, rest, dead note, and auto-advance toggles', () => {
    const props = makeProps()
    render(<TouchFretPad {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Previous bar' }))
    expect(props.onMoveBar).toHaveBeenCalledWith(-1)

    fireEvent.click(screen.getByRole('button', { name: 'Next beat' }))
    expect(props.onMoveBeat).toHaveBeenCalledWith(1)

    fireEvent.click(screen.getByRole('button', { name: '1/8 note' }))
    expect(props.onDuration).toHaveBeenCalledWith(model.Duration.Eighth)

    fireEvent.click(screen.getByRole('button', { name: 'Dotted' }))
    expect(props.onToggleDot).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Rest' }))
    expect(props.onRest).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Dead note' }))
    expect(props.onDeadNote).toHaveBeenCalledTimes(1)

    fireEvent.click(
      screen.getByRole('button', { name: 'Auto advance to next beat after entering a fret' }),
    )
    expect(props.onAutoAdvance).toHaveBeenCalledWith(false)
  })
})
