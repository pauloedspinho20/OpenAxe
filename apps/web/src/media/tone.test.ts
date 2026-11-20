// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { slotAt, START_KEY, withSection, type ToneSection } from './tone'

const sections: ToneSection[] = [
  { key: START_KEY, label: 'Start', at: 0 },
  { key: 'bar:4', label: 'Verse', at: 4 },
  { key: 'bar:12', label: 'Chorus', at: 12 },
  { key: 'bar:20', label: 'Solo', at: 20 },
]

describe('song tone', () => {
  it('picks the slot of the section playing, falling back to the start slot', () => {
    let tone = withSection(null, START_KEY, 0)
    tone = { ...withSection(withSection(tone, 'bar:12', 3), 'bar:20', 5), scene: 7 }
    expect(slotAt(tone, sections, 0)).toBe(0)
    expect(slotAt(tone, sections, 8)).toBe(0) // verse has no slot: keeps the start one
    expect(slotAt(tone, sections, 12)).toBe(3)
    expect(slotAt(tone, sections, 19.5)).toBe(3)
    expect(slotAt(tone, sections, 25)).toBe(5)
  })

  it('does nothing without a scene, and clears a section with null', () => {
    const tone = withSection(withSection(null, 'bar:4', 2), START_KEY, 1)
    expect(slotAt(tone, sections, 5)).toBeNull()
    const cleared = withSection({ ...tone, scene: 0 }, 'bar:4', null)
    expect(cleared.sections).toEqual({ [START_KEY]: 1 })
    expect(slotAt(cleared, sections, 5)).toBe(1)
  })
})
