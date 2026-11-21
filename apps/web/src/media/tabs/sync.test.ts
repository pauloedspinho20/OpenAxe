// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { audioToScore, mixGuide, scoreToAudio, upsertPoint } from './sync'

describe('recording sync map', () => {
  it('is the identity without points and an offset with one', () => {
    expect(scoreToAudio([], 3)).toBe(3)
    const one = [{ score: 0, audio: 1.5 }]
    expect(scoreToAudio(one, 4)).toBe(5.5)
    expect(audioToScore(one, 5.5)).toBe(4)
  })

  it('interpolates between points and extends the nearest rate outside', () => {
    // The recording is 10% slower than the score for the first 2 bars, then catches up.
    const pts = [
      { score: 0, audio: 2 },
      { score: 4, audio: 6.4 },
      { score: 8, audio: 10.4 },
    ]
    expect(scoreToAudio(pts, 2)).toBeCloseTo(4.2)
    expect(scoreToAudio(pts, 6)).toBeCloseTo(8.4)
    expect(scoreToAudio(pts, 10)).toBeCloseTo(12.4) // after the last point: last segment's rate
    expect(scoreToAudio(pts, -1)).toBeCloseTo(0.9) // before the first: first segment's rate
    for (const s of [0, 1.3, 4, 7.7, 9])
      expect(audioToScore(pts, scoreToAudio(pts, s))).toBeCloseTo(s)
  })

  it('adds, replaces and rejects points that would run time backwards', () => {
    let pts = upsertPoint([], 4, 5)
    pts = upsertPoint(pts, 0, 1)
    expect(pts).toEqual([
      { score: 0, audio: 1 },
      { score: 4, audio: 5 },
    ])
    pts = upsertPoint(pts, 4, 5.2) // re-tap the same bar
    expect(pts[1]).toEqual({ score: 4, audio: 5.2 })
    expect(upsertPoint(pts, 2, 6)).toBe(pts) // after the bar-4 point in audio time: rejected
  })

  it('places the guide bar by bar at the synced times, unstretched', () => {
    const sr = 100
    const rec = {
      channels: [new Float32Array(1000), new Float32Array(1000)],
      sampleRate: sr,
      frames: 1000,
    }
    // Guide: a "click" at the start of each 1-second score bar.
    const g = new Float32Array(300)
    g[0] = 1
    g[100] = 1
    g[200] = 1
    const guide = { channels: [g, g], sampleRate: sr, frames: 300 }
    const bars = [0, 1, 2].map((b) => ({ start: b, end: b + 1 }))
    // Recording: starts 2 s in and plays 20% slower than the score.
    const pts = [
      { score: 0, audio: 2 },
      { score: 1, audio: 3.2 },
    ]
    const [l] = mixGuide(rec, guide, bars, pts, 0.5)
    // Each bar's downbeat lands on the recording's (fades make the first sample 0, so look at +fade).
    const peaks = [...l!.keys()].filter((i) => l![i]! > 0)
    expect(peaks.length).toBe(0) // single-sample clicks sit inside the fade-in: silence
    const g2 = new Float32Array(300).fill(1)
    const [l2] = mixGuide(rec, { ...guide, channels: [g2, g2] }, bars, pts, 0.5)
    expect(l2![150]).toBe(0) // before the recording's first bar (2 s)
    expect(l2![210]).toBeCloseTo(0.5) // first bar, placed at 2 s
    expect(l2![330]).toBeCloseTo(0.5) // second bar at 3.2 s
    expect(l2![460]).toBeCloseTo(0.5) // third bar at 4.4 s (rate extended)
    expect(l2![560]).toBe(0) // unstretched: bar 3 ends 1 s later, at 5.4 s
    expect(l2![900]).toBe(0)
  })
})
