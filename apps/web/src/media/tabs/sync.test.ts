// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { audioToScore, scoreToAudio, upsertPoint } from './sync'

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
})
