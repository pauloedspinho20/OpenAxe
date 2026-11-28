import { describe, expect, it } from 'vitest'
import { SpectrumAnalyzer } from '../../../visuals/audio/fft'
import { MIN_DB, hzToX, smoothDb, spectrumColumnsDb, xToHz } from './spectrumMath'

describe('spectrumMath', () => {
  it('round-trips the log axis', () => {
    expect(xToHz(0)).toBeCloseTo(20)
    expect(xToHz(1)).toBeCloseTo(20000)
    expect(hzToX(xToHz(0.37))).toBeCloseTo(0.37)
  })

  it('puts a 1 kHz sine at about 0 dB in the 1 kHz column', () => {
    const sr = 48000
    const fft = new SpectrumAnalyzer(4096)
    const samples = new Float32Array(4096)
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin((2 * Math.PI * 1000 * i) / sr)
    const cols = new Float32Array(400)
    spectrumColumnsDb(fft.analyze(samples), sr, cols.length, false, cols)
    let best = 0
    for (let c = 1; c < cols.length; c++) if (cols[c]! > cols[best]!) best = c
    expect(Math.abs(xToHz((best + 0.5) / cols.length) - 1000)).toBeLessThan(60)
    expect(cols[best]!).toBeGreaterThan(-3)
    expect(cols[best]!).toBeLessThan(1)
  })

  it('tilt lifts highs and lowers lows relative to 1 kHz', () => {
    const mag = new Float32Array(2048).fill(0.01)
    const flat = spectrumColumnsDb(mag, 48000, 100, false, new Float32Array(100))
    const tilted = spectrumColumnsDb(mag, 48000, 100, true, new Float32Array(100))
    expect(tilted[99]! - flat[99]!).toBeGreaterThan(0)
    expect(tilted[0]! - flat[0]!).toBeLessThan(0)
  })

  it('smooths toward the new trace and seeds from silence', () => {
    const prev = new Float32Array([MIN_DB, -20])
    smoothDb(prev, new Float32Array([-10, -40]), 0.5)
    expect(prev[0]).toBe(-10)
    expect(prev[1]).toBeCloseTo(-30)
  })
})
