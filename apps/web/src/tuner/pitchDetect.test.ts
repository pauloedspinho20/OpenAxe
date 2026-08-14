// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { detectPitch } from './pitchDetect'

const SAMPLE_RATE = 48000

function sineBuffer(frequency: number, size: number, sampleRate = SAMPLE_RATE): Float32Array {
  const buffer = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    buffer[i] = Math.sin((2 * Math.PI * frequency * i) / sampleRate)
  }
  return buffer
}

describe('detectPitch', () => {
  it('detects a guitar-range fundamental (E2, ~82.4Hz) within 1%', () => {
    const result = detectPitch(sineBuffer(82.4, 4096), SAMPLE_RATE)
    expect(result).not.toBeNull()
    expect(result!.frequency).toBeCloseTo(82.4, 0)
    expect(Math.abs(result!.frequency - 82.4) / 82.4).toBeLessThan(0.01)
  })

  it('detects a bass low-B (~30.9Hz) within 2%, needing a longer window', () => {
    const result = detectPitch(sineBuffer(30.9, 8192), SAMPLE_RATE)
    expect(result).not.toBeNull()
    expect(Math.abs(result!.frequency - 30.9) / 30.9).toBeLessThan(0.02)
  })

  it('detects a high note (A5, 880Hz) within 1%', () => {
    const result = detectPitch(sineBuffer(880, 4096), SAMPLE_RATE)
    expect(result).not.toBeNull()
    expect(Math.abs(result!.frequency - 880) / 880).toBeLessThan(0.01)
  })

  it('reports high clarity for a clean sine tone', () => {
    const result = detectPitch(sineBuffer(220, 4096), SAMPLE_RATE)
    expect(result).not.toBeNull()
    expect(result!.clarity).toBeGreaterThan(0.9)
  })

  it('returns null for near-silence', () => {
    const buffer = new Float32Array(4096)
    expect(detectPitch(buffer, SAMPLE_RATE)).toBeNull()
  })

  it('returns null for white noise (no clear periodicity)', () => {
    // A seeded LCG, not Math.sin(i * k): a fixed-frequency sinusoid IS
    // periodic (autocorrelation would legitimately find it), which a
    // "noise" fixture must not be.
    let seed = 42
    const buffer = new Float32Array(4096)
    for (let i = 0; i < buffer.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      buffer[i] = (seed / 0x7fffffff) * 2 - 1
    }
    const result = detectPitch(buffer, SAMPLE_RATE)
    expect(result).toBeNull()
  })
})
