// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { selectTrackView, toggleTrackShown } from './trackSelection'

describe('trackSelection', () => {
  it('selectTrackView switches to a single track when target is hidden', () => {
    const first = new Set([0])
    const res = selectTrackView(first, 1)
    expect(res.trackIndex).toBe(1)
    expect([...res.shown]).toEqual([1])
    expect([...first]).toEqual([0])

    // Selecting another unshown track while multi-track is active switches cleanly to only that track.
    const multi = new Set([0, 1])
    const res2 = selectTrackView(multi, 2)
    expect(res2.trackIndex).toBe(2)
    expect([...res2.shown]).toEqual([2])
  })

  it('selectTrackView preserves multi-track shown set when target is already shown', () => {
    const shown = new Set([0, 2])
    const res = selectTrackView(shown, 2)
    expect(res.trackIndex).toBe(2)
    expect(res.shown).toBe(shown)
  })

  it('toggleTrackShown stacks tracks and never removes the last shown track', () => {
    const s0 = toggleTrackShown(new Set([0]), 0, 1)
    expect([...s0.shown]).toEqual([0, 1])
    expect(s0.trackIndex).toBe(0)

    // Hiding a non-active track leaves trackIndex unchanged.
    const s1 = toggleTrackShown(s0.shown, 0, 1)
    expect([...s1.shown]).toEqual([0])
    expect(s1.trackIndex).toBe(0)

    // Hiding the active track falls back to the lowest remaining shown track.
    const s2 = toggleTrackShown(new Set([1, 2]), 1, 1)
    expect([...s2.shown]).toEqual([2])
    expect(s2.trackIndex).toBe(2)

    // Cannot hide the sole remaining track.
    const solo = new Set([2])
    const s3 = toggleTrackShown(solo, 2, 2)
    expect(s3.shown).toBe(solo)
    expect(s3.trackIndex).toBe(2)
  })
})
