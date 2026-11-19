import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import { Dialog } from '@openaxe/ui'

import { AUDIO_ACCEPT, formatTime } from './decode'
import { NoteGlyph, TabGlyph } from './icons'
import styles from './MediaCenter.module.css'
import { newMediaId, SCORE_EXTENSIONS, type MediaItem } from './mediaDb'
import { useMediaStore } from './mediaStore'
import { PracticeControls, TransportButtons } from './TransportBar'
import { NewSongForm } from './tabs/NewSongForm'
import { Waveform } from './Waveform'

// alphaTab is large; only load it when a score is opened.
const TabWorkspace = lazy(() => import('./tabs/TabWorkspace'))

type Filter = 'all' | 'audio' | 'score'

interface MediaCenterProps {
  open: boolean
  onClose: () => void
}

export function MediaCenter({ open, onClose }: MediaCenterProps) {
  const items = useMediaStore((s) => s.items)
  const activeId = useMediaStore((s) => s.activeId)
  const error = useMediaStore((s) => s.error)
  const hasTransport = useMediaStore((s) => s.transport !== null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter(
      (i) =>
        (filter === 'all' || i.kind === filter) &&
        (!q || `${i.name} ${i.artist} ${i.fileName}`.toLowerCase().includes(q)),
    )
  }, [items, filter, query])

  const active = items.find((i) => i.id === activeId) ?? null

  const importFiles = async (files: FileList | File[]) => {
    if (!files.length) return
    setBusy(true)
    try {
      const added = await useMediaStore.getState().importFiles(files)
      if (added[0]) void useMediaStore.getState().open(added[0].id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Media Center"
      width="min(1320px, 97vw)"
      maxHeight="95vh"
      className={styles.dialog ?? ''}
    >
      <div
        className={`${styles.center} ${dragOver ? styles.dragOver : ''}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault()
            setDragOver(true)
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          void importFiles(e.dataTransfer.files)
        }}
      >
        <aside className={styles.sidebar}>
          <div className={styles.sideActions}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              {busy ? 'Importing…' : 'Import files'}
            </button>
            <button
              type="button"
              className={styles.chip}
              onClick={() => setNewOpen((v) => !v)}
              aria-pressed={newOpen}
              title="Start a new song from scratch"
            >
              New song
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              accept={`${AUDIO_ACCEPT},${SCORE_EXTENSIONS.join(',')}`}
              onChange={(e) => {
                if (e.target.files) void importFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </div>
          <div className={styles.filters} role="tablist" aria-label="Library filter">
            {(['all', 'audio', 'score'] as const).map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                className={`${styles.filter} ${filter === f ? styles.filterOn : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'All' : f === 'audio' ? 'Backing tracks' : 'Tabs'}
              </button>
            ))}
          </div>
          <input
            className={styles.search}
            type="search"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search library"
          />
          <ul className={styles.list}>
            {visible.length === 0 && (
              <li className={styles.emptyList}>
                {items.length === 0
                  ? 'Drop audio files (mp3, wav, flac…) or Guitar Pro / MusicXML files here.'
                  : 'Nothing matches.'}
              </li>
            )}
            {visible.map((item) => (
              <LibraryRow key={item.id} item={item} active={item.id === activeId} />
            ))}
          </ul>
        </aside>

        <section className={styles.main}>
          {!hasTransport && (
            <div className={styles.notice}>Power on the audio engine to play tracks and tabs.</div>
          )}
          {error && (
            <div className={styles.errorNotice} role="alert">
              {error}
              <button
                type="button"
                className={styles.chip}
                onClick={() => useMediaStore.setState({ error: null })}
              >
                Dismiss
              </button>
            </div>
          )}
          {newOpen && <NewSongForm onDone={() => setNewOpen(false)} />}
          {!active && !newOpen && <EmptyState onImport={() => fileRef.current?.click()} />}
          {active?.kind === 'audio' && <AudioView item={active} />}
          {active?.kind === 'score' && (
            <Suspense fallback={<div className={styles.loading}>Loading tab editor…</div>}>
              <TabWorkspace key={active.id} item={active} />
            </Suspense>
          )}
        </section>
      </div>
    </Dialog>
  )
}

