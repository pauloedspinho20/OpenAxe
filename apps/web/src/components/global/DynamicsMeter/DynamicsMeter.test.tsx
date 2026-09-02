// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { DynamicsMeter } from './DynamicsMeter'

// A minimal rig: DynamicsMeter only reads the two metering getters.
type TestRig = { getGainReduction: () => number; getGateGain: () => number }

function makeRig(): TestRig {
  return {
    getGainReduction: vi.fn(() => 0),
    getGateGain: vi.fn(() => 0),
  }
}

// The red-only fill is revealed by a vertical clip-path; the visible bottom
// fraction is (1 - inset-top), i.e. `inset(0%)` = full, `inset(100%)` = empty.
function fillClipPath(container: HTMLElement): string {
  const fill = container.querySelector('[class*="mediumFill"]') as HTMLElement | null
  return fill?.style.clipPath ?? ''
}

// The live value label above the bar.
function valueLabel(container: HTMLElement): string | null {
  const label = container.querySelector('[class*="peakLabel"]') as HTMLElement | null
  return label?.textContent ?? null
}

describe('DynamicsMeter', () => {
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

  const tick = () => act(() => rafCb!(0))

  it('renders no meter for non-dynamics kinds', () => {
    const { container } = render(<DynamicsMeter rig={makeRig() as never} blockId="x1" kind="eq" />)
    expect(container.querySelector('[class*="mediumFill"]')).toBeNull()
  })

  it('maps compressor gain reduction to a fill height', () => {
    const rig = makeRig()
    ;(rig.getGainReduction as ReturnType<typeof vi.fn>).mockReturnValue(-10)
    const { container } = render(
      <DynamicsMeter rig={rig as never} blockId="c1" kind="compressor" />,
    )
    tick()
    expect(fillClipPath(container)).toBe('inset(50% 0 0 0)') // -10 dB of the -20..0 range
  })

  it('compressor at zero reduction shows an empty bar', () => {
    const rig = makeRig()
    const { container } = render(
      <DynamicsMeter rig={rig as never} blockId="c1" kind="compressor" />,
    )
    tick()
    expect(fillClipPath(container)).toBe('inset(100% 0 0 0)')
  })

  it('gate is inverted: a closed gate fills the bar', () => {
    const rig = makeRig()
    ;(rig.getGateGain as ReturnType<typeof vi.fn>).mockReturnValue(0) // fully closed
    const { container } = render(
      <DynamicsMeter rig={rig as never} blockId="g1" kind="noise-gate" />,
    )
    tick()
    expect(fillClipPath(container)).toBe('inset(0% 0 0 0)')
  })

  it('gate is inverted: an open gate shows an empty bar', () => {
    const rig = makeRig()
    ;(rig.getGateGain as ReturnType<typeof vi.fn>).mockReturnValue(1) // fully open
    const { container } = render(
      <DynamicsMeter rig={rig as never} blockId="g1" kind="noise-gate" />,
    )
    tick()
    expect(fillClipPath(container)).toBe('inset(100% 0 0 0)')
  })

  it('gate inverts partial openness into the gated amount', () => {
    const rig = makeRig()
    ;(rig.getGateGain as ReturnType<typeof vi.fn>).mockReturnValue(0.7) // 30% gated
    const { container } = render(
      <DynamicsMeter rig={rig as never} blockId="g1" kind="noise-gate" />,
    )
    tick()
    expect(fillClipPath(container)).toBe('inset(70% 0 0 0)')
  })

  it('renders no GR/Gate text label under the meter', () => {
    const rig = makeRig()
    const { container } = render(
      <DynamicsMeter rig={rig as never} blockId="c1" kind="compressor" />,
    )
    tick()
    expect(container.textContent).not.toContain('GR')
    expect(container.textContent).not.toContain('Gate')
  })

  it('labels the compressor with the peak gain reduction in dB', () => {
    const rig = makeRig()
    ;(rig.getGainReduction as ReturnType<typeof vi.fn>).mockReturnValue(-6.2)
    const { container } = render(
      <DynamicsMeter rig={rig as never} blockId="c1" kind="compressor" />,
    )
    tick()
    expect(valueLabel(container)).toBe('−6.2 dB')
  })

  it('labels the gate with the attenuation: 0 dB when open, deep when closed', () => {
    const open = makeRig()
    ;(open.getGateGain as ReturnType<typeof vi.fn>).mockReturnValue(1)
    const { container: openC } = render(
      <DynamicsMeter rig={open as never} blockId="g1" kind="noise-gate" />,
    )
    tick()
    expect(valueLabel(openC)).toBe('0.0 dB')

    const closed = makeRig()
    ;(closed.getGateGain as ReturnType<typeof vi.fn>).mockReturnValue(0)
    const { container: closedC } = render(
      <DynamicsMeter rig={closed as never} blockId="g1" kind="noise-gate" />,
    )
    tick()
    expect(valueLabel(closedC)).toBe('−100.0 dB')
  })

  it('holds the peak gain reduction on the label for 1 second', () => {
    let now = 0
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now)
    const rig = makeRig()
    ;(rig.getGainReduction as ReturnType<typeof vi.fn>).mockReturnValue(-12)
    const { container } = render(
      <DynamicsMeter rig={rig as never} blockId="c1" kind="compressor" />,
    )
    tick() // t=0: -12 dB enters the window
    expect(valueLabel(container)).toBe('−12.0 dB')

    ;(rig.getGainReduction as ReturnType<typeof vi.fn>).mockReturnValue(-2)
    now = 500
    tick() // t=500: shallower now, but -12 is still inside the trailing 1 s
    expect(valueLabel(container)).toBe('−12.0 dB')

    now = 1500
    tick() // t=1500: the t=0 sample aged out, so the peak rolls back to -2
    expect(valueLabel(container)).toBe('−2.0 dB')

    nowSpy.mockRestore()
  })
})
