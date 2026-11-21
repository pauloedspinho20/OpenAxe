/**
 * Song -> rig tone (issue #205): which scene a song uses and which of its
 * slots each section plays. Pure helpers; the follower and UI build on them.
 */
import type { SongTone } from './mediaDb'

export interface ToneSection {
  /** "start", "bar:<index>" for tabs, or a marker id for backing tracks. */
  key: string
  label: string
  /** Where the section starts on the song's timeline (seconds or bar index). */
  at: number
}

export const START_KEY = 'start'

/**
 * The slot to play at `at` (same unit as the sections): the slot of the last
 * section starting at or before it that has one, else the start slot.
 */
export function slotAt(
  tone: SongTone | null | undefined,
  sections: ToneSection[],
  at: number,
): number | null {
  if (!tone || tone.scene === null) return null
  let slot: number | null = tone.sections[START_KEY] ?? null
  let best = -Infinity
  for (const s of sections) {
    if (s.key === START_KEY) continue
    const assigned = tone.sections[s.key]
    if (assigned === undefined) continue
    if (s.at <= at && s.at >= best) {
      best = s.at
      slot = assigned
    }
  }
  return slot
}

export function withSection(
  tone: SongTone | null | undefined,
  key: string,
  slot: number | null,
): SongTone {
  const base: SongTone = tone ?? { scene: null, sections: {}, follow: true }
  const sections = { ...base.sections }
  if (slot === null) delete sections[key]
  else sections[key] = slot
  return { ...base, sections }
}
