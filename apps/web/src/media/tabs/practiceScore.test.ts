// @vitest-environment node
import { describe, expect, it } from 'vitest'

import type { PracticeRun } from '../mediaDb'
import {
  appendRun,
  barHeat,
  bestCleanSpeed,
  ListenTracker,
  RunScorer,
  runAccuracy,
  worstBars,
  worstSpan,
} from './practiceScore'

const run = (bars: [number, number, number][], speed = 1): PracticeRun => {
  const hits = bars.reduce((s, b) => s + b[1], 0)
  const notes = bars.reduce((s, b) => s + b[1] + b[2], 0)
  return { at: 0, mode: 'wait', speed, notes, hits, bars, seconds: 1 }
}

describe('practice scoring', () => {
  it('records hits and misses per bar and drops trivially short runs', () => {
    const s = new RunScorer('wait', 0.8)
    s.hit(0)
    s.miss(0)
    expect(s.finish()).toBeNull()
    s.hit(2)
    s.hit(2)
    const r = s.finish(1000)!
    expect(r.bars).toEqual([
      [0, 1, 1],
      [2, 2, 0],
    ])
    expect(runAccuracy(r)).toBe(0.75)
    expect(r.speed).toBe(0.8)
  })

  it('builds the heat map over recent runs and finds the worst span', () => {
    const runs = [
      run([
        [0, 4, 0],
        [1, 1, 3],
        [2, 2, 2],
      ]),
      run([
        [1, 0, 2],
        [2, 3, 1],
        [5, 1, 1],
      ]),
    ]
    const heat = barHeat(runs)
    expect(heat.get(1)!.accuracy).toBeCloseTo(1 / 6)
    const worst = worstBars(heat)
    expect(worst).toEqual([1, 5, 2])
    expect(worstSpan(worst)).toEqual([1, 2])
    expect(worstSpan([])).toBeNull()
  })

  it('caps the history and finds the best clean speed', () => {
    let runs: PracticeRun[] = []
    for (let i = 0; i < 205; i++) runs = appendRun(runs, run([[0, 9, 1]], 0.5 + i / 1000))
    expect(runs.length).toBe(200)
    expect(bestCleanSpeed(runs)).toBeCloseTo(0.704)
    expect(bestCleanSpeed([run([[0, 1, 1]])])).toBeNull()
  })

  it('listens: hits while sounding or in the grace window, misses after, skips short notes', () => {
    const s = new RunScorer('listen', 1)
    const t = new ListenTracker(s, 150)
    const heard = new Set<string>()
    const m = (k: string) => heard.has(k)
    const beat = (key: string, bar: number, tooShort = false) => ({
      key,
      bar,
      scored: true,
      tooShort,
    })
    t.step(beat('a', 0), 0, m)
    heard.add('a')
    t.step(beat('a', 0), 40, m) // hit while sounding
    t.step(beat('b', 0), 300, m)
    heard.clear()
    heard.add('b')
    t.step(beat('c', 1), 600, m) // b heard just after it ended: grace hit
    heard.clear()
    t.step(beat('d', 1, true), 900, m) // c never heard -> miss once grace passes
    t.step(null, 1100, m)
    t.step(null, 1300, m)
    t.flush(2000)
    const r = s.finish()!
    expect(r.bars).toEqual([
      [0, 2, 0],
      [1, 0, 1],
    ])
  })
})
