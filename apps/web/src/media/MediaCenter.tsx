import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import { Dialog, HardwareButton } from '@openaxe/ui'

import { AUDIO_ACCEPT, formatTime } from './decode'
import { NoteGlyph, TabGlyph } from './icons'
import { allTags, matches, parseTags, sortItems, STATUSES } from './library'
import styles from './MediaCenter.module.css'
import { newMediaId, SCORE_EXTENSIONS, type LearnStatus, type MediaItem } from './mediaDb'
import { useMediaStore } from './mediaStore'
import { PracticeControls, TransportButtons } from './TransportBar'
import { NewSongForm } from './tabs/NewSongForm'
import { ToneLink, useToneFollower } from './ToneLink'
import { START_KEY, type ToneSection } from './tone'
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
  const [favorites, setFavorites] = useState(false)
  const [status, setStatus] = useState<LearnStatus | null>(null)
  const [tag, setTag] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const visible = useMemo(
    () =>
      sortItems(items.filter((i) => matches(i, { kind: filter, favorites, status, tag, query }))),
    [items, filter, query, favorites, status, tag],
  )
  const tags = useMemo(() => allTags(items), [items])

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
            <div className={styles.libFilters}>
              <button
                type="button"
                className={`${styles.chip} ${favorites ? styles.chipOn : ''}`}
                aria-pressed={favorites}
                onClick={() => setFavorites((v) => !v)}
                title="Favourites only"
              >
                ★
              </button>
              <select
                value={status ?? ''}
                onChange={(e) => setStatus((e.target.value || null) as LearnStatus | null)}
                aria-label="Filter by status"
              >
                <option value="">Any status</option>
                {STATUSES.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.label}
                  </option>
                ))}
              </select>
              {tags.length > 0 && (
                <select
                  value={tag ?? ''}
                  onChange={(e) => setTag(e.target.value || null)}
                  aria-label="Filter by tag"
                >
                  <option value="">Any tag</option>
                  {tags.map((t) => (
                    <option key={t} value={t}>
                      #{t}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <input
              className={styles.search}
              type="search"
              placeholder="Search · 120 bpm · key:Am"
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
  const [details, setDetails] = useState(false)
  const [name, setName] = useState(item.name)
  const [tagText, setTagText] = useState((item.tags ?? []).join(', '))
  const s = useMediaStore.getState()
  const statusLabel = STATUSES.find((x) => x.id === item.status)?.label
  return (
    <li
      className={`${styles.item} ${active ? styles.itemActive : ''} ${details ? styles.itemOpen : ''}`}
    >
      <div className={styles.itemRow}>
        <button
          type="button"
          className={`${styles.itemStar} ${item.favorite ? styles.itemStarOn : ''}`}
          aria-pressed={!!item.favorite}
          aria-label={item.favorite ? `Unfavourite ${item.name}` : `Favourite ${item.name}`}
          title={item.favorite ? 'Favourite' : 'Mark as favourite'}
          onClick={() => void s.updateItem(item.id, { favorite: !item.favorite })}
        >
          {item.favorite ? '★' : '☆'}
        </button>
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
                {statusLabel && ` · ${statusLabel}`}
                {(item.tags ?? []).length > 0 &&
                  ` · ${(item.tags ?? []).map((t) => `#${t}`).join(' ')}`}
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
        <button
          type="button"
          className={styles.itemDelete}
          aria-label={`Status and tags for ${item.name}`}
          aria-expanded={details}
          title="Status and tags"
          onClick={() => setDetails((v) => !v)}
        >
          ⋯
        </button>
      </div>
      {details && (
        <div className={styles.itemDetails}>
          <select
            value={item.status ?? ''}
            onChange={(e) =>
              void s.updateItem(item.id, {
                status: (e.target.value || null) as LearnStatus | null,
              })
            }
            aria-label={`Status of ${item.name}`}
          >
            <option value="">No status</option>
            {STATUSES.map((st) => (
              <option key={st.id} value={st.id}>
                {st.label}
              </option>
            ))}
          </select>
          <input
            value={tagText}
            placeholder="Tags: rock, easy, set 1"
            onChange={(e) => setTagText(e.target.value)}
            onBlur={() => {
              const next = parseTags(tagText)
              setTagText(next.join(', '))
              if (next.join(',') !== (item.tags ?? []).join(','))
                void s.updateItem(item.id, { tags: next })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
            aria-label={`Tags for ${item.name}`}
          />
          {item.info && (item.info.tempo || item.info.key) && (
            <span className={styles.dim}>
              {[item.info.key, item.info.tempo ? `${item.info.tempo} bpm` : '']
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
        </div>
      )}
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
  const detail = useMediaStore((st) => st.detail)
  const playing = useMediaStore((st) => st.playing)
  const [practiceOpen, setPracticeOpen] = useState(false)
  const s = useMediaStore.getState()
  const total = duration || item.duration
  const loopOn = practice.loopEnabled && practice.loopStart !== null
  const countInBars = practice.countInBars
  const live = useMediaStore((st) => st.items.find((i) => i.id === item.id)) ?? item
  const toneSections: ToneSection[] = [
    { key: START_KEY, label: 'Start', at: 0 },
    ...item.markers.map((m) => ({ key: m.id, label: `Marker ${m.label}`, at: m.time })),
  ]
  useToneFollower(live.tone, toneSections, position + 0.15 * practice.speed, playing)

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
        <details className={tabStyles.menu}>
          <summary title="Rig tone for this song: a scene, and a slot per marker">
            <I.TracksIcon size={16} /> Tone
            {live.tone?.scene != null ? ` · scene ${live.tone.scene + 1}` : ''}
          </summary>
          <div className={`${tabStyles.menuList} ${styles.toneMenu}`}>
            <ToneLink
              tone={live.tone ?? null}
              sections={toneSections}
              onChange={(tone) => void useMediaStore.getState().updateItem(item.id, { tone })}
            />
          </div>
        </details>
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
          zoomable
          detail={detail}
          playing={playing}
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
        <Tool
          icon={I.CountInIcon}
          title={
            countInBars
              ? `Count-in: ${countInBars} bar${countInBars > 1 ? 's' : ''} (click to change)`
              : 'Count-in off (click for 1 bar)'
          }
          tag={countInBars || undefined}
          on={countInBars > 0}
          onClick={() =>
            useMediaStore
              .getState()
              .setCountIn({ countInBars: countInBars >= 2 ? 0 : countInBars + 1 })
          }
        />
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
