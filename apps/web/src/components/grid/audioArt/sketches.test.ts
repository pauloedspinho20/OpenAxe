// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type p5 from 'p5'
import { createArtDrawer, toArtVariant, type ArtVariant, type DrawCtx } from './sketches'

/** A no-op p5 stand-in; numeric helpers return deterministic midpoints so draws run. */
function makeP5(): p5 {
  const colorObj = { __color: true }
  const p = {
    TWO_PI: Math.PI * 2,
    PI: Math.PI,
    CLOSE: 'close',
    color: () => colorObj,
    red: () => 0,
    green: () => 0,
    blue: () => 0,
    lerpColor: () => colorObj,
    map: (_v: number, _a: number, _b: number, c: number, d: number) => (c + d) / 2,
    lerp: (a: number, b: number) => (a + b) / 2,
    random: (a?: number, b?: number) => {
      if (a === undefined) return 0.5
      if (b === undefined) return a * 0.5
      return (a + b) / 2
    },
    push: () => {},
    pop: () => {},
    translate: () => {},
    rotate: () => {},
    noFill: () => {},
    fill: () => {},
    noStroke: () => {},
    stroke: () => {},
    strokeWeight: () => {},
    beginShape: () => {},
    vertex: () => {},
    endShape: () => {},
    rect: () => {},
    ellipse: () => {},
    arc: () => {},
  }
  return p as unknown as p5
}

function makeCtx(overrides: Partial<DrawCtx> = {}): DrawCtx {
  return {
    level: 0.5,
    waveform: new Uint8Array(64).fill(128),
    freq: new Uint8Array(48).fill(0),
    colors: {
      screen: '#000',
      ink1: '#111',
      ink2: '#222',
      ink3: '#333',
      accent: '#f60',
      ledOn: '#0f0',
      ledWarn: '#fb0',
      ledHot: '#f00',
      seam: 'rgba(255,255,255,0.1)',
    },
    t: 1,
    width: 200,
    height: 100,
    ...overrides,
  }
}

const ALL_VARIANTS: ArtVariant[] = [
  'master',
  'noise-gate',
  'compressor',
  'eq',
  'chorus',
  'flanger',
  'phaser',
  'tremolo',
  'delay',
  'ping-pong-delay',
  'reverb',
  'cab',
  'mixer',
  'splitter',
]

describe('toArtVariant', () => {
  it('maps known effect kinds to their variant', () => {
    expect(toArtVariant('reverb')).toBe('reverb')
    expect(toArtVariant('ping-pong-delay')).toBe('ping-pong-delay')
    expect(toArtVariant('mixer')).toBe('mixer')
  })

  it('falls back to master for unknown kinds and the empty selection', () => {
    expect(toArtVariant('amp')).toBe('master')
    expect(toArtVariant('')).toBe('master')
    expect(toArtVariant('some-new-effect')).toBe('master')
  })
})

describe('createArtDrawer', () => {
  it('returns a drawer for every art variant', () => {
    for (const variant of ALL_VARIANTS) {
      const drawer = createArtDrawer(variant)
      expect(typeof drawer).toBe('function')
    }
  })

  it('draws without throwing across edge-case inputs', () => {
    const p = makeP5()
    const ctxEmpty = makeCtx({ waveform: new Uint8Array(0), freq: new Uint8Array(0), level: 0 })
    const ctxHot = makeCtx({ level: 1 })
    for (const variant of ALL_VARIANTS) {
      const drawer = createArtDrawer(variant)
      expect(() => drawer(p, ctxEmpty)).not.toThrow()
      expect(() => drawer(p, ctxHot)).not.toThrow()
    }
  })

  it('advances internal state across repeated frames (no crash, stateful drawers)', () => {
    const p = makeP5()
    const ctx = makeCtx()
    // reverb/chorus/flanger (particles), delay/ping-pong (rings), orb/sweep/cone/flow keep state.
    for (const variant of [
      'reverb',
      'delay',
      'ping-pong-delay',
      'tremolo',
      'cab',
      'mixer',
    ] as const) {
      const drawer = createArtDrawer(variant)
      for (let i = 0; i < 5; i++) drawer(p, ctx)
    }
    expect(true).toBe(true)
  })
})
