import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import { ButtonGroup, Drawer, HardwareButton, Select, Stepper } from '@openaxe/ui'

import { AUDIO_ACCEPT, formatTime } from './decode'
import { NoteGlyph, TabGlyph } from './icons'
import { allTags, isImportable, matches, parseTags, sortItems, STATUSES } from './library'
import styles from './MediaCenter.module.css'
import { newMediaId, SCORE_EXTENSIONS, type LearnStatus, type MediaItem } from './mediaDb'
import { useMediaStore } from './mediaStore'
import { PACK_EXTENSION } from './practicePack'
import { SetBar, SetListsPanel } from './SetListsPanel'
import { PracticeControls, TransportButtons } from './TransportBar'
import { useNarrowViewport } from './useMediaQuery'
import { NewSongForm } from './tabs/NewSongForm'
import { syncedScoreSections } from './tabs/sync'
import { ToneLink, tonePresetNames, useToneFollower } from './ToneLink'
import { START_KEY, type ToneSection } from './tone'
import { WorkspacePopover, useRovingToolbar } from './tabs/WorkspaceControls'
import * as I from './tabs/tabIcons'
import tabStyles from './tabs/TabWorkspace.module.css'
import { Waveform } from './Waveform'

// alphaTab is large; only load it when a score is opened.
const TabWorkspace = lazy(() => import('./tabs/TabWorkspace'))

type Filter = 'all' | 'audio' | 'score' | 'sets'

interface MediaCenterProps {
  /** Whether the Media Center view is currently active in the shell. */
  active?: boolean | undefined
}

