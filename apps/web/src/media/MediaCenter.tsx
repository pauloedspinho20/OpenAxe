import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import { Dialog, HardwareButton } from '@openaxe/ui'

import { AUDIO_ACCEPT, formatTime } from './decode'
import { NoteGlyph, TabGlyph } from './icons'
import styles from './MediaCenter.module.css'
import { newMediaId, SCORE_EXTENSIONS, type MediaItem } from './mediaDb'
import { useMediaStore } from './mediaStore'
import { PracticeControls, TransportButtons } from './TransportBar'
import { NewSongForm } from './tabs/NewSongForm'
import { Tool } from './tabs/TabToolbox'
import * as I from './tabs/tabIcons'
import { SidebarIcon } from './tabs/tabIcons'
import tabStyles from './tabs/TabWorkspace.module.css'
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
  // A tab wants the whole dialog: the library folds away while one is open
  // (the rail button brings it back), and the dialog grows to the viewport.
  // An open track or tab wants the whole dialog: the library folds away
  // (the rail button brings it back) and the dialog grows to the viewport.
  const focusMode = active !== null
  const [libraryOpen, setLibraryOpen] = useState(true)
  const [lastActive, setLastActive] = useState<string | null>(null)
  if (activeId !== lastActive) {
    setLastActive(activeId)
    setLibraryOpen(!focusMode)
  }
  const showLibrary = !focusMode || libraryOpen

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
      width={focusMode ? '100vw' : 'min(1320px, 97vw)'}
      maxHeight={focusMode ? '100svh' : '95vh'}
      className={`${styles.dialog} ${focusMode ? styles.dialogScore : ''}`}
    >
      <div
        className={`${styles.center} ${focusMode ? styles.centerScore : ''} ${showLibrary ? '' : styles.centerNoLib} ${dragOver ? styles.dragOver : ''}`}
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
        {focusMode && (
          <div className={styles.libToggle}>
            <HardwareButton
              label={libraryOpen ? 'Hide the library' : 'Show the library'}
              icon={<SidebarIcon size={16} />}
              iconOnly
              active={libraryOpen}
              onClick={() => setLibraryOpen((v) => !v)}
            />
          </div>
        )}
        {showLibrary && (
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
        )}

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
  const position = useMediaStore((st) => st.position)
  const duration = useMediaStore((st) => st.duration)
  const practice = useMediaStore((st) => st.practice)
  const loadState = useMediaStore((st) => st.loadState)
  const progress = useMediaStore((st) => st.loadProgress)
  const [practiceOpen, setPracticeOpen] = useState(false)
  const s = useMediaStore.getState()
  const total = duration || item.duration
  const loopOn = practice.loopEnabled && practice.loopStart !== null

  const addMarker = () => {
    const label = String.fromCharCode(65 + (item.markers.length % 26))
    const markers = [...item.markers, { id: newMediaId(), label, time: position }].sort(
      (a, b) => a.time - b.time,
    )
    void s.updateItem(item.id, { markers })
  }

  return (
    <div className={`${tabStyles.ws} ${styles.audioWs}`}>
      <header className={tabStyles.topbar}>
        <div className={tabStyles.songTitle} title={item.fileName}>
          <strong>{item.name}</strong>
          {item.artist && <span>{item.artist}</span>}
        </div>
        {loadState === 'loading' && (
          <span className={tabStyles.footerNote}>Loading… {Math.round(progress * 100)}%</span>
        )}
        <div className={styles.markers}>
          <Tool
            icon={I.SectionIcon}
            title="Add a section marker at the playhead"
            onClick={addMarker}
            tag="+"
          />
          {item.markers.map((m, i) => {
            const next = item.markers[i + 1]?.time ?? total
            return (
              <span key={m.id} className={styles.markerChip}>
                <button
                  type="button"
                  onClick={() => void s.seek(m.time)}
                  title={`Go to ${m.label} (${formatTime(m.time)})`}
                >
                  {m.label}
                </button>
                <button
                  type="button"
                  onClick={() => s.setLoop(m.time, next, true)}
                  title={`Loop section ${m.label}`}
                  aria-label={`Loop section ${m.label}`}
                >
                  <I.LoopIcon size={12} />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void s.updateItem(item.id, {
                      markers: item.markers.filter((x) => x.id !== m.id),
                    })
                  }
                  aria-label={`Remove marker ${m.label}`}
                  title="Remove marker"
                >
                  ×
                </button>
              </span>
            )
          })}
        </div>
      </header>

      <div className={styles.waveArea}>
        <Waveform
          peaks={item.peaks}
          duration={total}
          position={position}
          loopStart={practice.loopStart}
          loopEnd={practice.loopEnd}
          loopEnabled={practice.loopEnabled}
          markers={item.markers}
          onSeek={(t) => void s.seek(t)}
          onLoopChange={(a, b) => s.setLoop(a, b, true)}
          height="fill"
        />
      </div>

      <footer className={tabStyles.footer}>
        <TransportButtons />
        <div className={tabStyles.barGroup} title="A-B loop">
          <Tool
            icon={I.LoopIcon}
            title={loopOn ? 'Loop on (L)' : 'Loop off (L)'}
            on={loopOn}
            onClick={() => s.toggleLoop()}
          />
          <Tool
            icon={I.LoopIcon}
            title="Set loop start here ([)"
            tag="A"
            onClick={() => s.setLoopPoint('start', position)}
          />
          <Tool
            icon={I.LoopIcon}
            title="Set loop end here (])"
            tag="B"
            onClick={() => s.setLoopPoint('end', position)}
          />
        </div>
        <div className={tabStyles.barGroup} title="Speed (pitch preserved)">
          <Tool
            icon={I.MinusIcon}
            title="Slower (−5%)"
            onClick={() => s.setSpeed(practice.speed - 0.05)}
          />
          <button
            type="button"
            className={tabStyles.zoomValue}
            onClick={() => s.setSpeed(1)}
            title="Speed — click to reset to 100%"
          >
            {Math.round(practice.speed * 100)}%
          </button>
          <Tool
            icon={I.PlusIcon}
            title="Faster (+5%)"
            onClick={() => s.setSpeed(practice.speed + 0.05)}
          />
        </div>
        <div className={tabStyles.barGroup} title="Transpose">
          <Tool
            icon={I.FlatIcon}
            title="Down a semitone"
            onClick={() => s.setSemitones(practice.semitones - 1)}
          />
          <button
            type="button"
            className={tabStyles.zoomValue}
            onClick={() => s.setSemitones(0)}
            title="Transpose — click to reset"
          >
            {practice.semitones > 0 ? '+' : ''}
            {practice.semitones} st
          </button>
          <Tool
            icon={I.SharpIcon}
            title="Up a semitone"
            onClick={() => s.setSemitones(practice.semitones + 1)}
          />
        </div>
        <div className={tabStyles.barGroup} title="Track volume">
          <I.MuteIcon size={15} />
          <input
            className={styles.volume}
            type="range"
            min={0}
            max={200}
            value={Math.round(practice.volume * 100)}
            onChange={(e) => s.setVolume(Number(e.target.value) / 100)}
            onDoubleClick={() => s.setVolume(1)}
            aria-label="Track volume"
          />
        </div>
        <span className={tabStyles.footerSpacer} />
        <details
          className={tabStyles.menu}
          open={practiceOpen}
          onToggle={(e) => setPracticeOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary title="Practice: speed presets, trainer, A-B loop, volume">
            <I.TempoIcon size={18} /> Practice
          </summary>
          <div className={tabStyles.practicePop}>
            <PracticeControls />
          </div>
        </details>
      </footer>
    </div>
  )
}
