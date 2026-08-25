import { create } from 'zustand'
import { deleteTake, listTakes, saveTake } from './takesDb'
import type { Take } from './types'

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function downloadBlob(filename: string, bytes: Uint8Array, mime: string) {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

interface TakesState {
  takes: Take[]
  loading: boolean
  load: () => Promise<void>
  addTake: (take: Take) => Promise<void>
  remove: (id: string) => Promise<void>
  rename: (id: string, name: string) => Promise<void>
  download: (id: string) => void
  importWav: (file: File) => Promise<Take | null>
}

export const useTakesStore = create<TakesState>()((set, get) => ({
  takes: [],
  loading: false,

  load: async () => {
    set({ loading: true })
    const takes = await listTakes()
    takes.sort((a, b) => b.createdAt - a.createdAt)
    set({ takes, loading: false })
  },

  addTake: async (take) => {
    await saveTake(take)
    set((s) => ({ takes: [take, ...s.takes] }))
  },

  remove: async (id) => {
    await deleteTake(id)
    set((s) => ({ takes: s.takes.filter((t) => t.id !== id) }))
  },

  rename: async (id, name) => {
    const take = get().takes.find((t) => t.id === id)
    if (!take) return
    const updated = { ...take, name }
    await saveTake(updated)
    set((s) => ({ takes: s.takes.map((t) => (t.id === id ? updated : t)) }))
  },

  download: (id) => {
    const take = get().takes.find((t) => t.id === id)
    if (!take) return
    const bytes = base64ToBytes(take.wavBase64)
    const filename = `${take.name.replace(/[^a-z0-9_-]/gi, '_')}.wav`
    downloadBlob(filename, bytes, 'audio/wav')
  },

  importWav: async (file) => {
    if (!file.name.toLowerCase().endsWith('.wav')) return null
    const buf = await file.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
    const b64 = btoa(binary)
    const take: Take = {
      id: crypto.randomUUID(),
      name: file.name.replace(/\.wav$/i, ''),
      createdAt: Date.now(),
      durationFrames: 0,
      sampleRate: 48000,
      channels: 2,
      source: 'master',
      wavBase64: b64,
      peak: 0,
    }
    await saveTake(take)
    set((s) => ({ takes: [take, ...s.takes] }))
    return take
  },
}))
