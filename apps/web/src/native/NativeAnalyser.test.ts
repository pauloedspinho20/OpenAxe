import { describe, expect, it } from 'vitest'
import { NativeAnalyser, peakSineSource } from './NativeAnalyser'

describe('NativeAnalyser', () => {
  it('getFloatTimeDomainData copies real samples, oldest first', () => {
    const src = new Float32Array([0.5, -0.25, 0, 0.125])
    const analyser = new NativeAnalyser({ fftSize: 4, sampleRate: 48000, read: () => src })

    const out = new Float32Array(4)
    analyser.getFloatTimeDomainData(out)
    expect([...out]).toEqual([0.5, -0.25, 0, 0.125])
    expect(analyser.context.sampleRate).toBe(48000)
  })

  it('getFloatTimeDomainData pads a short source and zero-fills', () => {
    const src = new Float32Array([1, 1])
    const analyser = new NativeAnalyser({ fftSize: 4, sampleRate: 48000, read: () => src })

    const out = new Float32Array(4)
    analyser.getFloatTimeDomainData(out)
    expect([...out]).toEqual([1, 1, 0, 0])
  })

  it('getByteTimeDomainData maps floats to 0..255 centered on 128', () => {
    const src = new Float32Array([1, 0, -1])
    const analyser = new NativeAnalyser({ fftSize: 3, sampleRate: 48000, read: () => src })

    const out = new Uint8Array(3)
    analyser.getByteTimeDomainData(out)
    expect(out[0]).toBe(255)
    expect(out[1]).toBe(128)
    expect(out[2]).toBe(1)
  })

  it('peakSineSource amplitude follows the peak, so meters show true level', () => {
    let peak = 0
    const read = peakSineSource(256, 48000, () => peak)

    // A read at any phase must reach the sine's full amplitude within the
    // buffer, so the byte meter's max deviation reflects the amplitude.
    const analyser = new NativeAnalyser({ fftSize: 256, sampleRate: 48000, read })

    peak = 0.5
    const bytes = new Uint8Array(256)
    analyser.getByteTimeDomainData(bytes)
    let dev = 0
    for (const b of bytes) dev = Math.max(dev, Math.abs(b - 128) / 128)
    expect(dev).toBeGreaterThan(0.45)
    expect(dev).toBeLessThan(0.6)

    peak = 1
    analyser.getByteTimeDomainData(bytes)
    dev = 0
    for (const b of bytes) dev = Math.max(dev, Math.abs(b - 128) / 128)
    expect(dev).toBeGreaterThan(0.9)
  })
})
