// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { actionKey, actionLabel, type MidiAction } from './actions'

describe('actionKey', () => {
  it('is unique across every slot, scene, and nav action', () => {
    const actions: MidiAction[] = [
      ...Array.from({ length: 8 }, (_, slot): MidiAction => ({ kind: 'slot', slot })),
      ...Array.from({ length: 64 }, (_, scene): MidiAction => ({ kind: 'scene', scene })),
      { kind: 'nextScene' },
      { kind: 'prevScene' },
    ]
    const keys = actions.map(actionKey)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('actionLabel', () => {
  it('renders 1-based labels', () => {
    expect(actionLabel({ kind: 'slot', slot: 0 })).toBe('Slot 1')
    expect(actionLabel({ kind: 'slot', slot: 7 })).toBe('Slot 8')
    expect(actionLabel({ kind: 'scene', scene: 11 })).toBe('Scene 12')
    expect(actionLabel({ kind: 'nextScene' })).toBe('Next Scene')
    expect(actionLabel({ kind: 'prevScene' })).toBe('Previous Scene')
  })
})