export function MediaCenter({ active: viewActive = true }: MediaCenterProps = {}) {
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
  const folderRef = useRef<HTMLInputElement | null>(null)
  const notice = useMediaStore((s) => s.notice)

  const visible = useMemo(
    () =>
      filter === 'sets'
        ? []
        : sortItems(
            items.filter((i) => matches(i, { kind: filter, favorites, status, tag, query })),
          ),
    [items, filter, query, favorites, status, tag],
  )
  const tags = useMemo(() => allTags(items), [items])

  const active = items.find((i) => i.id === activeId) ?? null
  const isNarrow = useNarrowViewport('(max-width: 920px)')
  const focusMode = active !== null
  const [libraryOpen, setLibraryOpen] = useState(true)
  const [lastActive, setLastActive] = useState<string | null>(null)
  if (activeId !== lastActive) {
    setLastActive(activeId)
    setLibraryOpen(!focusMode)
  }
  const showLibrary = focusMode ? libraryOpen : !(isNarrow && newOpen)
  const libraryAsDrawer = focusMode && isNarrow && showLibrary

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

  const sidebarNode = (
    <Drawer
      open
      side="left"
      overlay={libraryAsDrawer}
      active={viewActive}
      showHeader={libraryAsDrawer}
      title="Library"
      icon={<I.LibraryIcon size={15} />}
      width="min(320px, 88vw)"
      className={libraryAsDrawer ? undefined : styles.sidebar}
      onClose={() => setLibraryOpen(false)}
    >
      <div className={styles.sideActions}>
        <HardwareButton
          size="small"
          variant="accent"
          label={busy ? 'Importing…' : 'Import files'}
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        />
        <HardwareButton
          size="small"
          label="New song"
          active={newOpen}
          title="Start a new song from scratch"
          onClick={() => {
            setNewOpen((v) => !v)
            if (isNarrow && focusMode) setLibraryOpen(false)
          }}
        />
        <HardwareButton
          size="small"
          label="Import folder"
          disabled={busy}
          title="Import every audio and tab file in a folder (duplicates are skipped)"
          onClick={() => folderRef.current?.click()}
        />
        <input
          ref={(el) => {
            folderRef.current = el
            // Not in React's typings; lets the picker choose a folder.
            el?.setAttribute('webkitdirectory', '')
          }}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const audioExt = AUDIO_ACCEPT.split(',').filter((x) => x.startsWith('.'))
            const files = [...(e.target.files ?? [])].filter((f) =>
              isImportable(f.name, audioExt, [...SCORE_EXTENSIONS, PACK_EXTENSION]),
            )
            if (files.length) void importFiles(files)
            else
              useMediaStore.setState({
                notice: 'No audio or tab files were found in that folder.',
              })
            e.target.value = ''
          }}
        />
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          accept={`${AUDIO_ACCEPT},${SCORE_EXTENSIONS.join(',')},${PACK_EXTENSION}`}
          onChange={(e) => {
            if (e.target.files) void importFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
      <ButtonGroup
        mode="tablist"
        label="Library filter"
        stretch
        value={filter}
        onChange={setFilter}
        items={[
          { value: 'all', label: 'All' },
          { value: 'audio', label: 'Backing' },
          { value: 'score', label: 'Tabs' },
          { value: 'sets', label: 'Sets' },
        ]}
      />
      {filter === 'sets' ? (
        <SetListsPanel />
      ) : (
        <>
          <div className={styles.libFilters}>
            <HardwareButton
              size="small"
              label={favorites ? '★' : '☆'}
              active={favorites}
              ariaLabel={favorites ? 'Show all songs' : 'Show favourites only'}
              title={favorites ? 'Showing favourites — click for all' : 'Favourites only'}
              onClick={() => setFavorites((v) => !v)}
            />
            <Select
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
            </Select>
            {tags.length > 0 && (
              <Select
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
              </Select>
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
              <LibraryRow
                key={item.id}
                item={item}
                active={item.id === activeId}
                onOpened={isNarrow ? () => setLibraryOpen(false) : undefined}
              />
            ))}
          </ul>
        </>
      )}
    </Drawer>
  )

  return (
    <div
      className={`${styles.shell} ${styles.center} ${focusMode ? styles.centerScore : ''} ${showLibrary && !libraryAsDrawer ? '' : styles.centerNoLib} ${dragOver ? styles.dragOver : ''}`}
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
      {showLibrary && sidebarNode}

      <section className={`${styles.main} ${!focusMode && !newOpen ? styles.mainBrowse : ''}`}>
        <SetBar />
        {!hasTransport && (
          <div className={styles.notice}>Power on the audio engine to play tracks and tabs.</div>
        )}
        {notice && (
          <div className={styles.notice} role="status">
            {notice}
            <HardwareButton
              size="small"
              label="Dismiss"
              onClick={() => useMediaStore.setState({ notice: null })}
            />
          </div>
        )}
        {error && (
          <div className={styles.errorNotice} role="alert">
            {error}
            <HardwareButton
              size="small"
              label="Dismiss"
              onClick={() => useMediaStore.setState({ error: null })}
            />
          </div>
        )}
        {newOpen && <NewSongForm onDone={() => setNewOpen(false)} />}
        {!active && !newOpen && <EmptyState onImport={() => fileRef.current?.click()} />}
        {active?.kind === 'audio' && (
          <AudioView
            item={active}
            libraryOpen={libraryOpen}
            onToggleLibrary={() => setLibraryOpen((v) => !v)}
          />
        )}
        {active?.kind === 'score' && (
          <Suspense fallback={<div className={styles.loading}>Loading tab editor…</div>}>
            <TabWorkspace
              key={active.id}
              item={active}
              libraryOpen={libraryOpen}
              onToggleLibrary={() => setLibraryOpen((v) => !v)}
              viewActive={viewActive}
            />
          </Suspense>
        )}
      </section>
    </div>
  )
}

function LibraryRow({
  item,
  active,
  onOpened,
}: {
  item: MediaItem
  active: boolean
  onOpened?: (() => void) | undefined
}) {
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
          onClick={() => {
            void s.open(item.id)
            onOpened?.()
          }}
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
          <Select
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
          </Select>
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
          <HardwareButton
            size="small"
            label="Share as practice pack"
            title="One file with the song, its paired recording, loops, markers and notes"
            onClick={() => {
              void tonePresetNames(item.tone)
                .then((names) => s.exportPack(item.id, names))
                .then((blob) => {
                  const url = URL.createObjectURL(blob)
                  const link = document.createElement('a')
                  link.href = url
                  link.download = `${item.name}${PACK_EXTENSION}`
                  link.click()
                  setTimeout(() => URL.revokeObjectURL(url), 10_000)
                })
                .catch((err: unknown) =>
                  useMediaStore.setState({
                    error: `Could not make the practice pack: ${err instanceof Error ? err.message : String(err)}`,
                  }),
                )
            }}
          />
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
        transpose it, and loop the hard parts. Import Guitar Pro (.gp, .gp3–.gp5, .gpx), MusicXML,
        AlphaTex or MIDI (.mid/.midi) files to read, play and edit tabs, or a practice pack
        (.oapack) someone shared. Everything plays through your rig's output.
      </p>
      <HardwareButton variant="accent" label="Import files" onClick={onImport} />
    </div>
  )
}

