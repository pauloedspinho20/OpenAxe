/** Picks `count` distinct cluster ids out of `total` at random (clamped to 0..total). */
export function pickClusters(total: number, count: number, rand = Math.random): number[] {
  const ids = Array.from({ length: total }, (_, i) => i)
  const n = Math.min(Math.max(Math.round(count), 0), total)
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rand() * (total - i))
    const t = ids[i]!
    ids[i] = ids[j]!
    ids[j] = t
  }
  return ids.slice(0, n)
}

/**
 * Rising-edge detector on a 0..1 level (the audio-driven `fire` param): returns
 * the level when it jumps by more than `threshold` since the previous frame,
 * else 0. A held or slowly rising level never re-triggers.
 */
export class EdgeTrigger {
  private last = 0
  private readonly threshold: number

  constructor(threshold = 0.05) {
    this.threshold = threshold
  }

  step(level: number): number {
    const rise = level - this.last
    this.last = level
    return rise > this.threshold ? level : 0
  }
}