function LibraryRow({ item, active }: { item: MediaItem; active: boolean }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(item.name)
  const s = useMediaStore.getState()
  return (
    <li className={`${styles.item} ${active ? styles.itemActive : ''}`}>
      <button
        type="button"
        className={styles.itemMain}
        onClick={() => void s.open(item.id)}
        onDoubleClick={() => setEditing(true)}
        title={item.fileName}
      >
        <span className={styles.itemIcon}>
          {item.kind === 'score' ? <TabGlyph size={16} /> : <NoteGlyph size={14} />}
        </span>
        {editing ? (
          <input
            className={styles.renameInput}
            value={name}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              setEditing(false)
              if (name.trim() && name !== item.name)
                void s.updateItem(item.id, { name: name.trim() })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') {
                setName(item.name)
                setEditing(false)
              }
            }}
          />
        ) : (
          <span className={styles.itemText}>
            <span className={styles.itemName}>{item.name}</span>
            <span className={styles.itemMeta}>
              {item.artist || (item.kind === 'score' ? 'Tab' : 'Backing track')}
              {item.duration > 0 && ` · ${formatTime(item.duration).replace(/\.\d$/, '')}`}
            </span>
          </span>
        )}
      </button>
      <button
        type="button"
        className={styles.itemDelete}
        aria-label={`Delete ${item.name}`}
        title="Delete"
        onClick={() => {
          if (confirm(`Delete "${item.name}" from the library?`)) void s.removeItem(item.id)
        }}
      >
        ×
      </button>
    </li>
  )
}

function EmptyState({ onImport }: { onImport: () => void }) {
  return (
    <div className={styles.empty}>
      <h3>Practice with backing tracks and tabs</h3>
      <p>
        Import audio (mp3, wav, flac, ogg, m4a) to play along at any speed without changing pitch,
        transpose it, and loop the hard parts. Import Guitar Pro (.gp, .gp3–.gp5, .gpx), MusicXML or
        AlphaTex files to read, play and edit tabs. Everything plays through your rig's output.
      </p>
      <button type="button" className={styles.primaryBtn} onClick={onImport}>
        Import files
      </button>
    </div>
  )
}

function AudioView({ item }: { item: MediaItem }) {
  const position = useMediaStore((s) => s.position)
  const duration = useMediaStore((s) => s.duration)
  const practice = useMediaStore((s) => s.practice)
  const loadState = useMediaStore((s) => s.loadState)
  const progress = useMediaStore((s) => s.loadProgress)
  const s = useMediaStore.getState()

  const addMarker = () => {
    const label = String.fromCharCode(65 + (item.markers.length % 26))
    const markers = [...item.markers, { id: newMediaId(), label, time: position }].sort(
      (a, b) => a.time - b.time,
    )
    void s.updateItem(item.id, { markers })
  }

  return (
    <div className={styles.view}>
      <header className={styles.viewHeader}>
        <div>
          <h3 className={styles.viewTitle}>{item.name}</h3>
          {item.artist && <div className={styles.viewSub}>{item.artist}</div>}
        </div>
        {loadState === 'loading' && (
          <span className={styles.dim}>Loading… {Math.round(progress * 100)}%</span>
        )}
      </header>
      <Waveform
        peaks={item.peaks}
        duration={duration || item.duration}
        position={position}
        loopStart={practice.loopStart}
        loopEnd={practice.loopEnd}
        loopEnabled={practice.loopEnabled}
        markers={item.markers}
        onSeek={(t) => void s.seek(t)}
        onLoopChange={(a, b) => s.setLoop(a, b, true)}
        height={120}
      />
      <div className={styles.transportRow}>
        <TransportButtons />
        <div className={styles.markers}>
          <button
            type="button"
            className={styles.chip}
            onClick={addMarker}
            title="Add a section marker at the playhead (M)"
          >
            + Marker
          </button>
          {item.markers.map((m, i) => {
            const next = item.markers[i + 1]?.time ?? (duration || item.duration)
            return (
              <span key={m.id} className={styles.markerChip}>
                <button
                  type="button"
                  onClick={() => void s.seek(m.time)}
                  title={`Go to ${m.label}`}
                >
                  {m.label}
                </button>
                <button
                  type="button"
                  onClick={() => s.setLoop(m.time, next, true)}
                  title={`Loop section ${m.label}`}
                  aria-label={`Loop section ${m.label}`}
                >
                  ⟲
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void s.updateItem(item.id, {
                      markers: item.markers.filter((x) => x.id !== m.id),
                    })
                  }
                  aria-label={`Remove marker ${m.label}`}
                >
                  ×
                </button>
              </span>
            )
          })}
        </div>
      </div>
      <PracticeControls />
    </div>
  )
}
