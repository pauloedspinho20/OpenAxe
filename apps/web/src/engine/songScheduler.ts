/**
 * Lookahead scheduler (#164): score ticks → engine sample-offset events against
 * the transport clock. Front-end owns tempo scaling and loop handling; core
 * only counts samples (issue #154). Consumed by the song player widget and the
 * practice toolkit (#170) — one place bar-granular loop and speed-trainer scaling
 * happen so web, desktop and mobile reuse it.
 *
 * Depends on @openaxe/songbook for the event stream (ScoreEvent → ScheduledEvent).
 * The actual `nam_studio_song_schedule_event` calls are done via RigWorkletNode;
 * this module only produces the deltaFrames the worklet needs.
 */

import { scheduleEvents as sbSchedule, ticksForBars } from '@openaxe/songbook'
import type { ScoreEvent } from '@openaxe/songbook'

export type { ScheduledEvent } from '@openaxe/songbook'

export interface LookaheadOptions {
  sampleRate: number
  tempoScale?: number // 0.25..2.0, front-end speed trainer (#170)
  loopStartTick?: number
  loopEndTick?: number
  ticksPerBeat?: number
}

/**
 * Wraps @openaxe/songbook's scheduleEvents with transport awareness:
 * - currentTick is derived from `transportPosition` (engine samples) → ticks
 * - lookaheadTicks is how many ticks to schedule for the next audio block
 *
 * Call once per animation frame / worklet block, feeding the returned
 * ScheduledEvents into `rig.scheduleSongEvent(kind, channel, key, value, deltaFrames)`.
 */
export function lookaheadSchedule(
  scoreEvents: ScoreEvent[],
  transportPositionSamples: number,
  lookaheadSamples: number,
  opts: LookaheadOptions,
): ReturnType<typeof sbSchedule> {
  const ticksPerBeat = opts.ticksPerBeat ?? 960
  const bpm = 120 // TODO: derive from score tempoMap; 120 is the fallback in songbook
  const secPerTick = 60 / (bpm * ticksPerBeat)
  const secPerSample = 1 / opts.sampleRate
  // Convert transport samples → ticks (inverse of scheduler's ticks→samples).
  const tempoScale = opts.tempoScale ?? 1
  const currentTick = Math.floor(
    (transportPositionSamples * secPerSample) / (secPerTick / tempoScale),
  )
  const lookaheadTicks = Math.floor((lookaheadSamples * secPerSample) / (secPerTick / tempoScale))
  return sbSchedule(scoreEvents, currentTick, lookaheadTicks, opts)
}

export { ticksForBars }
