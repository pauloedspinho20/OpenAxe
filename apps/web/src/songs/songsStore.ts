import { create } from 'zustand'
import { parseScore } from '@openaxe/songbook'
import { deleteSong, getSong, listSongs, saveSong, updateSong } from './songsDb'
import type { Song, SongFileType } from './types'

function fileTypeFromName(name: string): SongFileType {
  const lower = name.toLowerCase()
  if (lower.endsWith('.musicxml') || lower.endsWith('.xml')) return 'musicxml'
  if (lower.endsWith('.mid') || lower.endsWith('.midi')) return 'mid'
  if (lower.endsWith('.atex')) return 'atex'
  return 'gp'
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function importSongFile(file: File): Promise<Song> {
  const buf = await file.arrayBuffer()
  const fileType = fileTypeFromName(file.name)
  const bytes = new Uint8Array(buf)
  const isText = fileType === 'musicxml' || fileType === 'atex'
  const data: Uint8Array | string = isText ? new TextDecoder().decode(bytes) : bytes
  const summary = await parseScore(data as string & Uint8Array, { filename: file.name })

  const now = Date.now()
  const song: Song = {
    id: crypto.randomUUID(),
    title: summary.title || file.name.replace(/\.[^.]+$/, ''),
    artist: summary.artist || '',
    filename: file.name,
    fileType,
    barCount: summary.barCount,
    durationTicks: summary.durationTicks,
    durationMillis: summary.durationMillis,
    ticksPerBeat: summary.ticksPerBeat,
    tracks: summary.tracks,
    tempoMap: summary.tempoMap,
    dataBase64: arrayBufferToBase64(buf),
    createdAt: now,
    updatedAt: now,
    summary,
  }
  await saveSong(song)
  return song
}

export function getSongBytes(song: Song): Uint8Array {
  return base64ToBytes(song.dataBase64)
}

interface SongsState {
  songs: Song[]
  selectedId: string | null
  search: string
  loading: boolean
  // Actions
  load: () => Promise<void>
  addFromFile: (file: File) => Promise<Song | null>
  remove: (id: string) => Promise<void>
  rename: (id: string, title: string) => Promise<void>
  select: (id: string | null) => void
  setSearch: (search: string) => void
  getSelected: () => Song | null
  getFiltered: () => Song[]
}

export const useSongsStore = create<SongsState>()((set, get) => ({
  songs: [],
  selectedId: null,
  search: '',
  loading: false,

  load: async () => {
    set({ loading: true })
    const songs = await listSongs()
    // Sort by updatedAt desc
    songs.sort((a, b) => b.updatedAt - a.updatedAt)
    set({ songs, loading: false })
    // Auto-select first if none selected
    if (!get().selectedId && songs.length) set({ selectedId: songs[0]!.id })
  },

  addFromFile: async (file) => {
    try {
      const song = await importSongFile(file)
      set((s) => ({ songs: [song, ...s.songs], selectedId: song.id }))
      return song
    } catch (e) {
      console.error('[songs] import failed', e)
      return null
    }
  },

  remove: async (id) => {
    await deleteSong(id)
    const song = await getSong(id)
    void song
    set((s) => {
      const songs = s.songs.filter((x) => x.id !== id)
      const selectedId = s.selectedId === id ? (songs[0]?.id ?? null) : s.selectedId
      return { songs, selectedId }
    })
  },

  rename: async (id, title) => {
    const updated = await updateSong(id, { title, updatedAt: Date.now() })
    if (!updated) return
    set((s) => ({ songs: s.songs.map((x) => (x.id === id ? updated : x)) }))
  },

  select: (id) => set({ selectedId: id }),

  setSearch: (search) => set({ search }),

  getSelected: () => {
    const { songs, selectedId } = get()
    return songs.find((s) => s.id === selectedId) ?? null
  },

  getFiltered: () => {
    const { songs, search } = get()
    if (!search.trim()) return songs
    const q = search.toLowerCase()
    return songs.filter(
      (s) => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q) || s.filename.toLowerCase().includes(q),
    )
  },
}))
