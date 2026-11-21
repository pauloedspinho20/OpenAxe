import { describe, expect, it } from 'vitest'

import {
  allTags,
  findDuplicate,
  hashFile,
  isImportable,
  keyName,
  matches,
  parseTags,
  sortItems,
  type LibraryFilter,
} from './library'
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

describe('duplicates', () => {
  it('matches by hash, or by name and size for old items', () => {
    const items = [
      { id: 'a', hash: 'h1', size: 10, fileName: 'a.mp3' },
      { id: 'old', size: 20, fileName: 'b.gp' },
    ]
    expect(findDuplicate(items, { hash: 'h1', size: 99, name: 'x' })).toBe('a')
    expect(findDuplicate(items, { hash: 'h2', size: 10, name: 'a.mp3' })).toBeNull()
    expect(findDuplicate(items, { hash: 'h3', size: 20, name: 'b.gp' })).toBe('old')
    expect(findDuplicate(items, { hash: null, size: 20, name: 'c.gp' })).toBeNull()
  })

  it('hashes file contents', async () => {
    const a = await hashFile(new Blob(['abc']))
    expect(a).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await hashFile(new Blob(['abc']))).toBe(a)
  })

  it('knows importable files', () => {
    expect(isImportable('Song.MP3', ['.mp3'], ['.gp'])).toBe(true)
    expect(isImportable('notes.txt', ['.mp3'], ['.gp'])).toBe(false)
  })
})
