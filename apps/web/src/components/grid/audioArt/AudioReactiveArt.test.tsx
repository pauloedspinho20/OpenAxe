// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'

// A p5 stand-in: registers the sketch's setup/draw, then drives a few frames
// synchronously so the component's draw loop actually executes under test.
vi.mock('p5', () => {
  class P5Mock {
    setup: () => void = () => {}
    draw: () => void = () => {}
    width = 100
    height = 50
    removed = false
    constructor(sketch: (p: P5Mock) => void) {
      sketch(this)
      this.setup()
      for (let i = 0; i < 5; i++) this.draw()
    }
    createCanvas(w: number, h: number) {
      this.width = w
      this.height = h
    }
    frameRate() {}
    millis() {
      return 0
    }
    resizeCanvas(w: number, h: number) {
      this.width = w
      this.height = h
    }
    remove() {
      this.removed = true
    }
    color = () => ({})
    red = () => 0
    green = () => 0
    blue = () => 0
    lerpColor = () => ({})
    map = (_v: number, _a: number, _b: number, c: number, d: number) => (c + d) / 2
    lerp = (a: number, b: number) => (a + b) / 2
    random = (a?: number, b?: number) =>
      a === undefined ? 0.5 : b === undefined ? a * 0.5 : (a + b) / 2
    push = () => {}
    pop = () => {}
    translate = () => {}
    rotate = () => {}
    noFill = () => {}
    fill = () => {}
    noStroke = () => {}
    stroke = () => {}
    strokeWeight = () => {}
    beginShape = () => {}
    vertex = () => {}
    endShape = () => {}
    rect = () => {}
    ellipse = () => {}
    arc = () => {}
    TWO_PI = Math.PI * 2
    PI = Math.PI
    CLOSE = 'close'
  }
  return { default: P5Mock }
})

import { AudioReactiveArt } from './AudioReactiveArt'

function makeAnalyser(): AnalyserNode {
  return {
    fftSize: 64,
    frequencyBinCount: 32,
    getByteTimeDomainData: () => {},
    getByteFrequencyData: () => {},
  } as unknown as AnalyserNode
}

describe('AudioReactiveArt', () => {
  beforeEach(() => {
    // canvas2dSupported() must return true so the effect creates the sketch.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      {} as CanvasRenderingContext2D,
    )
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders a host element (jsdom has no canvas, so no sketch is created)', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('Not implemented')
    })
    const { container } = render(<AudioReactiveArt analyser={null} variant="master" />)
    expect(container.querySelector('div')).toBeInTheDocument()
  })

  it('creates a p5 sketch that draws frames when a canvas is available', () => {
    const { container } = render(<AudioReactiveArt analyser={null} variant="master" />)
    // The mock runs setup + 5 draws synchronously on construction.
    expect(container.querySelector('div')).toBeInTheDocument()
  })

  it('reads the live analyser each frame when one is supplied', () => {
    const analyser = makeAnalyser()
    const timeSpy = vi.spyOn(analyser, 'getByteTimeDomainData')
    const freqSpy = vi.spyOn(analyser, 'getByteFrequencyData')
    render(<AudioReactiveArt analyser={analyser} variant="reverb" />)
    expect(timeSpy).toHaveBeenCalled()
    expect(freqSpy).toHaveBeenCalled()
  })

  it('removes the sketch on unmount', () => {
    const { unmount } = render(<AudioReactiveArt analyser={null} variant="master" />)
    expect(() => act(() => unmount())).not.toThrow()
  })
})
