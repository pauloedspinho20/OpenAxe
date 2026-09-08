// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { LiveMeter, LiveStereoMeter } from './LiveMeter'

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

describe('LiveStereoMeter', () => {
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

  it('renders the L/R pair with a group label and no frame when both sides are null', () => {
    render(<LiveStereoMeter analyserL={null} analyserR={null} label="Output" />)
    expect(screen.getByText('L')).toBeInTheDocument()
    expect(screen.getByText('R')).toBeInTheDocument()
    expect(screen.getByText('Output')).toBeInTheDocument()
    expect(rafCb).toBeNull()
  })

  it('reads both analysers each animation frame when present', () => {
    const analyserL = makeAnalyser()
    const analyserR = makeAnalyser()
    render(<LiveStereoMeter analyserL={analyserL} analyserR={analyserR} />)
    expect(rafCb).not.toBeNull()
    act(() => rafCb!(0))
    expect(analyserL.getByteTimeDomainData).toHaveBeenCalled()
    expect(analyserR.getByteTimeDomainData).toHaveBeenCalled()
  })

  it('reads the present side when only one analyser is given', () => {
    const analyserL = makeAnalyser()
    render(<LiveStereoMeter analyserL={analyserL} analyserR={null} />)
    expect(rafCb).not.toBeNull()
    act(() => rafCb!(0))
    expect(analyserL.getByteTimeDomainData).toHaveBeenCalled()
    expect(screen.getByText('L')).toBeInTheDocument()
    expect(screen.getByText('R')).toBeInTheDocument()
  })
})
