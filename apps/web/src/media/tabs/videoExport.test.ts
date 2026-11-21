import { describe, expect, it } from 'vitest'

import { contrast, silence, sliceAudio, tickAt, withCountIn } from './videoExport'

describe('video export helpers', () => {
  const segs = [
    { start: 0, end: 2, tickStart: 0, tickEnd: 3840 },
    // A repeat plays the first bar again.
    { start: 2, end: 4, tickStart: 3840, tickEnd: 7680 },
  ]
  it('maps score time to ticks, clamped', () => {
    expect(tickAt(segs, -1)).toBe(0)
    expect(tickAt(segs, 1)).toBe(1920)
    expect(tickAt(segs, 3)).toBe(5760)
    expect(tickAt(segs, 99)).toBe(7679)
    expect(tickAt([], 1)).toBe(0)
  })
  it('picks readable text colours', () => {
    expect(contrast('#ffffff')).toBe('#111111')
    expect(contrast('#101010')).toBe('#F4F1EA')
  })
})

describe('video audio helpers', () => {
  const tone = () => {
    const ch = new Float32Array(1000).fill(1)
    return { channels: [ch, ch.slice()], sampleRate: 100, frames: 1000 }
  }
  it('cuts a range with short fades', () => {
    const cut = sliceAudio(tone(), 2, 5)
    expect(cut.frames).toBe(300)
    expect(cut.channels[0]![0]).toBe(0)
    expect(cut.channels[0]![150]).toBe(1)
    expect(sliceAudio(tone(), 9, 20).frames).toBe(100)
  })
  it('prepends count-in clicks', () => {
    const sr = 48_000
    const ch = new Float32Array(sr).fill(1)
    const t = withCountIn({ channels: [ch], sampleRate: sr, frames: sr }, 4, 0.5)
    expect(t.frames).toBe(3 * sr)
    expect(t.channels[0]![2 * sr]).toBe(1)
    const lead = t.channels[0]!.subarray(0, 2 * sr)
    let peak = 0
    for (const v of lead) peak = Math.max(peak, Math.abs(v))
    expect(peak).toBeGreaterThan(0.1)
    expect(silence(2, 100).frames).toBe(200)
  })
})
