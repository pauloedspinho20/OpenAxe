import { describe, expect, it } from 'vitest'

import { addEntry, liveEntries, moveEntry, newSetList, removeEntry, updateEntry } from './setlists'

describe('set lists', () => {
  it('adds, moves, updates and removes songs', () => {
    let s = newSetList('  Gig  ', 5)
    expect(s.name).toBe('Gig')
    s = addEntry(addEntry(addEntry(s, 'a'), 'b'), 'c')
    expect(s.entries.map((e) => e.itemId)).toEqual(['a', 'b', 'c'])
    s = moveEntry(s, 2, -1)
    expect(s.entries.map((e) => e.itemId)).toEqual(['a', 'c', 'b'])
    expect(moveEntry(s, 0, -1)).toBe(s)
    s = updateEntry(s, 1, { speed: 0.8, semitones: -2 })
    expect(s.entries[1]).toEqual({ itemId: 'c', speed: 0.8, semitones: -2 })
    s = removeEntry(s, 0)
    expect(s.entries.map((e) => e.itemId)).toEqual(['c', 'b'])
    expect(newSetList('').name).toBe('New set')
  })

  it('drops songs no longer in the library', () => {
    const s = addEntry(addEntry(newSetList('x'), 'a'), 'gone')
    expect(liveEntries(s, new Set(['a'])).map((e) => e.itemId)).toEqual(['a'])
  })
})
