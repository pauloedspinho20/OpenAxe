// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { LiveMeter } from './LiveMeter'

function makeAnalyser(fftSize = 8): AnalyserNode {
  return {
    fftSize,
    getByteTimeDomainData: vi.fn((buf: Uint8Array) => {
      // A clear signal: one sample pegged high, rest at silence.
      buf[0] = 255
      for (let i = 1; i < buf.length; i++) buf[i] = 128
    }),
  } as unknown as AnalyserNode
}

describe('LiveMeter', () => {
  let rafCb: FrameRequestCallback | null = null

  beforeEach(() => {
    rafCb = null
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCb = cb
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })

  afterEach(() => {
    rafCb = null
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders the segmented Meter without a label', () => {
    const { container } = render(<LiveMeter analyser={null} />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('renders the Meter with a label', () => {
    render(<LiveMeter analyser={null} label="Input level" />)
    expect(screen.getByText('Input level')).toBeInTheDocument()
  })

  it('renders the MiniMeter for the mini variant', () => {
    const { container } = render(<LiveMeter analyser={null} variant="mini" label="mini" />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('reads the analyser each animation frame when one is present', () => {
    const analyser = makeAnalyser()
    render(<LiveMeter analyser={analyser} />)
    expect(rafCb).not.toBeNull()
    act(() => rafCb!(0))
    expect(analyser.getByteTimeDomainData).toHaveBeenCalled()
  })

  it('renders the medium caption below the bar for the medium variant', () => {
    render(<LiveMeter analyser={null} variant="medium" label="IN" />)
    expect(screen.getByText('IN')).toBeInTheDocument()
  })

  it('does not schedule a frame when there is no analyser', () => {
    render(<LiveMeter analyser={null} />)
    expect(rafCb).toBeNull()
  })
})
