import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { NativeAnalyser, peakSineSource } from './NativeAnalyser'

/** A `read()` source of `n` samples of a sine at `hz`, for the FFT tests. */
function sineSource(n: number, hz: number, sampleRate: number, amplitude = 1) {
  const buf = new Float32Array(n)
  for (let i = 0; i < n; i++) buf[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate)
  return () => buf
}

/** Index of the largest value in `bytes`. */
function peakBin(bytes: Uint8Array): number {
  let best = 0
  for (let i = 1; i < bytes.length; i++) if ((bytes[i] ?? 0) > (bytes[best] ?? 0)) best = i
  return best
}

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

  it('frequencyBinCount is half the FFT size, as AnalyserNode defines it', () => {
    const read = () => new Float32Array(0)
    expect(new NativeAnalyser({ fftSize: 256, sampleRate: 48000, read }).frequencyBinCount).toBe(
      128,
    )
    expect(new NativeAnalyser({ fftSize: 4096, sampleRate: 48000, read }).frequencyBinCount).toBe(
      2048,
    )
  })

  it('getByteFrequencyData puts a pure tone in its own bin', () => {
    const fftSize = 256
    const sampleRate = 48000
    // Exactly 8 cycles per window, so the tone lands dead on bin 8 with no leakage.
    const hz = (sampleRate * 8) / fftSize
    const analyser = new NativeAnalyser({
      fftSize,
      sampleRate,
      // Quiet enough to stay under maxDecibels: a loud tone pins its own bin
      // and both Blackman neighbours at 255, which says nothing about placement.
      read: sineSource(fftSize, hz, sampleRate, 0.005),
      // No smoothing: one call is the whole answer, not a step towards it.
      smoothingTimeConstant: 0,
    })

    const bins = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteFrequencyData(bins)

    expect(peakBin(bins)).toBe(8)
    expect(bins[8] ?? 0).toBeGreaterThan(bins[7] ?? 0)
    expect(bins[8] ?? 0).toBeGreaterThan(bins[9] ?? 0)
    // Well away from the tone there is nothing left above the noise floor.
    expect(bins[40] ?? 0).toBe(0)
  })

  it('getByteFrequencyData floors silence at 0 and zero-fills past the bin count', () => {
    const analyser = new NativeAnalyser({
      fftSize: 256,
      sampleRate: 48000,
      read: () => new Float32Array(256),
      smoothingTimeConstant: 0,
    })

    const bins = new Uint8Array(analyser.frequencyBinCount + 4)
    bins.fill(200)
    analyser.getByteFrequencyData(bins)
    expect([...bins].every((v) => v === 0)).toBe(true)
  })

  it('getByteFrequencyData smooths towards the new frame, not straight onto it', () => {
    const fftSize = 256
    const sampleRate = 48000
    const hz = (sampleRate * 8) / fftSize
    const analyser = new NativeAnalyser({
      fftSize,
      sampleRate,
      read: sineSource(fftSize, hz, sampleRate, 0.005),
      smoothingTimeConstant: 0.8,
    })

    const first = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteFrequencyData(first)
    const second = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteFrequencyData(second)

    // Same input twice: the smoothed magnitude climbs towards it, so the second
    // read is louder than the first in the tone's bin.
    expect(second[8] ?? 0).toBeGreaterThan(first[8] ?? 0)
  })

  it('getByteFrequencyData zero-fills rather than lie when fftSize is not a power of two', () => {
    const analyser = new NativeAnalyser({
      fftSize: 3,
      sampleRate: 48000,
      read: () => new Float32Array([1, 1, 1]),
    })

    const bins = new Uint8Array(8)
    bins.fill(200)
    analyser.getByteFrequencyData(bins)
    expect([...bins]).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })

  // Issue #114: NativeAnalyser is handed to the same components as a real
  // AnalyserNode, so any member they touch that it doesn't implement is a
  // TypeError at runtime - on desktop only, where no type checks it (the props
  // are typed `AnalyserNode`). Scan what those components actually call instead
  // of trusting the class comment, so the next member someone reaches for
  // fails here rather than in a p5 draw loop on a user's machine.
  it('implements every analyser member the shared components call', () => {
    const componentsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'components')

    const files: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(path)
      }
    }
    walk(componentsDir)
    expect(files.length).toBeGreaterThan(0)

    // `analyser.<member>` and `<prefix>Analyser.<member>`, but not
    // `analyserRef.current` (the name has to end at "nalyser") and not
    // `analyser?.disconnect()` (optional chaining is the web-only teardown).
    // One level deep only: `analyser.context.sampleRate` checks `context`.
    const access = /\b\w*[Aa]nalyser\.([A-Za-z_$][\w$]*)/g
    const used = new Map<string, string>()
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(access)) {
        const member = match[1]
        if (member) used.set(member, file)
      }
    }
    // The three known consumers between them touch at least fftSize,
    // frequencyBinCount, context and the three read methods.
    expect(used.size).toBeGreaterThanOrEqual(6)

    const analyser = new NativeAnalyser({
      fftSize: 256,
      sampleRate: 48000,
      read: () => new Float32Array(0),
    })
    const missing = [...used].filter(([member]) => !(member in analyser))
    expect(missing.map(([member, file]) => `${member} (used in ${file})`)).toEqual([])
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
