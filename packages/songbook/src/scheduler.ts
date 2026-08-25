import type { ScoreEvent } from './types.js'

export interface ScheduledEvent {
  /** Sample offset from the current transport position (0 = block start). */
  deltaFrames: number
  kind: 'noteOn' | 'noteOff' | 'cc' | 'program' | 'pitchBend'
  channel: number
  key: number
  value: number
}

export interface SchedulerOptions {
  sampleRate: number
  tempoScale?: number // 0.25..2.0, front-end tempo scaling (core only counts samples)
  loopStartTick?: number
  loopEndTick?: number
  ticksPerBeat?: number
}

/**
 * Lookahead scheduler (#164): score ticks → engine sample-offset events against
 * the transport clock. Front-end owns tempo scaling and loop handling; core
 * only counts samples (issue #154). This is the single place bar-granular loop
 * and speed-trainer scaling happen so every front end reuses it.
 */
export function scheduleEvents(
  events: ScoreEvent[],
  currentTick: number,
  lookaheadTicks: number,
  opts: SchedulerOptions,
): ScheduledEvent[] {
  const sampleRate = opts.sampleRate
  const tempoScale = opts.tempoScale ?? 1
  const ticksPerBeat = opts.ticksPerBeat ?? 960
  // Default tempo 120 BPM → 0.5s per beat → ticksPerBeat corresponds to 0.5s.
  // Sample conversion: ticks * (60 / (bpm * ticksPerBeat)) * sampleRate, scaled.
  const bpm = 120
  const secPerTick = 60 / (bpm * ticksPerBeat)
  const out: ScheduledEvent[] = []
  for (const ev of events) {
    if (ev.tick < currentTick) continue
    if (ev.tick >= currentTick + lookaheadTicks) break
    // Loop handling: if loop range is set, wrap ticks that fall outside.
    let tick = ev.tick
    if (
      opts.loopStartTick !== undefined &&
      opts.loopEndTick !== undefined &&
      opts.loopEndTick > opts.loopStartTick
    ) {
      const loopLen = opts.loopEndTick - opts.loopStartTick
      if (tick >= opts.loopEndTick)
        tick = opts.loopStartTick + ((tick - opts.loopStartTick) % loopLen)
      if (tick < opts.loopStartTick) continue
    }
    const deltaTicks = tick - currentTick
    // Apply tempo scaling: faster tempo means events sooner (more ticks per second),
    // so deltaFrames shrinks with tempoScale >1.
    const deltaSec = (deltaTicks * secPerTick) / tempoScale
    const deltaFrames = Math.round(deltaSec * sampleRate)
    const kind =
      ev.type === 'noteOn'
        ? 'noteOn'
        : ev.type === 'noteOff'
          ? 'noteOff'
          : ev.type === 'cc'
            ? 'cc'
            : ev.type === 'program'
              ? 'program'
              : 'pitchBend'
    out.push({ deltaFrames, kind, channel: ev.channel, key: ev.key, value: ev.value })
  }
  out.sort((a, b) => a.deltaFrames - b.deltaFrames)
  return out
}

/** Convenience: ticks for N bars at ticksPerBeat. */
export function ticksForBars(bars: number, ticksPerBeat = 960, beatsPerBar = 4): number {
  return bars * beatsPerBar * ticksPerBeat
}
