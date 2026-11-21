/**
 * Library organisation (issue #459): favourites, learning status, tags, and
 * search over names, tags, key and tempo. Pure helpers for the Media Center.
 */
import type { LearnStatus, MediaItem } from './mediaDb'

export const STATUSES: { id: LearnStatus; label: string }[] = [
  { id: 'wishlist', label: 'Want to learn' },
  { id: 'learning', label: 'Learning' },
  { id: 'learned', label: 'Learned' },
]

/** "Rock, Hard , rock" -> ["rock", "hard"]: trimmed, lower-cased, unique, in order. */
export function parseTags(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(',')) {
    const t = raw.trim().toLowerCase().replace(/\s+/g, ' ')
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

/** Every tag used in the library, most used first. */
export function allTags(items: readonly MediaItem[]): string[] {
  const count = new Map<string, number>()
  for (const i of items) for (const t of i.tags ?? []) count.set(t, (count.get(t) ?? 0) + 1)
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t]) => t)
}

export interface LibraryFilter {
  kind: 'all' | 'audio' | 'score'
  favorites: boolean
  status: LearnStatus | null
  tag: string | null
  query: string
}

/**
 * Whether an item passes the filter. The query matches name, artist, file
 * name and tags; "120 bpm" / "bpm:120" matches the tempo (±3), and a key
 * like "Am" or "key:E" matches the song's key.
 */
export function matches(item: MediaItem, f: LibraryFilter): boolean {
  if (f.kind !== 'all' && item.kind !== f.kind) return false
  if (f.favorites && !item.favorite) return false
  if (f.status && item.status !== f.status) return false
  if (f.tag && !(item.tags ?? []).includes(f.tag)) return false
  const q = f.query.trim().toLowerCase()
  if (!q) return true
  const tempo = item.info?.tempo ?? (item.kind === 'audio' ? item.practice.bpm : undefined)
  const bpm = /^(?:bpm:?\s*(\d+)|(\d+)\s*bpm)$/.exec(q)
  if (bpm) {
    const want = Number(bpm[1] ?? bpm[2])
    return tempo !== undefined && Math.abs(tempo - want) <= 3
  }
  const key = /^key:\s*(.+)$/.exec(q)
  if (key) return (item.info?.key ?? '').toLowerCase() === key[1]!.trim()
  const hay = [item.name, item.artist, item.fileName, ...(item.tags ?? []), item.info?.key ?? '']
    .join(' ')
    .toLowerCase()
  return q.split(/\s+/).every((word) => hay.includes(word))
}

/** Favourites first, then newest. */
export function sortItems(items: readonly MediaItem[]): MediaItem[] {
  return [...items].sort(
    (a, b) => Number(!!b.favorite) - Number(!!a.favorite) || b.addedAt - a.addedAt,
  )
}

const NOTE = ['C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯', 'F']
const FLAT_NOTE = ['C', 'F', 'B♭', 'E♭', 'A♭', 'D♭', 'G♭', 'C♭']
const MINOR = ['A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯']
const FLAT_MINOR = ['A', 'D', 'G', 'C', 'F', 'B♭', 'E♭', 'A♭']

/** Key name from a key signature (-7..7 accidentals; + sharps) and minor flag. */
export function keyName(accidentals: number, minor: boolean): string {
  const n = Math.max(-7, Math.min(7, Math.round(accidentals)))
  if (minor) return `${n >= 0 ? MINOR[n] : FLAT_MINOR[-n]}m`
  return n >= 0 ? NOTE[n]! : FLAT_NOTE[-n]!
}

/** The library item a file duplicates: same content hash, or (for items imported before hashes) same name and size. */
export function findDuplicate(
  items: readonly Pick<MediaItem, 'id' | 'hash' | 'size' | 'fileName'>[],
  file: { hash: string | null; size: number; name: string },
): string | null {
  for (const i of items) {
    if (file.hash && i.hash) {
      if (i.hash === file.hash) return i.id
    } else if (i.size === file.size && i.fileName === file.name) return i.id
  }
  return null
}

/** SHA-256 of a file's bytes as hex, or null where Web Crypto isn't available. */
export async function hashFile(file: Blob): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Whether the library can import this file (by extension). */
export function isImportable(
  name: string,
  audioExt: readonly string[],
  scoreExt: readonly string[],
): boolean {
  const ext = name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? ''
  return audioExt.includes(ext) || scoreExt.includes(ext)
}
