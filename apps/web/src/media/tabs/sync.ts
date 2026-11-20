/**
 * Recording sync (issue #205 practice toolkit): a tab paired with an audio
 * recording of the song. Sync points pin score time (seconds on the score's
 * own timeline, first playthrough) to recording time; between them time maps
 * linearly, beyond them the nearest segment's rate extends. One point is a
 * pure offset; none is the identity.
 */
export interface SyncPoint {
  /** Score time, seconds (alphaTab's timeline, as rendered at the score tempo). */
  score: number
  /** Recording time, seconds. */
  audio: number
}

export interface RecordingSync {
  audioId: string
  points: SyncPoint[]
}

function sorted(points: SyncPoint[]): SyncPoint[] {
  return [...points].sort((a, b) => a.score - b.score)
}

function interpolate(points: SyncPoint[], x: number, from: 'score' | 'audio'): number {
  const to = from === 'score' ? 'audio' : 'score'
  const pts = [...points].sort((a, b) => a[from] - b[from])
  if (pts.length === 0) return x
  if (pts.length === 1) return x + (pts[0]![to] - pts[0]![from])
  let i = pts.findIndex((p) => p[from] > x) - 1
  if (i < 0) i = x < pts[0]![from] ? 0 : pts.length - 2
  i = Math.min(Math.max(0, i), pts.length - 2)
  const a = pts[i]!
  const b = pts[i + 1]!
  const span = b[from] - a[from]
  if (span <= 1e-9) return a[to] + (x - a[from])
  return a[to] + ((x - a[from]) * (b[to] - a[to])) / span
}

export const scoreToAudio = (points: SyncPoint[], score: number) =>
  interpolate(points, score, 'score')
export const audioToScore = (points: SyncPoint[], audio: number) =>
  interpolate(points, audio, 'audio')

/**
 * Add (or move) the point for a score time. A tap that would make time run
 * backwards against its neighbours is rejected (returns the input unchanged).
 */
export function upsertPoint(points: SyncPoint[], score: number, audio: number): SyncPoint[] {
  const rest = points.filter((p) => Math.abs(p.score - score) > 1e-3)
  const next = sorted([...rest, { score, audio }])
  for (let i = 1; i < next.length; i++) {
    if (next[i]!.audio <= next[i - 1]!.audio) return points
  }
  return next
}
