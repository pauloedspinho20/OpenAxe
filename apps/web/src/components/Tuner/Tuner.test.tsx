// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { Tuner } from './Tuner'

const { detectPitch } = vi.hoisted(() => ({ detectPitch: vi.fn() }))
vi.mock('../../tuner/pitchDetect', () => ({ detectPitch }))

function makeAnalyser() {
  return {
    fftSize: 2048,
    context: { sampleRate: 48000 },
    getFloatTimeDomainData: vi.fn((buf: Float32Array) => buf.fill(0)),
  } as unknown as AnalyserNode
}

describe('components/Tuner', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    detectPitch.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows a dash when there is no analyser', () => {
    render(<Tuner analyser={null} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('keeps showing a dash when no pitch is detected', () => {
    const analyser = makeAnalyser()
    detectPitch.mockReturnValue(null)
    render(<Tuner analyser={analyser} />)
    act(() => vi.advanceTimersByTime(100))
    expect(analyser.getFloatTimeDomainData).toHaveBeenCalled()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('renders the detected note and frequency', () => {
    const analyser = makeAnalyser()
    detectPitch.mockReturnValue({ frequency: 440, clarity: 1 })
    render(<Tuner analyser={analyser} />)
    act(() => vi.advanceTimersByTime(100))
    expect(screen.getByText('440.0 Hz')).toBeInTheDocument()
  })

  it('offers A4 calibration in full size and re-detects against the new reference', () => {
    const analyser = makeAnalyser()
    detectPitch.mockReturnValue({ frequency: 432, clarity: 1 })
    render(<Tuner analyser={analyser} size="full" />)
    const input = screen.getByLabelText('A4 reference pitch in Hz')
    fireEvent.change(input, { target: { value: '432' } })
    act(() => vi.advanceTimersByTime(100))
    // 432Hz against a 432Hz reference is also an A4, shown as 432.0 Hz.
    expect(screen.getByText('432.0 Hz')).toBeInTheDocument()
  })
})
