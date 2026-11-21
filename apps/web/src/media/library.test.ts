import { describe, expect, it } from 'vitest'

import { allTags, keyName, matches, parseTags, sortItems, type LibraryFilter } from './library'
import type { MediaItem } from './mediaDb'

const item = (p: Partial<MediaItem>): MediaItem =>
  ({
    id: 'x',
    kind: 'score',
    name: 'Song',
    artist: '',
    fileName: 'song.gp',
    mime: '',
    size: 1,
    addedAt: 0,
    duration: 0,
    peaks: [],
    practice: { bpm: 120 } as MediaItem['practice'],
    markers: [],
    ...p,
  }) as MediaItem

const all: LibraryFilter = { kind: 'all', favorites: false, status: null, tag: null, query: '' }

describe('library organisation', () => {
  it('parses tags', () => {
    expect(parseTags('Rock, Hard , rock,,  blues  rock')).toEqual(['rock', 'hard', 'blues rock'])
  })

  it('lists tags by use', () => {
    expect(allTags([item({ tags: ['a', 'b'] }), item({ tags: ['b'] })])).toEqual(['b', 'a'])
  })

  it('filters by favourite, status, tag and kind', () => {
    const fav = item({ favorite: true, status: 'learning', tags: ['rock'] })
    const other = item({ kind: 'audio' })
    expect(matches(fav, { ...all, favorites: true })).toBe(true)
    expect(matches(other, { ...all, favorites: true })).toBe(false)
    expect(matches(fav, { ...all, status: 'learned' })).toBe(false)
    expect(matches(fav, { ...all, tag: 'rock' })).toBe(true)
    expect(matches(fav, { ...all, kind: 'audio' })).toBe(false)
  })

  it('searches names, tags, tempo and key', () => {
    const s = item({
      name: 'Wish You Were Here',
      tags: ['acoustic'],
      info: { tempo: 122, key: 'G' },
    })
    expect(matches(s, { ...all, query: 'wish here' })).toBe(true)
    expect(matches(s, { ...all, query: 'acoustic' })).toBe(true)
    expect(matches(s, { ...all, query: '120 bpm' })).toBe(true)
    expect(matches(s, { ...all, query: 'bpm:140' })).toBe(false)
    expect(matches(s, { ...all, query: 'key:g' })).toBe(true)
    expect(matches(s, { ...all, query: 'key:am' })).toBe(false)
    // Backing tracks use their count-in tempo.
    expect(matches(item({ kind: 'audio' }), { ...all, query: '118bpm' })).toBe(true)
  })

  it('sorts favourites first, then newest', () => {
    const out = sortItems([
      item({ id: 'old', addedAt: 1 }),
      item({ id: 'new', addedAt: 3 }),
      item({ id: 'fav', addedAt: 0, favorite: true }),
    ])
    expect(out.map((i) => i.id)).toEqual(['fav', 'new', 'old'])
  })

  it('names keys', () => {
    expect(keyName(0, false)).toBe('C')
    expect(keyName(1, false)).toBe('G')
    expect(keyName(-3, false)).toBe('E♭')
    expect(keyName(0, true)).toBe('Am')
    expect(keyName(1, true)).toBe('Em')
    expect(keyName(-2, true)).toBe('Gm')
  })
})
