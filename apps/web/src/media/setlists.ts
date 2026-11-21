/**
 * Set lists (issue #459): ordered songs for a gig or a practice routine, each
 * with its own speed and transpose, played one after another with "next".
 * Stored in the `setlists` kv store; entries point at library items by id.
 */
import { STORE_SETLISTS } from '../storage/db'
import { kvDelete, kvGetAll, kvPut } from '../storage/kv'

export interface SetEntry {
  itemId: string
  /** Playback speed for this song in the set (1 = as is). */
  speed: number
  /** Transpose in semitones for this song in the set. */
  semitones: number
}

export interface SetList {
  id: string
  name: string
  createdAt: number
  entries: SetEntry[]
}

export function newSetList(name: string, now = Date.now()): SetList {
  return {
    id: `set-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim() || 'New set',
    createdAt: now,
    entries: [],
  }
}

export function addEntry(set: SetList, itemId: string): SetList {
  return { ...set, entries: [...set.entries, { itemId, speed: 1, semitones: 0 }] }
}

export function removeEntry(set: SetList, index: number): SetList {
  return { ...set, entries: set.entries.filter((_, i) => i !== index) }
}

/** Move entry `index` by `delta` places (clamped). */
export function moveEntry(set: SetList, index: number, delta: number): SetList {
  const to = Math.min(set.entries.length - 1, Math.max(0, index + delta))
  if (to === index || !set.entries[index]) return set
  const entries = [...set.entries]
  const [e] = entries.splice(index, 1)
  entries.splice(to, 0, e!)
  return { ...set, entries }
}

export function updateEntry(set: SetList, index: number, patch: Partial<SetEntry>): SetList {
  return {
    ...set,
    entries: set.entries.map((e, i) => (i === index ? { ...e, ...patch } : e)),
  }
}

/** Entries whose song is still in the library (deleted songs drop out). */
export function liveEntries(set: SetList, itemIds: ReadonlySet<string>): SetEntry[] {
  return set.entries.filter((e) => itemIds.has(e.itemId))
}

function normalize(row: Partial<SetList> & { id: string }): SetList {
  return {
    id: row.id,
    name: typeof row.name === 'string' ? row.name : 'Set',
    createdAt: typeof row.createdAt === 'number' ? row.createdAt : 0,
    entries: Array.isArray(row.entries)
      ? row.entries
          .filter((e) => e && typeof e.itemId === 'string')
          .map((e) => ({
            itemId: e.itemId,
            speed: typeof e.speed === 'number' ? e.speed : 1,
            semitones: typeof e.semitones === 'number' ? e.semitones : 0,
          }))
      : [],
  }
}

export async function listSetLists(): Promise<SetList[]> {
  const rows = await kvGetAll<Partial<SetList> & { id: string }>(STORE_SETLISTS)
  return rows
    .filter((r) => r && typeof r.id === 'string')
    .map(normalize)
    .sort((a, b) => b.createdAt - a.createdAt)
}

export async function saveSetList(set: SetList): Promise<void> {
  await kvPut(STORE_SETLISTS, set)
}

export async function deleteSetList(id: string): Promise<void> {
  await kvDelete(STORE_SETLISTS, id)
}