function AudioView({
  item,
  libraryOpen,
  onToggleLibrary,
}: {
  item: MediaItem
  libraryOpen: boolean
  onToggleLibrary: () => void
}) {
  const position = useMediaStore((st) => st.position)
  const duration = useMediaStore((st) => st.duration)
  const practice = useMediaStore((st) => st.practice)
  const loadState = useMediaStore((st) => st.loadState)
  const progress = useMediaStore((st) => st.loadProgress)
  const detail = useMediaStore((st) => st.detail)
  const playing = useMediaStore((st) => st.playing)
  const [practiceOpen, setPracticeOpen] = useState(false)
  const isPhone = useNarrowViewport('(max-width: 640px)')
  const topbarRef = useRef<HTMLDivElement | null>(null)
  const footerRef = useRef<HTMLDivElement | null>(null)
  const topbarRoving = useRovingToolbar(topbarRef, 'horizontal')
  const footerRoving = useRovingToolbar(footerRef, 'horizontal')
  const s = useMediaStore.getState()
  const total = duration || item.duration
  const loopOn = practice.loopEnabled && practice.loopStart !== null
  const countInBars = practice.countInBars
  const live = useMediaStore((st) => st.items.find((i) => i.id === item.id)) ?? item
  const items = useMediaStore((st) => st.items)
  const scoreMarkers = useMemo(
    () => syncedScoreSections(items, item.id, total),
    [items, item.id, total],
  )
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
      <header
        ref={topbarRef}
        className={tabStyles.topbar}
        role="toolbar"
        aria-label="Backing track header"
        {...topbarRoving}
      >
        <div className={tabStyles.topLeft}>
          <HardwareButton
            size="small"
            focusableWhenDisabled
            label="Library"
            ariaLabel={libraryOpen ? 'Hide library' : 'Show library'}
            hideLabelBelow="md"
            icon={<I.LibraryIcon size={15} />}
            active={libraryOpen}
            onClick={onToggleLibrary}
          />
          <div className={tabStyles.songTitle} title={item.fileName}>
            <strong>{item.name}</strong>
            {item.artist && <span>{item.artist}</span>}
          </div>
          {loadState === 'loading' && (
            <span className={tabStyles.footerNote}>Loading… {Math.round(progress * 100)}%</span>
          )}
        </div>
        <div className={tabStyles.topRight}>
          <WorkspacePopover
            label="Practice controls"
            triggerText="Practice"
            hideLabelBelow="sm"
            icon={<I.TempoIcon size={15} />}
            placement="bottom-end"
            sheetOnMobile
            width="wide"
            open={practiceOpen}
            onOpenChange={setPracticeOpen}
            title="Speed presets, trainer, A-B loop, transpose & volume"
          >
            <PracticeControls />
          </WorkspacePopover>
          <WorkspacePopover
            label="Tone"
            triggerText={live.tone?.scene != null ? `Tone · S${live.tone.scene + 1}` : 'Tone'}
            icon={<I.ToneIcon size={15} />}
            active={live.tone?.scene != null}
            width="tone"
            sheetOnMobile
            title="Rig tone for this song: a scene, and a slot per marker"
          >
            <ToneLink
              tone={live.tone ?? null}
              sections={toneSections}
              onChange={(tone) => void useMediaStore.getState().updateItem(item.id, { tone })}
            />
          </WorkspacePopover>
          <div className={styles.markers}>
            <HardwareButton
              size="small"
              focusableWhenDisabled
              label="+ Marker"
              ariaLabel="Add section marker at playhead"
              hideLabelBelow="sm"
              icon={<I.SectionIcon size={15} />}
              onClick={addMarker}
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
            {scoreMarkers.map((m, i) => {
              const next = scoreMarkers[i + 1]?.time ?? total
              return (
                <span key={m.id} className={`${styles.markerChip} ${styles.scoreMarkerChip}`}>
                  <button
                    type="button"
                    onClick={() => void s.seek(m.time)}
                    title={`${m.label} (${m.sourceName}, bar ${m.bar + 1} · ${formatTime(m.time)})`}
                  >
                    {m.label}
                  </button>
                  <button
                    type="button"
                    onClick={() => s.setLoop(m.time, next, true)}
                    title={`Loop score section ${m.label}`}
                    aria-label={`Loop score section ${m.label}`}
                  >
                    <I.LoopIcon size={12} />
                  </button>
                </span>
              )
            })}
          </div>
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
          scoreMarkers={scoreMarkers.map((m) => ({
            id: m.id,
            label: m.label,
            time: m.time,
            title: `${m.label} (${m.sourceName}, bar ${m.bar + 1})`,
          }))}
          onSeek={(t) => void s.seek(t)}
          onLoopChange={(a, b) => s.setLoop(a, b, true)}
          height="fill"
          zoomable
          detail={detail}
          playing={playing}
        />
      </div>

      <footer
        ref={footerRef}
        className={tabStyles.footer}
        role="toolbar"
        aria-label="Backing track transport"
        {...footerRoving}
      >
        <TransportButtons />
        {isPhone ? (
          <HardwareButton
            size="small"
            focusableWhenDisabled
            iconOnly
            label={loopOn ? 'Loop on (L)' : 'Loop off (L)'}
            icon={<I.LoopIcon size={15} />}
            active={loopOn}
            onClick={() => s.toggleLoop()}
          />
        ) : (
          <ButtonGroup label="A-B loop" focusableWhenDisabled>
            <HardwareButton
              size="small"
              focusableWhenDisabled
              label="Loop"
              ariaLabel={loopOn ? 'Loop on (L)' : 'Loop off (L)'}
              icon={<I.LoopIcon size={15} />}
              active={loopOn}
              onClick={() => s.toggleLoop()}
            />
            <HardwareButton
              size="small"
              focusableWhenDisabled
              label="A"
              ariaLabel="Set loop start here ([)"
              onClick={() => s.setLoopPoint('start', position)}
            />
            <HardwareButton
              size="small"
              focusableWhenDisabled
              label="B"
              ariaLabel="Set loop end here (])"
              onClick={() => s.setLoopPoint('end', position)}
            />
          </ButtonGroup>
        )}
        {!isPhone && (
          <>
            <Stepper
              label="Speed (pitch preserved)"
              value={`${Math.round(practice.speed * 100)}%`}
              decrementIcon={<I.MinusIcon size={14} />}
              incrementIcon={<I.PlusIcon size={14} />}
              decrementLabel="Slower (−5%)"
              incrementLabel="Faster (+5%)"
              resetLabel={`Speed ${Math.round(practice.speed * 100)}%, reset to 100%`}
              resetTitle="Speed — click to reset to 100%"
              focusableWhenDisabled
              onDecrement={() => s.setSpeed(practice.speed - 0.05)}
              onIncrement={() => s.setSpeed(practice.speed + 0.05)}
              onReset={() => s.setSpeed(1)}
            />
            <Stepper
              label="Transpose"
              value={`${practice.semitones > 0 ? '+' : ''}${practice.semitones} st`}
              decrementIcon={<I.FlatIcon size={14} />}
              incrementIcon={<I.SharpIcon size={14} />}
              decrementLabel="Down a semitone"
              incrementLabel="Up a semitone"
              resetLabel={`Transpose ${practice.semitones} semitones, reset`}
              resetTitle="Transpose — click to reset"
              focusableWhenDisabled
              onDecrement={() => s.setSemitones(practice.semitones - 1)}
              onIncrement={() => s.setSemitones(practice.semitones + 1)}
              onReset={() => s.setSemitones(0)}
            />
            <HardwareButton
              size="small"
              focusableWhenDisabled
              label="Count"
              ariaLabel={
                countInBars
                  ? `Count-in: ${countInBars} bar${countInBars > 1 ? 's' : ''} (click to change)`
                  : 'Count-in off (click for 1 bar)'
              }
              badge={countInBars || undefined}
              icon={<I.CountInIcon size={15} />}
              active={countInBars > 0}
              onClick={() =>
                useMediaStore
                  .getState()
                  .setCountIn({ countInBars: countInBars >= 2 ? 0 : countInBars + 1 })
              }
            />
            <ButtonGroup label="Track volume" title="Track volume">
              <I.VolumeIcon size={15} />
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
            </ButtonGroup>
          </>
        )}
      </footer>
    </div>
  )
}
