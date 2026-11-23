/**
 * Practice scoring (issue #205 practice toolkit): runs of hits/misses per
 * bar from wait mode or listen mode, the heat map over recent runs, the
 * worst bars, and the progress series. Pure logic - the workspace feeds it.
 */
import { MAX_RUNS, type PracticeRun } from '../mediaDb'

export class RunScorer {
  private readonly bars = new Map<number, [number, number]>()
  private readonly started = Date.now()
  private hits = 0
  private notes = 0

  private readonly mode: PracticeRun['mode']
  private readonly speed: number

  constructor(mode: PracticeRun['mode'], speed: number) {
    this.mode = mode
    this.speed = speed
  }

  hit(bar: number): void {
    const b = this.bars.get(bar) ?? [0, 0]
    b[0]++
    this.bars.set(bar, b)
    this.hits++
    this.notes++
  }

  miss(bar: number): void {
    const b = this.bars.get(bar) ?? [0, 0]
    b[1]++
    this.bars.set(bar, b)
    this.notes++
  }

  get noteCount(): number {
    return this.notes
  }

  get accuracy(): number {
    return this.notes ? this.hits / this.notes : 0
  }

  /** The finished run, or null when too short to mean anything (< 3 notes). */
  finish(now = Date.now()): PracticeRun | null {
    if (this.notes < 3) return null
    return {
      at: now,
      mode: this.mode,
      speed: this.speed,
      notes: this.notes,
      hits: this.hits,
      bars: [...this.bars.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([bar, [h, m]]) => [bar, h, m]),
      seconds: Math.round((now - this.started) / 100) / 10,
    }
  }
}

export const runAccuracy = (run: PracticeRun) => (run.notes ? run.hits / run.notes : 0)

export function appendRun(runs: PracticeRun[] | undefined, run: PracticeRun): PracticeRun[] {
  const next = [...(runs ?? []), run]
  return next.length > MAX_RUNS ? next.slice(next.length - MAX_RUNS) : next
}

/** Per-bar accuracy over the last `lastN` runs (bars never scored are absent). */
export function barHeat(
  runs: PracticeRun[] | undefined,
  lastN = 5,
): Map<number, { accuracy: number; notes: number }> {
  const totals = new Map<number, [number, number]>()
  for (const run of (runs ?? []).slice(-lastN)) {
    for (const [bar, h, m] of run.bars) {
      const t = totals.get(bar) ?? [0, 0]
      t[0] += h
      t[1] += m
      totals.set(bar, t)
    }
  }
  const out = new Map<number, { accuracy: number; notes: number }>()
  for (const [bar, [h, m]] of totals)
    out.set(bar, { accuracy: h / Math.max(1, h + m), notes: h + m })
  return out
}

/**
 * The bars most worth looping: the lowest accuracy (at least 2 notes scored,
 * below `below`), worst first, at most `k`.
 */
export function worstBars(
  heat: Map<number, { accuracy: number; notes: number }>,
  k = 3,
  below = 0.9,
): number[] {
  return [...heat.entries()]
    .filter(([, v]) => v.notes >= 2 && v.accuracy < below)
    .sort((a, b) => a[1].accuracy - b[1].accuracy || a[0] - b[0])
    .slice(0, k)
    .map(([bar]) => bar)
}

/** The span to loop for the worst bars: the worst one, widened to adjacent bad bars. */
export function worstSpan(worst: number[]): [number, number] | null {
  if (!worst.length) return null
  const first = worst[0]!
  let lo = first
  let hi = first
  const set = new Set(worst)
  while (set.has(lo - 1)) lo--
  while (set.has(hi + 1)) hi++
  return [lo, hi]
}

/** The fastest speed with a run at or above `threshold` accuracy (null if none). */
export function bestCleanSpeed(runs: PracticeRun[] | undefined, threshold = 0.9): number | null {
  let best: number | null = null
  for (const r of runs ?? [])
    if (runAccuracy(r) >= threshold && (best === null || r.speed > best)) best = r.speed
  return best
}

export interface ListenBeat {
  /** Identifies the beat (changes when playback moves to another one). */
  key: string
  bar: number
  /** Whether the beat has notes to score. */
  scored: boolean
  /** Notes this short can't be detected reliably; they are not scored. */
  tooShort: boolean
}

/**
 * Listen mode: decides hit/miss per note while the song plays. A note counts
 * as hit if its pitch is heard while it sounds or within a short grace window
 * after (detection lags the attack by a few tens of ms); otherwise it's a
 * miss once the window passes.
 */
export class ListenTracker {
  private cur: (ListenBeat & { hit: boolean }) | null = null
  private prev: (ListenBeat & { deadline: number }) | null = null

  private readonly scorer: RunScorer
  private readonly graceMs: number

  constructor(scorer: RunScorer, graceMs = 160) {
    this.scorer = scorer
    this.graceMs = graceMs
  }

  /**
   * Feed one poll. `beat` is the beat playing now (null between notes or when
   * stopped); `matches(key)` tells whether the detected pitch fits that beat.
   */
  step(beat: ListenBeat | null, now: number, matches: (key: string) => boolean): void {
    if (beat?.key !== this.cur?.key) {
      if (this.cur && this.cur.scored && !this.cur.tooShort && !this.cur.hit) {
        this.resolvePrev(now, matches, true)
        this.prev = { ...this.cur, deadline: now + this.graceMs }
      }
      this.cur = beat ? { ...beat, hit: false } : null
    }
    this.resolvePrev(now, matches, false)
    if (
      this.cur &&
      this.cur.scored &&
      !this.cur.tooShort &&
      !this.cur.hit &&
      matches(this.cur.key)
    ) {
      this.cur.hit = true
      this.scorer.hit(this.cur.bar)
    }
  }

  private resolvePrev(now: number, matches: (key: string) => boolean, force: boolean): void {
    const p = this.prev
    if (!p) return
    if (matches(p.key)) {
      this.scorer.hit(p.bar)
      this.prev = null
    } else if (force || now >= p.deadline) {
      this.scorer.miss(p.bar)
      this.prev = null
    }
  }

  /** Stop: a pending note past its grace is a miss; the note still sounding isn't judged. */
  flush(now: number): void {
    if (this.prev && now >= this.prev.deadline) this.scorer.miss(this.prev.bar)
    this.prev = null
    this.cur = null
  }
}
