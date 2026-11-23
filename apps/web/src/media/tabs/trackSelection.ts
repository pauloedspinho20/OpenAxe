export interface TrackViewState {
  shown: Set<number>
  trackIndex: number
}

/**
 * Select a track from the inspector:
 * - If `target` is already visible in a multi-track view, keep `shown` and move active focus to `target`.
 * - Otherwise switch to showing ONLY `target` (never pile tracks onto `shown` on click).
 */
export function selectTrackView(shown: Set<number>, target: number): TrackViewState {
  return {
    shown: shown.has(target) ? shown : new Set([target]),
    trackIndex: target,
  }
}

/**
 * Toggle multi-track visibility for `target`, always keeping at least one track shown.
 * If the active track is hidden, move active focus to the lowest remaining shown track.
 */
export function toggleTrackShown(
  shown: Set<number>,
  trackIndex: number,
  target: number,
): TrackViewState {
  const next = new Set(shown)
  if (next.has(target)) {
    if (next.size <= 1) return { shown, trackIndex }
    next.delete(target)
    return {
      shown: next,
      trackIndex: target === trackIndex ? Math.min(...next) : trackIndex,
    }
  }
  next.add(target)
  return { shown: next, trackIndex }
}
