/**
 * Section practice routine (#459): loop each section of the song with the
 * clean-pass speed trainer, from a start speed up to a target, and move on
 * once a pass at the target speed is clean.
 */
import type { model } from '@coderline/alphatab'

export interface RoutineSection {
  from: number
  to: number
  label: string
}

/** Sections from the score's section markers; 4-bar chunks when there are none. */
export function routineSections(score: model.Score, chunk = 4): RoutineSection[] {
  const bars = score.masterBars
  const starts = bars.flatMap((mb, i) => (mb.section ? [i] : []))
  if (!starts.length) {
    const out: RoutineSection[] = []
    for (let i = 0; i < bars.length; i += chunk) {
      const to = Math.min(bars.length - 1, i + chunk - 1)
      out.push({ from: i, to, label: `Bars ${i + 1}–${to + 1}` })
    }
    return out
  }
  const out: RoutineSection[] = []
  if (starts[0]! > 0) out.push({ from: 0, to: starts[0]! - 1, label: 'Intro' })
  starts.forEach((s, k) => {
    const sec = bars[s]!.section!
    out.push({
      from: s,
      to: (starts[k + 1] ?? bars.length) - 1,
      label: `${sec.marker ? `${sec.marker} ` : ''}${sec.text || `Bar ${s + 1}`}`,
    })
  })
  return out
}

/** A section is done when a pass at (or above) the target speed is clean (>= 90%). */
export function sectionDone(accuracy: number, speed: number, target: number): boolean {
  return accuracy >= 0.9 && speed >= target - 1e-6
}
