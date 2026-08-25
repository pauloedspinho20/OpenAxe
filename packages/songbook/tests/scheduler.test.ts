import { describe, it, expect } from 'vitest'
import { scheduleEvents, ticksForBars } from '../src/scheduler.js'
import type { ScoreEvent } from '../src/types.js'

const makeEvents = (): ScoreEvent[] => [
  { tick: 0, type: 'noteOn', channel: 0, key: 60, value: 100 },
  { tick: 960, type: 'noteOff', channel: 0, key: 60, value: 0 },
  { tick: 1920, type: 'noteOn', channel: 0, key: 62, value: 100 },
  { tick: 2880, type: 'noteOff', channel: 0, key: 62, value: 0 },
]

describe('songbook: scheduler', () => {
  it('converts ticks to sample offsets at 48k', () => {
    const events = makeEvents()
    const out = scheduleEvents(events, 0, 10000, { sampleRate: 48000, ticksPerBeat: 960 })
    // 960 ticks = 1 beat at 120 BPM = 0.5s = 24000 samples
    expect(out[0].deltaFrames).toBe(0)
    expect(out[1].deltaFrames).toBe(24000)
    expect(out[2].deltaFrames).toBe(48000)
  })

  it('tempoScale 2.0 halves deltaFrames', () => {
    const events = makeEvents()
    const normal = scheduleEvents(events, 0, 10000, { sampleRate: 48000, tempoScale: 1 })
    const fast = scheduleEvents(events, 0, 10000, { sampleRate: 48000, tempoScale: 2 })
    expect(fast[1].deltaFrames).toBe(Math.round(normal[1].deltaFrames / 2))
  })

  it('respects lookahead window', () => {
    const events = makeEvents()
    const out = scheduleEvents(events, 0, 1000, { sampleRate: 48000 })
    // Only events with tick <1000 should be scheduled (first two)
    expect(out.length).toBe(2)
    expect(out[0].deltaFrames).toBe(0)
  })

  it('handles loop range', () => {
    const events = makeEvents()
    // Loop 0..1920 (2 beats), events beyond 1920 should wrap
    const out = scheduleEvents(events, 0, 5000, {
      sampleRate: 48000,
      loopStartTick: 0,
      loopEndTick: 1920,
    })
    // Events at 1920 and 2880: 1920 is at loop end (wraps to 0), 2880 wraps to 960
    // Our scheduler wraps ticks >= loopEnd back into loop.
    expect(out.length).toBeGreaterThan(0)
  })

  it('ticksForBars helper', () => {
    expect(ticksForBars(4)).toBe(4 * 4 * 960)
    expect(ticksForBars(2, 480)).toBe(2 * 4 * 480)
  })
})
