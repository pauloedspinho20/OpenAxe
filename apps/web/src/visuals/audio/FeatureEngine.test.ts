import { describe, expect, it } from 'vitest'

import { AutoRange, DEFAULT_FEATURE_SETTINGS, FeatureEngine } from './FeatureEngine'

const SR = 48000
const N = 4096
const DT = 1 / 60

/** A continuous oscillator so consecutive windows line up like a real stream. */
function makeSignal(kind: 'sine' | 'saw' | 'noise', amp = 0.3) {
  let phase = 0
  let seed = 1
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647 - 0.5
  }
  const buf = new Float32Array(N)
  return (hz: number | ((t: number) => number), frame: number) => {
    // Shift the window by one frame of samples, append fresh ones.
    const hop = Math.round(SR * DT)
    buf.copyWithin(0, hop)
    for (let i = N - hop; i < N; i++) {
      const f = typeof hz === 'function' ? hz(frame * DT) : hz
      phase += f / SR
      phase -= Math.floor(phase)
      const s =
        kind === 'sine'
          ? Math.sin(2 * Math.PI * phase)
          : kind === 'saw'
            ? 2 * phase - 1
            : rand() * 2
      buf[i] = s * amp
    }
    return buf
  }
}

function run(
  engine: FeatureEngine,
  frames: number,
  next: (frame: number) => Float32Array | null,
  start = 0,
) {
  for (let i = 0; i < frames; i++) {
    const buf = next(start + i)
    engine.update({ spectral: buf, pitch: buf, sampleRate: SR, dt: DT }, DEFAULT_FEATURE_SETTINGS)
  }
  return engine.features
}

describe('AutoRange', () => {
  it('never shrinks below its minimum range', () => {
    const r = new AutoRange(18, -60)
    for (let i = 0; i < 2000; i++) r.update(-20, 0.016)
    expect(r.ceil - r.floor).toBeGreaterThanOrEqual(18 - 1e-6)
    expect(r.normalize(-20)).toBeCloseTo(1, 1)
  })
})

describe('FeatureEngine', () => {
  it('reports volume, activity and the played note for a steady tone', () => {
    const engine = new FeatureEngine()
    const sig = makeSignal('saw')
    const f = run(engine, 60, (i) => sig(220, i))
    expect(f.volume).toBeGreaterThan(0.5)
    expect(f.activity).toBeGreaterThan(0.9)
    expect(f.note).toBe(57) // A3
    expect(f.pitchClass).toBeCloseTo(9 / 12, 1)
    expect(f.register).toBeGreaterThan(0.3)
    expect(f.register).toBeLessThan(0.5)
  })

  it('decays to an idle state in silence while holding the last colour', () => {
    const engine = new FeatureEngine()
    const sig = makeSignal('saw')
    run(engine, 60, (i) => sig(220, i))
    const hue = engine.features.pitchClass
    const silence = new Float32Array(N)
    const f = run(engine, 240, () => silence, 60)
    expect(f.volume).toBeLessThan(0.01)
    expect(f.activity).toBeLessThan(0.2)
    expect(f.note).toBe(-1)
    expect(f.pitchClass).toBeCloseTo(hue, 3)
  })

  it('reads a buzzy saw as brighter than a sine and noise as grittier than both', () => {
    const measure = (kind: 'sine' | 'saw' | 'noise') => {
      const sig = makeSignal(kind)
      return run(new FeatureEngine(), 90, (i) => sig(330, i))
    }
    const sine = measure('sine')
    const saw = measure('saw')
    const noise = measure('noise')
    expect(saw.brightness).toBeGreaterThan(sine.brightness)
    expect(noise.grit).toBeGreaterThan(saw.grit)
    expect(noise.grit).toBeGreaterThan(sine.grit)
  })

  it('fires an attack impulse when a note starts after silence', () => {
    const engine = new FeatureEngine()
    const sig = makeSignal('saw')
    const silence = new Float32Array(N)
    // Let the flux history fill with quiet frames first.
    run(engine, 30, () => silence)
    let peak = 0
    for (let i = 0; i < 10; i++) {
      run(engine, 1, (j) => sig(196, j), 30 + i)
      peak = Math.max(peak, engine.features.onset)
    }
    expect(peak).toBeGreaterThan(0.3)
  })

  it('treats a slow glide as a bend and a jump as a note change', () => {
    const engine = new FeatureEngine()
    const sig = makeSignal('saw')
    run(engine, 40, (i) => sig(220, i))
    // Settle: let the initial noteChange impulse decay.
    run(engine, 90, (i) => sig(220, i), 40)
    expect(engine.features.noteChange).toBeLessThan(0.05)

    // Bend up a whole step over ~1s: no new note event, bend rises.
    let maxChange = 0
    for (let i = 0; i < 60; i++) {
      run(engine, 1, (j) => sig(220 * 2 ** ((2 * (i + 1)) / 60 / 12), j), 130 + i)
      maxChange = Math.max(maxChange, engine.features.noteChange)
    }
    expect(engine.features.bend).toBeGreaterThan(0.6)
    expect(maxChange).toBeLessThan(0.05)

    // Jump a fifth instantly: note change.
    let peak = 0
    for (let i = 0; i < 10; i++) {
      run(engine, 1, (j) => sig(330, j), 190 + i)
      peak = Math.max(peak, engine.features.noteChange)
    }
    expect(peak).toBeGreaterThan(0.5)
    expect(engine.features.note).toBe(64) // E4
  })

  it('handles missing taps and tiny windows without throwing', () => {
    const engine = new FeatureEngine()
    expect(() => run(engine, 5, () => null)).not.toThrow()
    const tiny = new Float32Array(32).fill(0.2)
    expect(() => run(engine, 5, () => tiny)).not.toThrow()
  })
})
