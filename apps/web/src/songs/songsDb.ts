import { STORE_SONGS, withStore } from '../storage/db'
import type { Song } from './types'

export async function saveSong(song: Song): Promise<void> {
  await withStore<IDBValidKey>(STORE_SONGS, 'readwrite', (store) => store.put(song))
}

export async function getSong(id: string): Promise<Song | null> {
  const result = await withStore<Song | undefined>(STORE_SONGS, 'readonly', (store) => store.get(id))
  return result ?? null
}

export async function deleteSong(id: string): Promise<void> {
  await withStore<undefined>(STORE_SONGS, 'readwrite', (store) => store.delete(id))
}

export async function listSongs(): Promise<Song[]> {
  return withStore<Song[]>(STORE_SONGS, 'readonly', (store) => store.getAll())
}

export async function updateSong(id: string, patch: Partial<Song>): Promise<Song | null> {
  const existing = await getSong(id)
  if (!existing) return null
  const updated = { ...existing, ...patch, updatedAt: Date.now() }
  await saveSong(updated)
  return updated
}
