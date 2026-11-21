/**
 * Auto-fingering (issue #459): re-pick the string and fret of every note in
 * a passage so the hand moves as little as possible, or stays in one
 * position. Pitches never change - only where they are played.
 *
 * Dynamic programming over the beats: each beat's candidates are the ways to
 * put its pitches on distinct strings; the cost adds the chord's own stretch,
 * the hand's move from the previous beat, a little for high frets, and a
 * little for changing what was written (so equal choices keep the original).
 */
import { type FretPos, openPitches } from './fretboard'

export interface FingeringOptions {
  maxFret?: number
  /** Keep fretted notes within [position, position + 4] where possible. */
  position?: number | null
}

interface Candidate {
  pos: FretPos[]
  /** The hand's place: mean of the fretted notes (null = only open strings). */
  hand: number | null
  cost: number
}

const MAX_CANDIDATES = 400

function candidates(
  open: number[],
  pitches: number[],
  current: FretPos[],
  opts: Required<FingeringOptions>,
): Candidate[] {
  const out: Candidate[] = []
  const strings = open.length - 1
  const sorted = pitches.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p)
  const assign: FretPos[] = new Array(pitches.length)
  const used = new Set<number>()
  const walk = (k: number) => {
    if (out.length >= MAX_CANDIDATES) return
    if (k === sorted.length) {
      const pos = assign.slice()
      const fretted = pos.map((x) => x.fret).filter((f) => f > 0)
      const hand = fretted.length ? fretted.reduce((a, b) => a + b, 0) / fretted.length : null
      const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0
      if (span > 4) return // not playable with one hand
      let cost = span * 1.5 + (hand ?? 0) * 0.05
      if (opts.position !== null) {
        for (const f of fretted) {
          if (f < opts.position) cost += (opts.position - f) * 3
          else if (f > opts.position + 4) cost += (f - opts.position - 4) * 3
        }
      }
      const changed = pos.filter(
        (x, i) => x.string !== current[i]?.string || x.fret !== current[i]?.fret,
      ).length
      cost += changed * 0.01
      out.push({ pos, hand, cost })
      return
    }
    const { p, i } = sorted[k]!
    for (let s = 1; s <= strings; s++) {
      if (used.has(s)) continue
      const f = p - open[s]!
      if (f < 0 || f > opts.maxFret) continue
      used.add(s)
      assign[i] = { string: s, fret: f }
      walk(k + 1)
      used.delete(s)
    }
  }
  walk(0)
  return out
}

/**
 * New positions for each beat's notes (same order as `beats`). A beat whose
 * notes can't all be placed keeps its current positions.
 */
export function autoFinger(
  tunings: readonly number[],
  beats: readonly FretPos[][],
  options: FingeringOptions = {},
): FretPos[][] {
  const opts: Required<FingeringOptions> = {
    maxFret: options.maxFret ?? 24,
    position: options.position ?? null,
  }
  const open = openPitches(tunings)
  const pitchOf = (x: FretPos) => open[x.string]! + x.fret
  const layers = beats.map((cur) => {
    if (!cur.length) return [{ pos: [], hand: null, cost: 0 } as Candidate]
    const c = candidates(open, cur.map(pitchOf), cur, opts)
    return c.length ? c : [{ pos: cur, hand: null, cost: 0 } as Candidate]
  })
  // Viterbi: best total cost to each candidate, carrying the last hand place.
  type Cell = { total: number; prev: number; hand: number | null }
  const table: Cell[][] = []
  layers.forEach((layer, li) => {
    table.push(
      layer.map((cand) => {
        if (li === 0) return { total: cand.cost, prev: -1, hand: cand.hand }
        let best: Cell = { total: Infinity, prev: 0, hand: null }
        table[li - 1]!.forEach((cell, pi) => {
          const from = cell.hand
          const move = cand.hand === null || from === null ? 0 : Math.abs(cand.hand - from)
          const total = cell.total + cand.cost + move
          if (total < best.total) best = { total, prev: pi, hand: cand.hand ?? cell.hand }
        })
        return best
      }),
    )
  })
  const out: FretPos[][] = new Array(layers.length)
  let idx = table.at(-1)!.reduce((bi, cell, i, arr) => (cell.total < arr[bi]!.total ? i : bi), 0)
  for (let li = layers.length - 1; li >= 0; li--) {
    out[li] = layers[li]![idx]!.pos
    idx = table[li]![idx]!.prev
  }
  return out
}
