import { useEffect, useRef, useState } from 'react'
import { useSongsStore } from './songsStore'
import { usePlayerStore } from './playerStore'
import { Dialog, HardwareButton } from '@openaxe/ui'
import styles from './SongsLibrary.module.css'

export function SongsLibrary() {
  const {
    songs,
    selectedId,
    search,
    loading,
    load,
    addFromFile,
    remove,
    rename,
    select,
    setSearch,
    getFiltered,
  } = useSongsStore()
  const setCurrentSong = usePlayerStore((s) => s.setCurrentSong)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  // Expose open via window for App header button (simple global, no extra store)
  useEffect(() => {
    const handler = () => setOpen(true)
    window.addEventListener('open-songs-library', handler)
    return () => window.removeEventListener('open-songs-library', handler)
  }, [])

  const filtered = getFiltered()

  const handleImport = async (file: File) => {
    setBusy(true)
    setError(null)
    const song = await addFromFile(file)
    if (!song) setError('Failed to import song — unsupported or corrupt file')
    else setCurrentSong(song)
    setBusy(false)
  }

  const handleSelect = (id: string) => {
    select(id)
    const song = songs.find((s) => s.id === id) ?? null
    if (song) setCurrentSong(song)
    setOpen(false)
  }

  const handleRename = async (id: string, current: string) => {
    const next = window.prompt('Rename song', current)
    if (!next || next.trim() === current) return
    await rename(id, next.trim())
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this song?')) return
    await remove(id)
  }

  if (!open) return null

  return (
    <Dialog
      open={true}
      onClose={() => setOpen(false)}
      title="SONGS"
      width="min(640px, 90vw)"
      zIndex={300}
    >
      <div className={styles.toolbar}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search songs…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept=".gp3,.gp4,.gp5,.gpx,.gp,.musicxml,.xml,.mid,.midi,.atex"
          className="srOnly"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleImport(file)
            e.target.value = ''
          }}
        />
        <HardwareButton
          label="Import…"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
        />
      </div>

      {error && <p className={styles.error}>{error}</p>}
      {loading && <p className={styles.hint}>Loading…</p>}

      <div className={styles.list}>
        {filtered.length === 0 && !loading && (
          <p className={styles.hint}>No songs yet — import a .gp, .musicxml, .mid or .atex file.</p>
        )}
        {filtered.map((song) => (
          <div
            key={song.id}
            className={`${styles.row} ${selectedId === song.id ? styles.selected : ''}`}
          >
            <div
              className={styles.rowInfo}
              onClick={() => handleSelect(song.id)}
              role="button"
              tabIndex={0}
            >
              <span className={styles.rowName}>{song.title}</span>
              <span className={styles.rowMeta}>
                {song.artist ? `${song.artist} · ` : ''}
                {song.barCount} bars · {song.tracks.length} track
                {song.tracks.length === 1 ? '' : 's'} · {song.filename}
              </span>
            </div>
            <div className={styles.rowActions}>
              <button
                type="button"
                className={styles.actionBtn}
                onClick={() => void handleRename(song.id, song.title)}
                aria-label={`Rename ${song.title}`}
              >
                Rename
              </button>
              <button
                type="button"
                className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                onClick={() => void handleDelete(song.id)}
                aria-label={`Delete ${song.title}`}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className={styles.hint}>
        Tip: Space = play/pause, L = set loop from selection. Works offline after import.
      </p>
    </Dialog>
  )
}

// Helper to open from App header
export function openSongsLibrary() {
  window.dispatchEvent(new Event('open-songs-library'))
}
