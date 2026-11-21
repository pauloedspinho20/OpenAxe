/**
 * Tab viewer + editor (issues #205/#206). alphaTab renders the score and
 * follows the playhead; playback is the core backing-track player playing a
 * synthesized render of the score (see scoreAudio.ts), so tabs share the
 * speed/transpose/loop controls with backing tracks and play through the
 * rig's output on every shell.
 *
 * Editing is keyboard-first, Guitar-Pro style: digits enter frets, arrows
 * move between beats/strings, +/- change duration, R makes a rest, Del
 * removes a note, Ctrl/Cmd+Z/Y undo/redo. Every edit is a pure model
 * transform (scoreEdit.ts) followed by a re-render; the file autosaves as .gp.
 */
import {
  AlphaTabApi,
  exporter,
  importer,
  LayoutMode,
  midi,
  model,
  PlayerMode,
  ScrollMode,
  TabRhythmMode,
  type Settings,
  StaveProfile,
  type synth,
} from '@coderline/alphatab'
import { HardwareButton } from '@openaxe/ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import styles from '../MediaCenter.module.css'
import { loadMediaFile, saveMedia, saveMediaFile, type MediaItem } from '../mediaDb'
import { useMediaStore } from '../mediaStore'
import { PracticeControls, TransportButtons } from '../TransportBar'
import { DrumLane } from './DrumLane'
import { beatPositions, type FretPos, pitchAt as pitchOf, placePitch } from './fretboard'
import { FretboardPanel, type StepInput } from './FretboardPanel'
import { ChordCollector, midiFromFrequency, placeChord, StepDetector } from './stepEntry'
import { renderScoreAudio } from './scoreAudio'
import * as edit from './scoreEdit'
import * as ops from './scoreOps'
import { matches, nextTarget, targetFor, type WaitTarget } from './waitMode'
import { appendRun, barHeat, ListenTracker, RunScorer, type ListenBeat } from './practiceScore'
import { PracticePanel } from './PracticePanel'
import { routineSections, sectionDone, type RoutineSection } from './routine'
import { ToneLink, useToneFollower } from '../ToneLink'
import { START_KEY, type ToneSection } from '../tone'
import type { PracticeRun } from '../mediaDb'
import { audioToScore, mixGuide, scoreToAudio, upsertPoint } from './sync'
import { RecordingPanel } from './RecordingPanel'
import { decodeAudio } from '../decode'
import { onMidiNote, requestMidiAccess } from '../../midi/midiAccess'
import { useMidiStore } from '../../state/midiStore'
import { detectPitch } from '../../tuner/pitchDetect'
import { TrackSidebar } from './TrackSidebar'
import * as I from './tabIcons'
import { TabToolbox, Tool, type ToolGroup } from './TabToolbox'
import tabStyles from './TabWorkspace.module.css'

type Score = model.Score
type Profile = 'tab' | 'both' | 'score'

const PROFILE: Record<Profile, StaveProfile> = {
  tab: StaveProfile.Tab,
  both: StaveProfile.ScoreTab,
  score: StaveProfile.Score,
}

const UNDO_LIMIT = 100

/** Shared across open tabs, so a passage can be copied from one song into another. */
let clipboard: ops.Clipboard | null = null

interface TrackInfo {
  name: string
  strings: number
  percussion: boolean
}

/** Render the shown tracks (plus the active one), in score order. */
function renderView(api: AlphaTabApi, score: Score, active: number, shown: Set<number>): void {
  const indices = [...new Set([...shown, active])]
    .filter((i) => i >= 0 && i < score.tracks.length)
    .sort((a, b) => a - b)
  const tracks = indices.map((i) => score.tracks[i]!)
  if (tracks.length) api.renderTracks(tracks)
}

function trackList(score: Score): TrackInfo[] {
  return score.tracks.map((t) => ({
    name: t.name || `Track ${t.index + 1}`,
    strings: t.staves[0]?.stringTuning.tunings.length ?? 0,
    percussion: !!t.staves[0]?.isPercussion,
  }))
}

/** Error text, with AlphaTex diagnostics (line:col message) when present. */
function describeError(err: unknown): string {
  const e = err as {
    message?: string
    iterateDiagnostics?: () => Iterable<{ message: string; start?: { line: number; col: number } }>
  }
  const lines: string[] = []
  if (typeof e?.iterateDiagnostics === 'function') {
    for (const d of e.iterateDiagnostics()) {
      lines.push(d.start ? `Line ${d.start.line}:${d.start.col} — ${d.message}` : d.message)
    }
  }
  if (lines.length) return lines.slice(0, 5).join('\n')
  return e?.message ?? String(err)
}

interface CursorBox {
  x: number
  y: number
  w: number
  h: number
  stringY: number
}

export default function TabWorkspace({ item }: { item: MediaItem }) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const apiRef = useRef<AlphaTabApi | null>(null)
  const scoreRef = useRef<Score | null>(null)
  const undoRef = useRef<string[]>([])
  const redoRef = useRef<string[]>([])
  const revisionRef = useRef(0)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typedRef = useRef<{ digits: string; at: number }>({ digits: '', at: 0 })

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [tracks, setTracks] = useState<TrackInfo[]>([])
  const [trackIndex, setTrackIndex] = useState(item.view?.trackIndex ?? 0)
  const [muted, setMuted] = useState<Set<number>>(new Set())
  const [solo, setSolo] = useState<Set<number>>(new Set())
  const [profile, setProfile] = useState<Profile>(item.view?.profile ?? 'both')
  const [zoom, setZoom] = useState(item.view?.zoom ?? 1)
  const [tabRhythm, setTabRhythm] = useState(item.view?.tabRhythm ?? 'auto')
  // Practice view: just the music, bigger, and the transport (Esc leaves).
  const [reading, setReading] = useState(false)
  const viewZoom = reading ? Math.min(2.5, Math.max(1.4, zoom * 1.4)) : zoom
  const [horizontal, setHorizontal] = useState(item.view?.horizontal ?? false)
  const [metronome, setMetronome] = useState(false)
  const [editing, setEditing] = useState(false)
  // Fretboard / piano input panel, and the notes of the beat playing now on it.
  const [fretOpen, setFretOpen] = useState(item.view?.fretboard ?? false)
  const [playingNotes, setPlayingNotes] = useState<FretPos[]>([])
  const fretTrackRef = useRef(0)
  // Step entry: notes played on a MIDI controller or the guitar are written at the cursor.
  const [stepInput, setStepInput] = useState<StepInput>('off')
  const [stepAdvance, setStepAdvance] = useState(true)
  const [cursor, setCursor] = useState<edit.EditCursor>(edit.startCursor())
  const [box, setBox] = useState<CursorBox | null>(null)
  const [tick, setTick] = useState(0) // re-render after in-place model edits
  // The live score (alphaTab mutates it in place; `tick` re-renders after edits).
  const [score, setScore] = useState<Score | null>(null)
  const [revision, setRevision] = useState(0)
  const [history, setHistory] = useState({ undo: 0, redo: 0 })
  const [renderProgress, setRenderProgress] = useState<number | null>(null)
  const [texOpen, setTexOpen] = useState(false)
  const [texText, setTexText] = useState('')
  const [texError, setTexError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [title, setTitle] = useState({ title: '', artist: '' })
  /** Selection anchor: the range runs from here to the cursor (same track/voice). */
  const [anchor, setAnchor] = useState<ops.BeatRef | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(item.view?.sidebarOpen ?? true)
  // Recording sync: the tab's paired recording (live from the library) and
  // whether playback uses it instead of the synth.
  const liveItem = useMediaStore((st) => st.items.find((i) => i.id === item.id)) ?? item
  const sync = liveItem.sync ?? null
  const [source, setSource] = useState<'synth' | 'recording'>(
    item.view?.source ?? (item.sync ? 'recording' : 'synth'),
  )
  const useRec = source === 'recording' && !!sync
  // Guide: the selected track's synth mixed over the recording ("isolate your part").
  const [guide, setGuide] = useState(item.view?.guide ?? 0)
  const guideSig =
    useRec && guide > 0 ? `${trackIndex}|${guide}|${JSON.stringify(sync?.points ?? [])}` : ''
  const recRef = useRef({
    on: useRec,
    points: sync?.points ?? [],
    key: 1,
    audioId: sync?.audioId ?? '',
    guideSig,
    guide,
    track: trackIndex,
  })
  if (
    recRef.current.audioId !== (sync?.audioId ?? '') ||
    recRef.current.on !== useRec ||
    recRef.current.guideSig !== guideSig
  ) {
    recRef.current.key++
    recRef.current.audioId = sync?.audioId ?? ''
    recRef.current.guideSig = guideSig
  }
  recRef.current.guide = useRec ? guide : 0
  recRef.current.track = trackIndex
  recRef.current.on = useRec
  recRef.current.points = sync?.points ?? []
  /** Score seconds -> the player's timeline (identity for the synth). */
  const toPlayer = (sec: number) =>
    recRef.current.on ? scoreToAudio(recRef.current.points, sec) : sec
  /** The player's timeline -> score seconds. */
  const fromPlayer = (sec: number) =>
    recRef.current.on ? audioToScore(recRef.current.points, sec) : sec
  /** What `loaded.revision` must be for the player to hold the right audio. */
  const expectedRevision = () => (recRef.current.on ? -recRef.current.key : revisionRef.current)
  /** Score time playback is at (or was left at - restored from the library item). */
  const lastScorePos = useRef(item.resume ?? 0)
  const [tapBar, setTapBar] = useState(0)

  /** Listen mode: scores your playing against the tab while the song plays. */
  const [listenOn, setListenOn] = useState(false)
  const [heatOn, setHeatOn] = useState(true)
  const trackIndexRef = useRef(0)
  const liveItemRef = useRef(liveItem)
  liveItemRef.current = liveItem
  /** Save a finished run to the song's history; returns its accuracy. */
  const saveRun = (run: PracticeRun): number => {
    const runs = appendRun(liveItemRef.current.runs, run)
    liveItemRef.current = { ...liveItemRef.current, runs }
    void useMediaStore.getState().updateItem(item.id, { runs })
    return run.notes ? run.hits / run.notes : 0
  }

  /** Wait mode: the cursor holds on each note until the guitar plays it. */
  const [waitOn, setWaitOn] = useState(false)
  const [waitInfo, setWaitInfo] = useState<{
    label: string
    hits: number
    hit: boolean
    done: boolean
  }>({
    label: '',
    hits: 0,
    hit: false,
    done: false,
  })
  /** Tracks shown in the score (Guitar Pro's multi-track view); the active one always is. */
  const [shown, setShown] = useState<Set<number>>(
    new Set(item.view?.shown?.length ? item.view.shown : [item.view?.trackIndex ?? 0]),
  )
  const shownRef = useRef(shown)
  shownRef.current = shown
  const [toolGroup, setToolGroup] = useState<ToolGroup | null>('note')
  const [practiceOpen, setPracticeOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const wsRef = useRef<HTMLDivElement | null>(null)
  const [hasClip, setHasClip] = useState(clipboard !== null)
  const highlightingRef = useRef(false)

  const position = useMediaStore((s) => s.position)
  const loaded = useMediaStore((s) => s.loaded)
  const playing = useMediaStore((s) => s.playing)

  const settings = (): Settings => apiRef.current!.settings

  // ── alphaTab lifecycle ────────────────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current
    const viewport = viewportRef.current
    if (!host || !viewport) return
    let disposed = false
    const api = new AlphaTabApi(host, {
      core: { fontDirectory: '/font/', useWorkers: true },
      display: { layoutMode: LayoutMode.Page, staveProfile: PROFILE.both, scale: 1 },
      player: {
        playerMode: PlayerMode.EnabledExternalMedia,
        enableCursor: true,
        enableAnimatedBeatCursor: true,
        enableUserInteraction: true,
        scrollElement: viewport,
        scrollOffsetY: -60,
      },
    })
    apiRef.current = api

    api.scoreLoaded.on((score) => {
      scoreRef.current = score
      setScore(score)
      setTracks(trackList(score))
      setTitle({ title: score.title, artist: score.artist })
      setCursor((c) => edit.clampCursor(score, c))
    })
    api.renderFinished.on(() => {
      if (!disposed) setStatus('ready')
      setTick((t) => t + 1)
    })
    api.error.on((e) => {
      setError(describeError(e))
      setStatus('error')
    })
    // Clicking a note/beat moves the edit cursor there (and the playhead).
    api.noteMouseDown.on((note) => {
      setCursor(edit.cursorForBeat(note.beat, note.string))
    })
    api.beatMouseDown.on((beat) => {
      setCursor((c) => edit.cursorForBeat(beat, c.string))
    })
    // alphaTab's own drag-to-select becomes the edit selection.
    api.playbackRangeHighlightChanged.on((e) => {
      if (highlightingRef.current) return
      if (!e.startBeat || !e.endBeat) {
        setAnchor(null)
        return
      }
      const a = edit.cursorForBeat(e.startBeat)
      const b = edit.cursorForBeat(e.endBeat)
      setAnchor({ bar: a.bar, beat: a.beat })
      setCursor((c) => ({
        ...c,
        track: b.track,
        staff: b.staff,
        voice: b.voice,
        bar: b.bar,
        beat: b.beat,
      }))
    })

    void (async () => {
      try {
        const blob = await loadMediaFile(item.id)
        if (!blob) throw new Error('The file for this tab is missing')
        const lower = item.fileName.toLowerCase()
        if (lower.endsWith('.atex') || lower.endsWith('.tex')) {
          const text = await blob.text()
          const imp = new importer.AlphaTexImporter()
          imp.initFromString(text, api.settings)
          api.renderScore(imp.readScore())
        } else {
          api.load(new Uint8Array(await blob.arrayBuffer()))
        }
      } catch (err) {
        setError(describeError(err))
        setStatus('error')
      }
    })()

    return () => {
      disposed = true
      api.destroy()
      apiRef.current = null
      scoreRef.current = null
    }
  }, [item.id, item.fileName])

  // External-media bridge: alphaTab asks us to play/pause/seek; we feed it time.
  useEffect(() => {
    const api = apiRef.current
    const output = api?.player?.output as synth.IExternalMediaSynthOutput | undefined
    if (!output) return
    output.handler = {
      get backingTrackDuration() {
        return useMediaStore.getState().duration * 1000
      },
      playbackRate: 1,
      masterVolume: 1,
      seekTo(ms: number) {
        const s = useMediaStore.getState()
        if (s.loaded?.itemId === item.id) void s.seek(toPlayer(ms / 1000))
      },
      play() {
        void useMediaStore.getState().play()
      },
      pause() {
        void useMediaStore.getState().pause()
      },
    }
  }, [item.id, status])

  useEffect(() => {
    const output = apiRef.current?.player?.output as synth.IExternalMediaSynthOutput | undefined
    if (output && loaded?.itemId === item.id) {
      lastScorePos.current = fromPlayer(position)
      output.updatePosition(lastScorePos.current * 1000)
    }
  }, [position, loaded, item.id])

  // Display settings.
  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    api.settings.display.staveProfile = PROFILE[profile]
    api.settings.display.scale = viewZoom
    api.settings.display.layoutMode = horizontal ? LayoutMode.Horizontal : LayoutMode.Page
    api.settings.notation.rhythmMode =
      tabRhythm === 'on'
        ? TabRhythmMode.ShowWithBars
        : tabRhythm === 'off'
          ? TabRhythmMode.Hidden
          : TabRhythmMode.Automatic
    api.updateSettings()
    if (api.score) api.render()
  }, [profile, viewZoom, horizontal, tabRhythm])

  useEffect(() => {
    if (!reading) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      setReading(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reading])

  useEffect(() => {
    const api = apiRef.current
    const score = scoreRef.current
    if (!api || !score) return
    renderView(api, score, trackIndex, shown)
    setCursor((c) =>
      c.track === trackIndex
        ? c
        : edit.clampCursor(score, { ...c, track: trackIndex, bar: c.bar, beat: 0 }),
    )
  }, [trackIndex, shown, status === 'ready' && tracks.length > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clicking a beat of another shown track makes it the active one.
  useEffect(() => {
    if (cursor.track !== trackIndex) setTrackIndex(cursor.track)
  }, [cursor.track]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Playback preparation ──────────────────────────────────────────────
  const renderVolumes = useCallback(() => {
    const vol = new Map<number, number>()
    tracks.forEach((_, i) => {
      const audible = solo.size > 0 ? solo.has(i) : !muted.has(i)
      vol.set(i, audible ? 1 : 0)
    })
    return vol
  }, [tracks, muted, solo])

  const audioKey = useMemo(
    () => `${[...muted].join(',')}|${[...solo].join(',')}|${metronome}`,
    [muted, solo, metronome],
  )
  const audioKeyRef = useRef(audioKey)
  useEffect(() => {
    if (audioKeyRef.current !== audioKey) {
      audioKeyRef.current = audioKey
      revisionRef.current++
      setRevision(revisionRef.current)
    }
  }, [audioKey])

  const renderingRef = useRef<Promise<boolean> | null>(null)
  const prepare = useCallback(async (): Promise<boolean> => {
    const api = apiRef.current
    if (!api?.score) return false
    const s = useMediaStore.getState()
    const revision = expectedRevision()
    if (s.loaded?.itemId === item.id && s.loaded.revision === revision && s.loadState === 'ready') {
      return true
    }
    if (renderingRef.current) return renderingRef.current
    // Resume at the same place in the song, whichever audio was loaded before.
    const atScore = lastScorePos.current
    const rec = recRef.current
    renderingRef.current = (async () => {
      try {
        if (rec.on) {
          const blob = await loadMediaFile(rec.audioId)
          if (!blob) throw new Error('The paired recording is missing from the library')
          const audio = await decodeAudio(
            await blob.arrayBuffer(),
            useMediaStore.getState().engineRate,
          )
          let mixed = audio
          if (rec.guide > 0 && rec.points.length) {
            setRenderProgress(0)
            const vol = new Map<number, number>()
            api.score?.tracks.forEach((_, i) => vol.set(i, i === rec.track ? 1 : 0))
            const synthPart = await renderScoreAudio(api, {
              sampleRate: audio.sampleRate,
              trackVolume: vol,
              onProgress: setRenderProgress,
            })
            mixed = {
              ...audio,
              channels: mixGuide(audio, synthPart, playbackBars(), rec.points, rec.guide),
            }
          }
          await useMediaStore.getState().loadDecoded(item.id, mixed, revision)
          const at = scoreToAudio(rec.points, atScore)
          if (at > 0)
            await useMediaStore.getState().seek(Math.min(at, audio.frames / audio.sampleRate))
          return useMediaStore.getState().loadState === 'ready'
        }
        setRenderProgress(0)
        const track = await renderScoreAudio(api, {
          sampleRate: useMediaStore.getState().engineRate || 48_000,
          trackVolume: renderVolumes(),
          metronome,
          onProgress: setRenderProgress,
        })
        await useMediaStore.getState().loadDecoded(item.id, track, revision)
        if (atScore > 0)
          await useMediaStore.getState().seek(Math.min(atScore, track.frames / track.sampleRate))
        return useMediaStore.getState().loadState === 'ready'
      } catch (err) {
        useMediaStore.setState({
          error: `Could not render the tab: ${err instanceof Error ? err.message : String(err)}`,
        })
        return false
      } finally {
        setRenderProgress(null)
        renderingRef.current = null
      }
    })()
    return renderingRef.current
  }, [item.id, metronome, renderVolumes, useRec, sync?.audioId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    useMediaStore.setState({ prepare })
    return () => {
      if (useMediaStore.getState().prepare === prepare) useMediaStore.setState({ prepare: null })
    }
  }, [prepare])

  // A stale render keeps playing until the user presses play again; flag it.
  const stale =
    loaded?.itemId === item.id && loaded.revision !== (useRec ? -recRef.current.key : revision)

  // ── Editing ───────────────────────────────────────────────────────────
  const snapshot = (score: Score) => model.JsonConverter.scoreToJson(score)
  const bumpRevision = () => {
    revisionRef.current++
    setRevision(revisionRef.current)
  }
  const syncHistory = () =>
    setHistory({ undo: undoRef.current.length, redo: redoRef.current.length })

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const api = apiRef.current
      const score = scoreRef.current
      if (!api || !score) return
      try {
        const bytes = new exporter.Gp7Exporter().export(score, api.settings)
        const fileName = item.fileName.replace(/\.[^.]+$/, '') + '.gp'
        void saveMediaFile(
          item.id,
          new Blob([bytes as BlobPart], { type: 'application/octet-stream' }),
        )
          .then(() => {
            const latest = useMediaStore.getState().items.find((i) => i.id === item.id) ?? item
            const next = {
              ...latest,
              fileName,
              mime: 'application/octet-stream',
              size: bytes.length,
            }
            useMediaStore.setState({
              items: useMediaStore.getState().items.map((i) => (i.id === item.id ? next : i)),
            })
            return saveMedia(next)
          })
          .then(() => setSavedAt(Date.now()))
      } catch (err) {
        setError(`Autosave failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }, 1200)
  }, [item])

  /** Run an edit: snapshot for undo, mutate, re-render, autosave. */
  const apply = useCallback(
    (fn: (score: Score, s: Settings) => edit.EditCursor | void) => {
      const api = apiRef.current
      const score = scoreRef.current
      if (!api || !score) return
      undoRef.current.push(snapshot(score))
      if (undoRef.current.length > UNDO_LIMIT) undoRef.current.shift()
      redoRef.current = []
      const next = fn(score, api.settings)
      bumpRevision()
      syncHistory()
      setTracks(trackList(score))
      setTitle({ title: score.title, artist: score.artist })
      renderView(api, score, Math.min(trackIndex, score.tracks.length - 1), shownRef.current)
      if (next) setCursor(edit.clampCursor(score, next))
      setTick((x) => x + 1)
      scheduleSave()
    },
    [trackIndex, scheduleSave],
  )

  const restore = useCallback(
    (json: string) => {
      const api = apiRef.current
      if (!api) return
      const score = model.JsonConverter.jsonToScore(json, api.settings)
      scoreRef.current = score
      setScore(score)
      bumpRevision()
      syncHistory()
      setTracks(trackList(score))
      setAnchor(null)
      api.renderScore(score, [Math.min(trackIndex, score.tracks.length - 1)])
      setShown(new Set([Math.min(trackIndex, score.tracks.length - 1)]))
      setCursor((c) => edit.clampCursor(score, c))
      scheduleSave()
    },
    [trackIndex, scheduleSave],
  )

  const undo = useCallback(() => {
    const score = scoreRef.current
    const prev = undoRef.current.pop()
    if (!score || !prev) return
    redoRef.current.push(snapshot(score))
    restore(prev)
  }, [restore])

  const redo = useCallback(() => {
    const score = scoreRef.current
    const next = redoRef.current.pop()
    if (!score || !next) return
    undoRef.current.push(snapshot(score))
    restore(next)
  }, [restore])

  // Cursor overlay: locate the beat (and string) in the rendered score.
  useEffect(() => {
    const api = apiRef.current
    const score = scoreRef.current
    if (!api || !score || !(editing || waitOn)) {
      setBox(null)
      return
    }
    const beat = edit.beatAt(score, cursor)
    const bounds = beat ? api.boundsLookup?.findBeat(beat) : null
    if (!beat || !bounds) {
      setBox(null)
      return
    }
    const bar = bounds.barBounds.visualBounds
    const strings = edit.stringCount(score, cursor)
    const scale = api.settings.display.scale
    // Tab lines are evenly spaced at the bottom of the bar's bounds; calibrate
    // against a rendered note when the beat has one.
    const spacing = 10 * scale
    let bottom = bar.y + bar.h - 2 * scale
    const noteB = bounds.notes?.[0]
    if (noteB) {
      const nb = noteB.noteHeadBounds
      bottom = nb.y + nb.h / 2 + (noteB.note.string - 1) * spacing
    }
    const stringY = bottom - (cursor.string - 1) * spacing
    const vb = bounds.visualBounds
    setBox({
      x: vb.x - 4,
      y: Math.min(bar.y, stringY - (strings - cursor.string) * spacing),
      w: Math.max(vb.w, 14) + 8,
      h: bar.h,
      stringY,
    })
  }, [cursor, editing, waitOn, status, viewZoom, profile, horizontal, score, revision])

  // ── Selection ─────────────────────────────────────────────────────────
  const selection = useMemo(
    () => (score && anchor ? ops.rangeBeats(score, cursor, anchor, cursor) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [score, anchor, cursor, revision],
  )
  /** The selection, or just the cursor's beat when nothing is selected. */
  const targets = (): ops.BeatRef[] =>
    selection.length ? selection : [{ bar: cursor.bar, beat: cursor.beat }]

  useEffect(() => {
    const api = apiRef.current
    if (!api || !score) return
    highlightingRef.current = true
    try {
      if (selection.length > 1) {
        const first = edit.beatAt(score, { ...cursor, ...selection[0]! })
        const last = edit.beatAt(score, { ...cursor, ...selection[selection.length - 1]! })
        if (first && last) api.highlightPlaybackRange(first, last)
      } else {
        api.clearPlaybackRangeHighlight()
      }
    } finally {
      highlightingRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, status])

  const copySelection = (cut: boolean) => {
    const sc = scoreRef.current
    if (!sc) return
    const clip = ops.copyRange(sc, cursor, targets())
    if (!clip) return
    clipboard = clip
    setHasClip(true)
    if (cut) {
      const refs = targets()
      apply((x, s) => ops.deleteRange(x, cursor, refs, s))
      setAnchor(null)
    }
  }

  const pasteClipboard = () => {
    const clip = clipboard
    if (!clip) return
    apply((x, s) => ops.paste(x, cursor, clip, s))
    setAnchor(null)
  }

  /** Seconds at the start of a beat (first playthrough). */
  const beatTime = (ref: ops.BeatRef, end = false): number | null => {
    const sc = scoreRef.current
    const bar = barTimes(ref.bar)
    const beat = sc ? edit.beatAt(sc, { ...cursor, ...ref }) : null
    if (!sc || !bar || !beat) return null
    const tempo = edit.tempoAt(sc, ref.bar)
    const ticks = beat.playbackStart + (end ? beat.playbackDuration : 0)
    return bar.start + (ticks * 60) / (tempo * 960)
  }

  // ── Wait mode ─────────────────────────────────────────────────────────
  const cursorRef = useRef(cursor)
  cursorRef.current = cursor
  useEffect(() => {
    if (!waitOn) return
    const st = useMediaStore.getState()
    const analyser = st.inputAnalyser
    const sc = scoreRef.current
    if (!analyser || !sc) {
      setWaitOn(false)
      setError(
        'Wait mode listens to your guitar: power on with an input device (the tuner must see a signal).',
      )
      return
    }
    let at = nextTarget(sc, cursorRef.current, true)
    let busy = false
    let stable = 0
    let wrong = 0
    let missedHere = false
    let prevTarget: WaitTarget | null = null
    let hits = 0
    const scorer = new RunScorer('wait', st.practice.speed)
    let saved = false
    const save = () => {
      if (saved) return
      saved = true
      const run = scorer.finish()
      if (run) saveRun(run)
    }
    let flashTimer: ReturnType<typeof setTimeout> | null = null
    let pauseTimer: ReturnType<typeof setTimeout> | null = null
    const buffer = new Float32Array(analyser.fftSize) as Float32Array<ArrayBuffer>
    const show = (hit: boolean) => {
      const target = at ? targetFor(sc, at) : null
      setWaitInfo({ label: target?.label ?? '', hits, hit, done: !at })
    }
    if (at) setCursor(at)
    show(false)
    void prepare()

    const timer = setInterval(() => {
      if (busy || !at) return
      const target = targetFor(sc, at)
      if (!target) {
        at = nextTarget(sc, at)
        show(false)
        return
      }
      analyser.getFloatTimeDomainData(buffer)
      const pitch = detectPitch(buffer, analyser.context.sampleRate)
      const clear = !!pitch && pitch.clarity > 0.85
      stable = clear && matches(pitch.frequency, target) ? stable + 1 : 0
      // A clear, steady wrong note counts once as a miss for this note (the
      // previous note still ringing doesn't).
      wrong =
        clear &&
        !matches(pitch.frequency, target) &&
        !(prevTarget && matches(pitch.frequency, prevTarget))
          ? wrong + 1
          : 0
      if (wrong >= 4 && !missedHere) {
        missedHere = true
        scorer.miss(at.bar)
      }
      if (stable < 2) return
      // Hit: play this beat (up to the next note) so it's heard in time, then wait again.
      stable = 0
      wrong = 0
      if (!missedHere) scorer.hit(at.bar)
      missedHere = false
      prevTarget = target
      hits++
      busy = true
      const from = at
      const next = nextTarget(sc, from)
      const t0 = beatTime({ bar: from.bar, beat: from.beat })
      const t1 = next
        ? beatTime({ bar: next.bar, beat: next.beat })
        : beatTime({ bar: from.bar, beat: from.beat }, true)
      at = next
      if (!next) save()
      show(true)
      if (flashTimer) clearTimeout(flashTimer)
      flashTimer = setTimeout(() => show(false), 400)
      void (async () => {
        const store = useMediaStore.getState()
        const transport = store.transport
        if (transport && t0 !== null && t1 !== null && (await prepare())) {
          await store.seek(toPlayer(t0))
          await transport.setCountIn(0, 0.5, 4)
          store.applyStatus(await transport.play())
          const ms =
            (Math.max(0.05, toPlayer(t1) - toPlayer(t0)) /
              useMediaStore.getState().practice.speed) *
            1000
          pauseTimer = setTimeout(() => {
            void useMediaStore.getState().pause()
            busy = false
          }, ms)
        } else {
          busy = false
        }
        if (next) setCursor(next)
      })()
    }, 40)

    return () => {
      clearInterval(timer)
      if (flashTimer) clearTimeout(flashTimer)
      if (pauseTimer) clearTimeout(pauseTimer)
      save()
      void useMediaStore.getState().pause()
    }
    // The loop owns its position once started; restart it to re-anchor at the cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitOn, revision])

  // ── Listen mode ───────────────────────────────────────────────────────
  trackIndexRef.current = trackIndex
  useEffect(() => {
    if (!listenOn) return
    const analyser = useMediaStore.getState().inputAnalyser
    if (!analyser) {
      setListenOn(false)
      setError(
        'Listen mode needs your guitar: power on with an input device (the tuner must see a signal).',
      )
      return
    }
    const buffer = new Float32Array(analyser.fftSize) as Float32Array<ArrayBuffer>
    const targets = new Map<string, WaitTarget>()
    let scorer: RunScorer | null = null
    let tracker: ListenTracker | null = null
    let lastPos = -1
    // A pass ends on pause, at the end, or when a loop wraps / the user seeks back.
    const finish = () => {
      if (!scorer || !tracker) return
      tracker.flush(performance.now())
      const run = scorer.finish()
      scorer = null
      tracker = null
      targets.clear()
      if (run) useMediaStore.getState().reportPass(saveRun(run), run.speed)
    }
    const timer = setInterval(() => {
      const st = useMediaStore.getState()
      const api = apiRef.current
      const sc = scoreRef.current
      if (!api || !sc || !st.playing || st.counting || st.loaded?.itemId !== item.id) {
        finish()
        lastPos = -1
        return
      }
      if (lastPos >= 0 && st.position < lastPos - 0.25) finish()
      lastPos = st.position
      if (!scorer) {
        scorer = new RunScorer('listen', st.practice.speed)
        tracker = new ListenTracker(scorer)
      }
      const found = api.tickCache?.findBeat(new Set([trackIndexRef.current]), api.tickPosition)
      let beat: ListenBeat | null = null
      if (found) {
        const c = edit.cursorForBeat(found.beat)
        const key = `${c.track}:${c.bar}:${c.voice}:${c.beat}`
        const target = targetFor(sc, c)
        if (target) targets.set(key, target)
        beat = {
          key,
          bar: c.bar,
          scored: !!target,
          tooShort: found.duration / st.practice.speed < 90,
        }
      }
      analyser.getFloatTimeDomainData(buffer)
      const pitch = detectPitch(buffer, analyser.context.sampleRate)
      const freq = pitch && pitch.clarity > 0.8 ? pitch.frequency : 0
      tracker!.step(beat, performance.now(), (k) => {
        const t = targets.get(k)
        return !!t && freq > 0 && matches(freq, t)
      })
    }, 30)
    return () => {
      clearInterval(timer)
      finish()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listenOn])

  // Practice notes on bars: pinned on the sheet, shown with the bar.
  const barNotes = liveItem.barNotes ?? {}
  const setBarNote = (bar: number, text: string) => {
    const next = { ...(liveItem.barNotes ?? {}) }
    if (text.trim()) next[bar] = text.trim()
    else delete next[bar]
    void useMediaStore.getState().updateItem(item.id, { barNotes: next })
  }
  const [notePins, setNotePins] = useState<{ bar: number; x: number; y: number; text: string }[]>(
    [],
  )
  useEffect(() => {
    const lookup = apiRef.current?.boundsLookup
    const notes = Object.entries(liveItem.barNotes ?? {})
    if (!lookup || !notes.length) {
      setNotePins([])
      return
    }
    const pins: { bar: number; x: number; y: number; text: string }[] = []
    for (const [k, text] of notes) {
      const r = lookup.findMasterBarByIndex(Number(k))?.realBounds
      if (r) pins.push({ bar: Number(k), x: r.x + r.w - 18, y: r.y + 2, text })
    }
    setNotePins(pins)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveItem.barNotes, status, viewZoom, profile, horizontal, revision, shown, tick, tabRhythm])

  // Heat map: colour each scored bar of the recent runs on the sheet.
  const heat = useMemo(() => (heatOn ? barHeat(liveItem.runs) : new Map()), [heatOn, liveItem.runs])
  const [heatBoxes, setHeatBoxes] = useState<
    { x: number; y: number; w: number; h: number; acc: number }[]
  >([])
  useEffect(() => {
    const api = apiRef.current
    if (!api || !heatOn || heat.size === 0) {
      setHeatBoxes([])
      return
    }
    const boxes: { x: number; y: number; w: number; h: number; acc: number }[] = []
    for (const [bar, v] of heat) {
      const mb = api.boundsLookup?.findMasterBarByIndex(bar)
      if (!mb) continue
      const r = mb.realBounds
      boxes.push({ x: r.x, y: r.y, w: r.w, h: r.h, acc: v.accuracy })
    }
    setHeatBoxes(boxes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heat, heatOn, status, viewZoom, profile, horizontal, revision, shown, tick])

  const loopSelection = () => {
    const refs = targets()
    const a = beatTime(refs[0]!)
    const b = beatTime(refs[refs.length - 1]!, true)
    if (a === null || b === null) return
    useMediaStore.getState().setLoop(toPlayer(a), toPlayer(b), true)
    void prepare().then(async (ok) => {
      if (ok) await useMediaStore.getState().seek(toPlayer(a))
    })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const score = scoreRef.current
    if (!score) return
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
      return
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault()
      redo()
      return
    }
    if (e.key === ' ') {
      e.preventDefault()
      void useMediaStore.getState().toggle()
      return
    }
    if (e.key === 'Enter' && useRec && !editing) {
      e.preventDefault()
      void tapSync()
      return
    }
    if (e.key === '?') {
      e.preventDefault()
      setHelpOpen((v) => !v)
      return
    }
    if (!editing) return
    const s = settings()
    const c = cursor
    if (mod && ['c', 'x', 'v', 'a'].includes(e.key.toLowerCase())) {
      e.preventDefault()
      const k = e.key.toLowerCase()
      if (k === 'c') copySelection(false)
      if (k === 'x') copySelection(true)
      if (k === 'v') pasteClipboard()
      if (k === 'a') {
        const last = score.masterBars.length - 1
        const lastVoice = edit.voiceAt(score, { ...c, bar: last })
        setAnchor({ bar: 0, beat: 0 })
        setCursor({ ...c, bar: last, beat: Math.max(0, (lastVoice?.beats.length ?? 1) - 1) })
      }
      return
    }
    // Shift+arrows extend the selection; plain moves drop it.
    if (e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault()
      if (!anchor) setAnchor({ bar: c.bar, beat: c.beat })
      setCursor(
        e.key === 'ArrowRight' ? edit.moveRight(score, c, s, false) : edit.moveLeft(score, c),
      )
      return
    }
    // Alt+Up/Down transposes; Alt+Shift+Up/Down moves notes across strings.
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      const dir = e.key === 'ArrowUp' ? 1 : -1
      const refs = targets()
      if (e.shiftKey) apply((x) => ops.moveRangeString(x, c, refs, dir, s))
      else apply((x) => ops.transposeRange(x, c, refs, dir, s))
      return
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length > 1) {
      e.preventDefault()
      const refs = selection
      apply((x) => ops.deleteRange(x, c, refs, s))
      setAnchor(null)
      return
    }
    if (anchor && e.key.startsWith('Arrow')) setAnchor(null)
    if (ops.isPercussion(score, c) && /^\d$/.test(e.key)) return
    let handled = true
    if (/^\d$/.test(e.key)) {
      // Two quick digits make a two-digit fret (e.g. 1 then 2 -> 12).
      const now = e.timeStamp
      const prev = typedRef.current
      const digits = now - prev.at < 700 && prev.digits.length === 1 ? prev.digits + e.key : e.key
      typedRef.current = { digits, at: now }
      const fret = Number(digits) > 30 ? Number(e.key) : Number(digits)
      apply((sc) => edit.setFret(sc, c, fret, s))
    } else {
      typedRef.current = { digits: '', at: 0 }
      switch (e.key) {
        case 'ArrowRight':
          if (mod) setCursor(edit.moveBar(score, c, 1))
          else apply((sc) => edit.moveRight(sc, c, s))
          break
        case 'ArrowLeft':
          setCursor(mod ? edit.moveBar(score, c, -1) : edit.moveLeft(score, c))
          break
        case 'ArrowUp':
          setCursor(edit.moveString(score, c, 1))
          break
        case 'ArrowDown':
          setCursor(edit.moveString(score, c, -1))
          break
        case '+':
        case '=':
          apply((sc) => edit.stepDuration(sc, c, -1, s))
          break
        case '-':
        case '_':
          apply((sc) => edit.stepDuration(sc, c, 1, s))
          break
        case '.':
          apply((sc) => edit.toggleDot(sc, c, s))
          break
        case 'r':
        case 'R':
          apply((sc) => edit.makeRest(sc, c, s))
          break
        case 'Delete':
        case 'Backspace':
          if (e.shiftKey || !edit.noteAt(score, c)) apply((sc) => edit.deleteBeat(sc, c, s))
          else apply((sc) => edit.deleteNote(sc, c, s))
          break
        case 'Insert':
        case 'i':
        case 'I':
          apply((sc) => edit.insertBeatBefore(sc, c, s))
          break
        case 'p':
        case 'P':
          apply((sc) => void edit.toggleNoteEffect(sc, c, 'palmMute', s))
          break
        case 'h':
        case 'H':
          apply((sc) => void edit.toggleNoteEffect(sc, c, 'hammer', s))
          break
        case 's':
        case 'S':
          apply((sc) => void edit.toggleNoteEffect(sc, c, 'slide', s))
          break
        case 'v':
        case 'V':
          apply((sc) => void edit.toggleNoteEffect(sc, c, 'vibrato', s))
          break
        case 'b':
        case 'B':
          apply((sc) => void edit.toggleNoteEffect(sc, c, 'bend', s))
          break
        case 'x':
        case 'X':
          apply((sc) => void edit.toggleNoteEffect(sc, c, 'dead', s))
          break
        case 'l':
        case 'L':
          apply((sc) => void edit.toggleNoteEffect(sc, c, 'letRing', s))
          break
        case 't':
        case 'T':
          apply((sc) => void edit.toggleNoteEffect(sc, c, 'tie', s))
          break
        case 'Home':
          setCursor({ ...c, beat: 0 })
          break
        case 'Escape':
          if (anchor) setAnchor(null)
          else setEditing(false)
          break
        default:
          handled = false
      }
    }
    if (handled) e.preventDefault()
  }

  // ── Loops from bars ───────────────────────────────────────────────────
  /** Playback time (s) of the first occurrence of bar `index`'s start and end. */
  const barTimes = (index: number): { start: number; end: number } | null => {
    const api = apiRef.current
    const score = scoreRef.current
    const lookups = api?.tickCache?.masterBars
    if (!api || !score || !lookups) return null
    let ms = 0
    let tempo = score.tempo || 120
    for (const lk of lookups) {
      const t = lk.masterBar.tempoAutomations[0]
      if (t) tempo = t.value
      const dur = ((lk.end - lk.start) * 60_000) / (tempo * 960)
      if (lk.masterBar.index === index) return { start: ms / 1000, end: (ms + dur) / 1000 }
      ms += dur
    }
    return null
  }

  /** Every bar in playback order (repeats included) with its score-time span. */
  function playbackBars(): { start: number; end: number }[] {
    const score = scoreRef.current
    const lookups = apiRef.current?.tickCache?.masterBars
    if (!score || !lookups) return []
    const out: { start: number; end: number }[] = []
    let ms = 0
    let tempo = score.tempo || 120
    for (const lk of lookups) {
      const t = lk.masterBar.tempoAutomations[0]
      if (t) tempo = t.value
      const dur = ((lk.end - lk.start) * 60_000) / (tempo * 960)
      out.push({ start: ms / 1000, end: (ms + dur) / 1000 })
      ms += dur
    }
    return out
  }

  /** The bar (first playthrough) that playback at `sec` is in. */
  const barAtTime = (sec: number): number => {
    const api = apiRef.current
    const sc = scoreRef.current
    const lookups = api?.tickCache?.masterBars
    if (!sc || !lookups) return 0
    let ms = 0
    let tempo = sc.tempo || 120
    for (const lk of lookups) {
      const t = lk.masterBar.tempoAutomations[0]
      if (t) tempo = t.value
      const dur = ((lk.end - lk.start) * 60_000) / (tempo * 960)
      if (sec * 1000 < ms + dur) return lk.masterBar.index
      ms += dur
    }
    return Math.max(0, sc.masterBars.length - 1)
  }

  // Count-in follows the score: tempo and beats of the bar playback starts in.
  const hintBar = loaded?.itemId === item.id ? barAtTime(fromPlayer(position)) : cursor.bar
  useEffect(() => {
    if (!score) return
    const mb = score.masterBars[Math.min(hintBar, score.masterBars.length - 1)]
    if (!mb) return
    const next = { bpm: edit.tempoAt(score, hintBar), beatsPerBar: mb.timeSignatureNumerator }
    const cur = useMediaStore.getState().tempoHint
    if (!cur || cur.bpm !== next.bpm || cur.beatsPerBar !== next.beatsPerBar)
      useMediaStore.setState({ tempoHint: next })
  }, [score, hintBar, revision])
  useEffect(() => () => useMediaStore.setState({ tempoHint: null }), [])

  const loopBars = (from: number, to: number) => {
    const a = barTimes(Math.min(from, to))
    const b = barTimes(Math.max(from, to))
    if (!a || !b) return
    useMediaStore.getState().setLoop(toPlayer(a.start), toPlayer(b.end), true)
    return prepare().then(async (ok) => {
      if (ok) await useMediaStore.getState().seek(toPlayer(a.start))
      return ok
    })
  }

  // ── Section practice routine ──────────────────────────────────────────
  const [routine, setRoutine] = useState<{
    idx: number
    sections: RoutineSection[]
    start: number
    target: number
  } | null>(null)
  const [routineDone, setRoutineDone] = useState(false)
  const passCount = useMediaStore((st) => st.passCount)

  const playSection = (sec: RoutineSection) => {
    void loopBars(sec.from, sec.to)?.then(async (ok) => {
      if (ok && !useMediaStore.getState().playing) await useMediaStore.getState().play()
    })
  }

  const startRoutine = (start: number, target: number) => {
    const sc = scoreRef.current
    if (!sc) return
    const sections = routineSections(sc)
    const st = useMediaStore.getState()
    st.setTrainer({ enabled: true, clean: true, step: 0.05, every: 1, target })
    st.setSpeed(start)
    setWaitOn(false)
    setListenOn(true)
    setRoutineDone(false)
    setRoutine({ idx: 0, sections, start, target })
    playSection(sections[0]!)
  }

  const stopRoutine = () => {
    setRoutine(null)
    void useMediaStore.getState().pause()
  }

  // Each scored pass: move to the next section once this one is clean at the target speed.
  useEffect(() => {
    if (!routine) return
    const st = useMediaStore.getState()
    if (st.lastPass === null || !sectionDone(st.lastPass, st.lastPassSpeed, routine.target)) return
    const idx = routine.idx + 1
    if (idx >= routine.sections.length) {
      setRoutine(null)
      setRoutineDone(true)
      st.setLoop(null, null, false)
      void st.pause()
      return
    }
    st.setSpeed(routine.start)
    setRoutine({ ...routine, idx })
    playSection(routine.sections[idx]!)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passCount])

  // ── Export ────────────────────────────────────────────────────────────
  const download = (bytes: Uint8Array | string, ext: string, type: string) => {
    const blob = new Blob([bytes as BlobPart], { type })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${item.name}.${ext}`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  const exportAs = (kind: 'gp' | 'atex' | 'mid' | 'print') => {
    const api = apiRef.current
    const score = scoreRef.current
    if (!api || !score) return
    if (kind === 'gp')
      download(
        new exporter.Gp7Exporter().export(score, api.settings),
        'gp',
        'application/octet-stream',
      )
    if (kind === 'atex')
      download(
        new exporter.AlphaTexExporter().exportToString(score, api.settings),
        'atex',
        'text/plain',
      )
    if (kind === 'mid') {
      const file = new midi.MidiFile()
      const gen = new midi.MidiFileGenerator(
        score,
        api.settings,
        // SMF1: Midi 2.0 per-note bends (bends/trills) can't be written to a .mid file.
        new midi.AlphaSynthMidiFileHandler(file, true),
      )
      gen.generate()
      download(file.toBinary(), 'mid', 'audio/midi')
    }
    if (kind === 'print') api.print()
  }

  const openTex = () => {
    const api = apiRef.current
    const score = scoreRef.current
    if (!api || !score) return
    setTexText(new exporter.AlphaTexExporter().exportToString(score, api.settings))
    setTexError(null)
    setTexOpen(true)
  }

  const applyTex = () => {
    const api = apiRef.current
    const score = scoreRef.current
    if (!api || !score) return
    try {
      const imp = new importer.AlphaTexImporter()
      imp.initFromString(texText, api.settings)
      const next = imp.readScore()
      undoRef.current.push(snapshot(score))
      redoRef.current = []
      scoreRef.current = next
      setScore(next)
      bumpRevision()
      syncHistory()
      api.renderScore(next, [Math.min(trackIndex, next.tracks.length - 1)])
      setTexError(null)
      scheduleSave()
    } catch (err) {
      setTexError(describeError(err))
    }
  }

  // Full screen hands the whole display to the sheet (Esc or the button exits).
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === wsRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void wsRef.current?.requestFullscreen?.().catch(() => {})
  }

  // ── Track list (sidebar) ──────────────────────────────────────────────
  /** Re-index per-track UI state after the track list changes. */
  const remapTracks = (map: (i: number) => number | null, nextActive: number) => {
    const remap = (set: Set<number>) =>
      new Set([...set].map(map).filter((i): i is number => i !== null))
    setMuted((m) => remap(m))
    setSolo((m) => remap(m))
    setShown((m) => {
      const next = remap(m)
      next.add(nextActive)
      return next
    })
    setTrackIndex(nextActive)
  }

  const selectTrack = (i: number) => {
    setShown((m) => (m.has(i) ? m : new Set([...m, i])))
    setTrackIndex(i)
  }

  const toggleShown = (i: number) => {
    setShown((m) => {
      const next = new Set(m)
      if (next.has(i)) {
        if (next.size === 1) return m // always show at least one track
        next.delete(i)
        if (i === trackIndex) setTrackIndex(Math.min(...next))
      } else next.add(i)
      return next
    })
  }

  const moveTrackTo = (from: number, to: number) => {
    apply((sc, st) => ops.moveTrack(sc, from, to, st))
    const map = (i: number) =>
      i === from
        ? to
        : from < to && i > from && i <= to
          ? i - 1
          : from > to && i >= to && i < from
            ? i + 1
            : i
    remapTracks(map, map(trackIndex))
  }

  const duplicateTrackAt = (i: number) => {
    let at = i + 1
    apply((sc, st) => {
      at = ops.duplicateTrack(sc, i, st)
    })
    remapTracks((x) => (x > i ? x + 1 : x), at)
  }

  const removeTrackAt = (i: number) => {
    apply((sc, st) => ops.removeTrack(sc, i, st))
    const next =
      trackIndex > i ? trackIndex - 1 : trackIndex === i ? Math.max(0, i - 1) : trackIndex
    remapTracks((x) => (x === i ? null : x > i ? x - 1 : x), next)
  }

  const addTrackFrom = (preset: ops.InstrumentPreset) => {
    let at = 0
    apply((sc, st) => {
      at = ops.addTrack(sc, preset, preset.label, st)
    })
    remapTracks((x) => x, at)
  }

  // ── Song tone (rig scene + slot per section) ──────────────────────────
  const toneSections = useMemo<ToneSection[]>(() => {
    const out: ToneSection[] = [{ key: START_KEY, label: 'Start', at: 0 }]
    score?.masterBars.forEach((mb, i) => {
      if (mb.section && i > 0)
        out.push({
          key: `bar:${i}`,
          label: `${mb.section.marker ? `${mb.section.marker} ` : ''}${mb.section.text || `Bar ${i + 1}`}`,
          at: i,
        })
    })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score, revision])
  // Look a little ahead so the preset is in place on the section's downbeat.
  const speedNow = useMediaStore((st) => st.practice.speed)
  const toneBar =
    loaded?.itemId === item.id ? barAtTime(fromPlayer(position) + 0.15 * speedNow) : cursor.bar
  useToneFollower(liveItem.tone, toneSections, toneBar, playing && loaded?.itemId === item.id)

  // Practice view: only the current system and the next one are shown; the
  // rest of the sheet is veiled and the view turns the page a system at a time.
  const readingBar = loaded?.itemId === item.id ? barAtTime(fromPlayer(position)) : cursor.bar
  const [readingWindow, setReadingWindow] = useState<{
    first: number
    top: number
    bottom: number
  } | null>(null)
  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    api.settings.player.scrollMode = reading ? ScrollMode.Off : ScrollMode.Continuous
    api.updateSettings()
  }, [reading])
  useEffect(() => {
    const lookup = apiRef.current?.boundsLookup
    if (!reading || horizontal || !lookup) {
      setReadingWindow(null)
      return
    }
    const sys = lookup.findMasterBarByIndex(readingBar)?.staffSystemBounds
    if (!sys) return
    const i = lookup.staffSystems.indexOf(sys)
    const next = lookup.staffSystems[i + 1]
    const top = sys.realBounds.y
    const bottom = (next ?? sys).realBounds.y + (next ?? sys).realBounds.h
    // The veil never covers the header or the first system: alphaTab's
    // attribution is drawn in that band and must stay visible.
    const head = lookup.staffSystems[0]!.realBounds
    const first = head.y + head.h + 8
    setReadingWindow((w) =>
      w && w.top === top && w.bottom === bottom ? w : { first, top, bottom },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reading, horizontal, readingBar, tick, viewZoom, profile, shown])
  useEffect(() => {
    if (readingWindow)
      viewportRef.current?.scrollTo({
        top: Math.max(0, readingWindow.top - 16),
        behavior: 'smooth',
      })
  }, [readingWindow])

  // ── Recording sync ────────────────────────────────────────────────────
  const recordings = useMediaStore((st) => st.items).filter((i) => i.kind === 'audio')
  const saveSync = (next: typeof sync) =>
    void useMediaStore.getState().updateItem(item.id, { sync: next })

  const pairRecording = (audioId: string | null) => {
    void useMediaStore.getState().pause()
    saveSync(audioId ? { audioId, points: sync?.audioId === audioId ? sync.points : [] } : null)
    setSource(audioId ? 'recording' : 'synth')
    setTapBar(cursor.bar)
  }

  const tapSync = async () => {
    const st = useMediaStore.getState()
    if (!sync || !useRec || !st.transport || st.loadState !== 'ready') return
    const bar = barTimes(tapBar)
    if (!bar) return
    // Ask the player now rather than using the last poll (up to 50 ms old).
    const status = await st.transport.status()
    const audio = status.position / (status.sampleRate || 48_000)
    const points = upsertPoint(sync.points, bar.start, audio)
    if (points === sync.points) {
      setError(
        "That tap is earlier than a later bar's sync point - clear or re-tap from the start.",
      )
      return
    }
    saveSync({ ...sync, points })
    setTapBar((b) => Math.min(b + 1, (scoreRef.current?.masterBars.length ?? 1) - 1))
  }

  // ── Remembered workspace ──────────────────────────────────────────────
  // How the tab was left (view, tracks, panels, sound) and where playback was.
  useEffect(() => {
    const timer = setTimeout(() => {
      const view = {
        zoom,
        profile,
        horizontal,
        trackIndex,
        shown: [...shown],
        sidebarOpen,
        fretboard: fretOpen,
        tabRhythm,
        source,
        guide,
      }
      const prev = liveItemRef.current.view
      if (JSON.stringify(prev) !== JSON.stringify(view))
        void useMediaStore.getState().updateItem(item.id, { view })
    }, 800)
    return () => clearTimeout(timer)
  }, [
    zoom,
    profile,
    horizontal,
    trackIndex,
    shown,
    sidebarOpen,
    source,
    guide,
    fretOpen,
    tabRhythm,
    item.id,
  ])

  const saveResume = () => {
    const at = Math.round(lastScorePos.current * 10) / 10
    if (at !== (liveItemRef.current.resume ?? 0))
      void useMediaStore.getState().updateItem(item.id, { resume: at })
  }
  const wasPlaying = useRef(false)
  useEffect(() => {
    if (wasPlaying.current && !playing && loaded?.itemId === item.id) saveResume()
    wasPlaying.current = playing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => saveResume(), [])

  // On first render, put the cursors where the song was left.
  const resumedRef = useRef(false)
  useEffect(() => {
    if (resumedRef.current || status !== 'ready' || !score) return
    resumedRef.current = true
    const at = item.resume ?? 0
    if (at <= 0) return
    const bar = barAtTime(at)
    setCursor((c) => edit.clampCursor(score, { ...c, bar, beat: 0 }))
    const output = apiRef.current?.player?.output as synth.IExternalMediaSynthOutput | undefined
    output?.updatePosition(at * 1000)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, score])

  // ── Render ────────────────────────────────────────────────────────────
  const beat = score ? edit.beatAt(score, cursor) : null
  const fill = score ? edit.barFill(score, cursor) : { used: 0, capacity: 0 }
  const current = tracks[trackIndex]
  const staffTunings = score?.tracks[cursor.track]?.staves[cursor.staff]?.stringTuning.tunings ?? []
  fretTrackRef.current = cursor.track
  // The beat playing now, from alphaTab's tick position (it follows our player).
  useEffect(() => {
    const api = apiRef.current
    const found =
      fretOpen && playing && api
        ? api.tickCache?.findBeat(new Set([fretTrackRef.current]), api.tickPosition)
        : null
    const next = beatPositions(found?.beat ?? null)
    setPlayingNotes((prev) =>
      prev.length === next.length &&
      prev.every((p, i) => p.string === next[i]!.string && p.fret === next[i]!.fret)
        ? prev
        : next,
    )
  }, [fretOpen, playing, position])
  const fretCapo = score?.tracks[cursor.track]?.staves[cursor.staff]?.capo ?? 0
  const cursorNotes = score ? beatPositions(edit.beatAt(score, cursor)) : []
  /** Fretboard click: add the note to the cursor's beat, or remove it if it's there. */
  const enterFret = (pos: FretPos) => {
    const c = { ...cursor, string: pos.string }
    const there = cursorNotes.some((n) => n.string === pos.string && n.fret === pos.fret)
    apply((sc, st) => {
      if (there) edit.deleteNote(sc, c, st)
      else edit.setFret(sc, c, pos.fret, st)
      return c
    })
    setEditing(true)
  }
  // ── Step entry (MIDI / guitar) ──
  const applyRef = useRef(apply)
  applyRef.current = apply
  const handFretRef = useRef<number | null>(null)
  const advanceRef = useRef(stepAdvance)
  advanceRef.current = stepAdvance
  /** Write a played note or chord at the cursor (replacing the beat's notes), then move on. */
  const writePlayed = useCallback((pitches: number[]) => {
    applyRef.current((sc, st) => {
      const c = cursorRef.current
      const staff = sc.tracks[c.track]?.staves[c.staff]
      if (!staff || staff.isPercussion) return
      const placed = placeChord(
        staff.stringTuning.tunings,
        pitches,
        c.string,
        24,
        handFretRef.current,
      )
      if (!placed.length) return
      // Where the hand is now: the chord's highest fret, or the note's fret.
      handFretRef.current = Math.max(...placed.map((p) => p.fret))
      const beat = edit.beatAt(sc, c)
      for (const n of [...(beat?.notes ?? [])]) edit.deleteNote(sc, { ...c, string: n.string }, st)
      for (const p of placed) edit.setFret(sc, { ...c, string: p.string }, p.fret, st)
      const at = { ...c, string: placed[placed.length - 1]!.string }
      return advanceRef.current ? edit.moveRight(sc, at, st) : at
    })
    setEditing(true)
  }, [])
  const chooseStepInput = (mode: StepInput) => {
    if (mode === 'midi' && useMidiStore.getState().permission !== 'granted')
      void requestMidiAccess()
    if (mode === 'guitar' && !useMediaStore.getState().inputAnalyser) {
      setError('Guitar step entry listens to your input: power on with an input device first.')
      return
    }
    setStepInput(mode)
  }
  useEffect(() => {
    if (stepInput !== 'midi' || !fretOpen) return
    const chords = new ChordCollector()
    const off = onMidiNote((note) => {
      chords.add(note, performance.now())
      return true
    })
    const timer = setInterval(() => {
      const chord = chords.poll(performance.now())
      if (chord) writePlayed(chord)
    }, 20)
    return () => {
      off()
      clearInterval(timer)
    }
  }, [stepInput, fretOpen, writePlayed])
  useEffect(() => {
    if (stepInput !== 'guitar' || !fretOpen) return
    const analyser = useMediaStore.getState().inputAnalyser
    if (!analyser) return
    const detector = new StepDetector()
    const buffer = new Float32Array(analyser.fftSize) as Float32Array<ArrayBuffer>
    const timer = setInterval(() => {
      if (useMediaStore.getState().playing) return
      analyser.getFloatTimeDomainData(buffer)
      const pitch = detectPitch(buffer, analyser.context.sampleRate)
      const note = pitch && pitch.clarity > 0.9 ? midiFromFrequency(pitch.frequency) : null
      const played = detector.feed(note, performance.now())
      if (played !== null) writePlayed([played])
    }, 30)
    return () => clearInterval(timer)
  }, [stepInput, fretOpen, writePlayed])

  const enterPitch = (pitch: number) => {
    const tunings = staffTunings
    const existing = cursorNotes.find((n) => tunings.length && pitchOf(tunings, n) === pitch)
    if (existing) return enterFret(existing)
    const pos = placePitch(
      tunings,
      pitch,
      cursor.string,
      24,
      cursorNotes.map((n) => n.string),
    )
    if (pos) enterFret(pos)
  }
  const stringName =
    staffTunings.length && !current?.percussion
      ? model.Tuning.getTextForTuning(staffTunings[staffTunings.length - cursor.string] ?? 0, false)
      : ''

  const toggleIn = (set: Set<number>, i: number) => {
    const next = new Set(set)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    return next
  }

  const practice = useMediaStore((st) => st.practice)
  const countInBars = practice.countInBars
  const loopOn = practice.loopEnabled && practice.loopStart !== null
  const ms = useMediaStore.getState()

  return (
    <div
      ref={wsRef}
      className={`${tabStyles.ws} ${fullscreen ? tabStyles.wsFull : ''} ${reading ? tabStyles.wsReading : ''}`}
    >
      {/* ── Top bar ── */}
      <header className={tabStyles.topbar} hidden={reading}>
        <div
          className={tabStyles.songTitle}
          title={`${title.title || item.name}${title.artist ? ` — ${title.artist}` : ''}`}
        >
          <strong>{title.title || item.name}</strong>
          {(title.artist || item.artist) && <span>{title.artist || item.artist}</span>}
          {savedAt && <i className={tabStyles.savedDot} title="All changes saved" />}
        </div>

        <div className={tabStyles.barGroup}>
          <Tool
            icon={I.TracksIcon}
            title={sidebarOpen ? 'Hide the track panel' : 'Show the track panel'}
            on={sidebarOpen}
            onClick={() => setSidebarOpen((v) => !v)}
          />
          <span className={tabStyles.activeTrack} title="Track being edited">
            {tracks[trackIndex]?.name ?? ''}
            {shown.size > 1 && <em> +{shown.size - 1}</em>}
          </span>
        </div>

        <div className={tabStyles.barGroup} role="group" aria-label="View">
          {(
            [
              ['tab', 'Tab only'],
              ['both', 'Standard notation + tab'],
              ['score', 'Standard notation only'],
            ] as const
          ).map(([id, label]) => (
            <Tool
              key={id}
              icon={id === 'tab' ? I.TabIcon : I.NotationIcon}
              title={label}
              on={profile === id}
              onClick={() => setProfile(id)}
              tag={id === 'both' ? '+T' : undefined}
            />
          ))}
          <Tool
            icon={I.ZoomOutIcon}
            title="Zoom out"
            onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))}
          />
          <button
            type="button"
            className={tabStyles.zoomValue}
            onClick={() => setZoom(1)}
            title="Reset zoom"
          >
            {Math.round(zoom * 100)}%
          </button>
          <Tool
            icon={I.ZoomInIcon}
            title="Zoom in"
            onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2)))}
          />
          <Tool
            icon={I.QuarterNoteIcon}
            title={`Rhythm on the tab staff: ${tabRhythm === 'auto' ? 'automatic (when there is no notation)' : tabRhythm === 'on' ? 'always' : 'hidden'} — click to change`}
            on={tabRhythm === 'on'}
            tag={tabRhythm === 'auto' ? 'A' : tabRhythm === 'off' ? '✕' : undefined}
            onClick={() => setTabRhythm((r) => (r === 'auto' ? 'on' : r === 'on' ? 'off' : 'auto'))}
          />
          <Tool
            icon={I.ChordIcon}
            title="Chord diagrams in a strip at the top of the sheet"
            on={score?.stylesheet.globalDisplayChordDiagramsOnTop ?? false}
            onClick={() =>
              apply((sc, st) =>
                ops.setChordStrip(sc, !sc.stylesheet.globalDisplayChordDiagramsOnTop, st),
              )
            }
          />
          <Tool
            icon={horizontal ? I.HorizontalLayoutIcon : I.PageLayoutIcon}
            title={horizontal ? 'Switch to page layout' : 'Switch to one horizontal line'}
            on={horizontal}
            onClick={() => setHorizontal((h) => !h)}
          />
        </div>

        <div className={tabStyles.barGroup}>
          <Tool
            icon={I.ReadingIcon}
            title="Practice view: just the music, bigger (Esc to leave)"
            onClick={() => {
              setEditing(false)
              setReading(true)
              setTimeout(() => viewportRef.current?.focus(), 0)
            }}
          />
          <HardwareButton
            size="small"
            label={editing ? 'Editing' : 'Edit'}
            title="Edit mode (Esc to leave)"
            icon={<I.EditIcon size={14} />}
            active={editing}
            onClick={() => {
              setEditing((v) => !v)
              if (!editing && !toolGroup) setToolGroup('note')
              setTimeout(() => viewportRef.current?.focus(), 0)
            }}
          />
          <details className={tabStyles.menu}>
            <summary title="Export" aria-label="Export">
              <I.DownloadIcon size={18} />
            </summary>
            <div
              className={tabStyles.menuList}
              onClick={(e) =>
                (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute('open')
              }
            >
              <button type="button" onClick={() => exportAs('gp')}>
                <I.DownloadIcon size={14} /> Guitar Pro (.gp)
              </button>
              <button type="button" onClick={() => exportAs('atex')}>
                <I.DownloadIcon size={14} /> AlphaTex (.atex)
              </button>
              <button type="button" onClick={() => exportAs('mid')}>
                <I.DownloadIcon size={14} /> MIDI (.mid)
              </button>
              <button type="button" onClick={() => exportAs('print')}>
                <I.PageLayoutIcon size={14} /> Print / PDF
              </button>
              <button type="button" onClick={openTex}>
                <I.CodeIcon size={14} /> Edit as AlphaTex…
              </button>
            </div>
          </details>
          <Tool
            icon={I.TuningIcon}
            title={
              fretOpen ? 'Hide the fretboard / piano' : 'Fretboard / piano: click to enter notes'
            }
            on={fretOpen}
            onClick={() => setFretOpen((v) => !v)}
          />
          <Tool
            icon={I.KeyboardIcon}
            title="Keyboard shortcuts (?)"
            on={helpOpen}
            onClick={() => setHelpOpen((v) => !v)}
          />
          <Tool
            icon={fullscreen ? I.ZoomOutIcon : I.ZoomInIcon}
            title={fullscreen ? 'Exit full screen' : 'Full screen'}
            on={fullscreen}
            onClick={toggleFullscreen}
            tag={fullscreen ? '⤡' : '⤢'}
          />
        </div>
      </header>

      {error && <div className={`${styles.errorNotice} ${tabStyles.pre}`}>{error}</div>}

      {/* ── Body: toolbox rail · sheet · drawer ── */}
      <div className={tabStyles.body}>
        {editing && !reading && score && (
          <TabToolbox
            score={score}
            cursor={cursor}
            apply={apply}
            group={toolGroup}
            onGroup={setToolGroup}
            selectionSize={selection.length}
            hasClip={hasClip}
            canUndo={history.undo > 0}
            canRedo={history.redo > 0}
            onUndo={undo}
            onRedo={redo}
            onCopy={copySelection}
            onPaste={pasteClipboard}
            onLoopSelection={loopSelection}
            targets={targets}
            onShiftSelection={(n) => setAnchor((an) => (an ? { ...an, bar: an.bar + n } : an))}
            barNote={barNotes[cursor.bar] ?? ''}
            onBarNote={(text) => setBarNote(cursor.bar, text)}
            onVoice={(v) => setCursor((c) => edit.clampCursor(score, { ...c, voice: v, beat: 0 }))}
          />
        )}

        <div className={tabStyles.main}>
          <div
            ref={viewportRef}
            className={`${tabStyles.viewport} ${editing ? tabStyles.editing : ''}`}
            tabIndex={0}
            onKeyDown={onKeyDown}
            data-tab-editor={editing ? '' : undefined}
            aria-label={editing ? 'Tab editor: digits enter frets, arrows move' : 'Tab'}
          >
            {status === 'loading' && !error && <div className={tabStyles.sheetMsg}>Rendering…</div>}
            <div className={tabStyles.sheet}>
              <div ref={hostRef} className={tabStyles.host} />
              {readingWindow && (
                <>
                  <div
                    className={tabStyles.readingVeil}
                    style={{
                      top: readingWindow.first,
                      height: Math.max(0, readingWindow.top - 8 - readingWindow.first),
                    }}
                  />
                  <div
                    className={tabStyles.readingVeil}
                    style={{ top: readingWindow.bottom + 8, bottom: 0 }}
                  />
                </>
              )}
              {notePins.map((n) => (
                <button
                  key={n.bar}
                  type="button"
                  className={tabStyles.notePin}
                  style={{ left: n.x, top: n.y }}
                  title={`Bar ${n.bar + 1}: ${n.text}`}
                  aria-label={`Practice note on bar ${n.bar + 1}: ${n.text}`}
                  onClick={() =>
                    setCursor((c) => edit.clampCursor(score!, { ...c, bar: n.bar, beat: 0 }))
                  }
                >
                  <I.EditIcon size={11} />
                </button>
              ))}
              {heatBoxes.map((b, i) => (
                <div
                  key={i}
                  className={`${tabStyles.heat} ${b.acc >= 0.9 ? tabStyles.heatGood : b.acc >= 0.7 ? tabStyles.heatOk : tabStyles.heatBad}`}
                  style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
                  title={`${Math.round(b.acc * 100)}% in recent runs`}
                />
              ))}
              {box && (
                <>
                  <div
                    className={tabStyles.beatBox}
                    style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
                  />
                  {!current?.percussion && (
                    <div
                      className={tabStyles.stringMark}
                      style={{ left: box.x, top: box.stringY - 7, width: box.w }}
                    />
                  )}
                </>
              )}
            </div>
          </div>

          {editing && score && current?.percussion && (
            <details className={tabStyles.drawerBottom} open>
              <summary>Drum lane — bar {cursor.bar + 1}</summary>
              <DrumLane score={score} cursor={cursor} apply={apply} onCursor={setCursor} />
            </details>
          )}

          <div className={tabStyles.status} aria-live="polite">
            {score && (
              <>
                <span>
                  Bar {cursor.bar + 1}/{score.masterBars.length}
                </span>
                <span>Beat {cursor.beat + 1}</span>
                {stringName && (
                  <span>
                    String {staffTunings.length - cursor.string + 1} ({stringName})
                  </span>
                )}
                {beat && (
                  <span>
                    {edit.DURATION_LABEL[beat.duration]}
                    {beat.dots ? '.' : ''}
                  </span>
                )}
                <span>Voice {cursor.voice + 1}</span>
                {barNotes[readingBar] && (
                  <span className={tabStyles.statusNote} title="Your practice note on this bar">
                    <I.EditIcon size={11} /> {barNotes[readingBar]}
                  </span>
                )}
                {routine && (
                  <span className={tabStyles.waitStatus}>
                    Routine: {routine.sections[routine.idx]!.label} ({routine.idx + 1}/
                    {routine.sections.length}) · {Math.round(speedNow * 100)}% →{' '}
                    {Math.round(routine.target * 100)}%
                  </span>
                )}
                {waitOn && (
                  <span
                    className={`${tabStyles.waitStatus} ${waitInfo.hit ? tabStyles.waitHit : ''}`}
                  >
                    {waitInfo.done
                      ? `Done — ${waitInfo.hits} notes`
                      : `Play ${waitInfo.label} · ${waitInfo.hits} ✓`}
                  </span>
                )}
                {selection.length > 1 && (
                  <span className={tabStyles.statusAccent}>{selection.length} beats selected</span>
                )}
                {fill.capacity > 0 && fill.used !== fill.capacity && (
                  <span className={tabStyles.over}>
                    {fill.used > fill.capacity ? 'bar too long' : 'bar incomplete'}
                  </span>
                )}
                {stale && !playing && renderProgress === null && (
                  <span>edited — play to hear changes</span>
                )}
              </>
            )}
          </div>
        </div>

        {sidebarOpen && !reading && score && (
          <TrackSidebar
            score={score}
            trackIndex={trackIndex}
            shown={shown}
            muted={muted}
            solo={solo}
            apply={apply}
            onSelect={selectTrack}
            onToggleShown={toggleShown}
            onMute={(i) => setMuted((m) => toggleIn(m, i))}
            onSolo={(i) => setSolo((m) => toggleIn(m, i))}
            onMove={moveTrackTo}
            onDuplicate={duplicateTrackAt}
            onRemove={removeTrackAt}
            onAdd={addTrackFrom}
            onClose={() => setSidebarOpen(false)}
            extra={
              <>
                <details className={tabStyles.sideSection} open={liveItem.tone?.scene != null}>
                  <summary>
                    <I.TracksIcon size={14} /> Tone
                  </summary>
                  <ToneLink
                    tone={liveItem.tone ?? null}
                    sections={toneSections}
                    onChange={(tone) => void useMediaStore.getState().updateItem(item.id, { tone })}
                  />
                </details>
                <PracticePanel
                  runs={liveItem.runs ?? []}
                  heatOn={heatOn}
                  onHeat={setHeatOn}
                  onLoopBars={(a, b) => loopBars(a, b)}
                  routine={
                    routine
                      ? `${routine.sections[routine.idx]!.label} (${routine.idx + 1}/${routine.sections.length})`
                      : null
                  }
                  routineDone={routineDone}
                  onStartRoutine={startRoutine}
                  onStopRoutine={stopRoutine}
                  onClear={() => void useMediaStore.getState().updateItem(item.id, { runs: [] })}
                />
                <RecordingPanel
                  recordings={recordings}
                  sync={sync}
                  source={source}
                  tapBar={tapBar}
                  barCount={score.masterBars.length}
                  barOf={barAtTime}
                  onPair={pairRecording}
                  onSource={(s) => {
                    void useMediaStore.getState().pause()
                    setSource(s)
                  }}
                  onTapBar={setTapBar}
                  guide={guide}
                  guideTrack={tracks[trackIndex]?.name ?? `Track ${trackIndex + 1}`}
                  onGuide={(v) => {
                    void useMediaStore.getState().pause()
                    setGuide(v)
                  }}
                  onTap={() => void tapSync()}
                  onRemovePoint={(i) =>
                    sync && saveSync({ ...sync, points: sync.points.filter((_, j) => j !== i) })
                  }
                  onClear={() => sync && saveSync({ ...sync, points: [] })}
                  onNudge={(d) =>
                    sync &&
                    saveSync({
                      ...sync,
                      points: sync.points.map((pt) => ({
                        ...pt,
                        audio: Math.max(0, pt.audio + d),
                      })),
                    })
                  }
                />
              </>
            }
          />
        )}
      </div>

      {/* ── Fretboard / piano input ── */}
      {fretOpen && !reading && score && !current?.percussion && staffTunings.length > 0 && (
        <FretboardPanel
          tunings={staffTunings}
          capo={fretCapo}
          cursorString={cursor.string}
          cursorNotes={cursorNotes}
          playingNotes={playingNotes}
          onFret={enterFret}
          onPitch={enterPitch}
          stepInput={stepInput}
          onStepInput={chooseStepInput}
          stepAdvance={stepAdvance}
          onStepAdvance={setStepAdvance}
        />
      )}

      {/* ── Transport ── */}
      <footer className={tabStyles.footer}>
        <TransportButtons compact />
        <div className={tabStyles.barGroup}>
          <Tool
            icon={I.LoopIcon}
            title={loopOn ? 'Loop on (L)' : 'Loop off (L)'}
            on={loopOn}
            onClick={() => ms.toggleLoop()}
          />
          <Tool
            icon={I.LoopIcon}
            title={`Loop bar ${cursor.bar + 1}`}
            onClick={() => loopBars(cursor.bar, cursor.bar)}
            tag="1"
          />
          <Tool
            icon={I.LoopIcon}
            title="Loop 4 bars from the cursor"
            onClick={() => loopBars(cursor.bar, cursor.bar + 3)}
            tag="4"
          />
          {selection.length > 1 && (
            <Tool icon={I.LoopIcon} title="Loop the selection" onClick={loopSelection} tag="sel" />
          )}
        </div>
        <div className={tabStyles.barGroup} title="Speed (pitch preserved)">
          <Tool
            icon={I.MinusIcon}
            title="Slower (−5%)"
            onClick={() => ms.setSpeed(practice.speed - 0.05)}
          />
          <button
            type="button"
            className={tabStyles.zoomValue}
            onClick={() => ms.setSpeed(1)}
            title="Speed — click to reset to 100%"
          >
            {Math.round(practice.speed * 100)}%
          </button>
          <Tool
            icon={I.PlusIcon}
            title="Faster (+5%)"
            onClick={() => ms.setSpeed(practice.speed + 0.05)}
          />
        </div>
        <div className={tabStyles.barGroup} title="Transpose playback">
          <Tool
            icon={I.FlatIcon}
            title="Playback down a semitone"
            onClick={() => ms.setSemitones(practice.semitones - 1)}
          />
          <button
            type="button"
            className={tabStyles.zoomValue}
            onClick={() => ms.setSemitones(0)}
            title="Transpose — click to reset"
          >
            {practice.semitones > 0 ? '+' : ''}
            {practice.semitones} st
          </button>
          <Tool
            icon={I.SharpIcon}
            title="Playback up a semitone"
            onClick={() => ms.setSemitones(practice.semitones + 1)}
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
        <Tool
          icon={I.EarIcon}
          title={
            listenOn
              ? 'Listen on: your playing is scored while the song plays (click to stop)'
              : 'Listen: score your playing against the tab while the song plays'
          }
          tag={listenOn ? 'listen' : undefined}
          on={listenOn}
          onClick={() => {
            if (!listenOn) setWaitOn(false)
            setListenOn((v) => !v)
          }}
        />
        <Tool
          icon={I.WaitIcon}
          title={
            waitOn
              ? 'Wait mode on: the tab waits for you to play each note (click to stop)'
              : 'Wait mode: the tab waits until you play each note on your guitar'
          }
          tag={waitOn ? 'wait' : undefined}
          on={waitOn}
          onClick={() => {
            if (!waitOn) {
              void useMediaStore.getState().pause()
              setListenOn(false)
            }
            setWaitOn((v) => !v)
          }}
        />
        <Tool
          icon={I.MetronomeIcon}
          title="Metronome in playback"
          on={metronome}
          onClick={() => setMetronome((m) => !m)}
        />
        {renderProgress !== null && (
          <span className={tabStyles.footerNote}>
            Rendering audio… {Math.round(renderProgress * 100)}%
          </span>
        )}
        <span className={tabStyles.footerSpacer} />
        {reading && (
          <HardwareButton
            size="small"
            label="Exit practice view"
            title="Back to the full workspace (Esc)"
            icon={<I.ReadingIcon size={14} />}
            active
            onClick={() => setReading(false)}
          />
        )}
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

      {helpOpen && <Shortcuts onClose={() => setHelpOpen(false)} />}

      {texOpen && (
        <div className={tabStyles.texPane}>
          <div className={tabStyles.texHead}>
            <I.CodeIcon size={16} />
            <strong>AlphaTex</strong>
            <span className={styles.dim}>Edit the score as text, then apply.</span>
            <span className={tabStyles.footerSpacer} />
            <button type="button" className={styles.primaryBtn} onClick={applyTex}>
              Apply
            </button>
            <button type="button" className={styles.chip} onClick={() => setTexOpen(false)}>
              Close
            </button>
          </div>
          {texError && <div className={`${styles.errorNotice} ${tabStyles.pre}`}>{texError}</div>}
          <textarea
            className={tabStyles.tex}
            value={texText}
            onChange={(e) => setTexText(e.target.value)}
            spellCheck={false}
          />
        </div>
      )}
    </div>
  )
}

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['0–9', 'Enter a fret (two quick digits for 10+)'],
  ['← →', 'Previous / next beat (adds beats/bars at the end)'],
  ['↑ ↓', 'Higher / lower string'],
  ['Ctrl/Cmd + ← →', 'Previous / next bar'],
  ['+  −', 'Longer / shorter note'],
  ['.', 'Dotted'],
  ['R', 'Rest'],
  ['Del', 'Delete note (Shift+Del: beat)'],
  ['I', 'Insert beat'],
  ['P  L  H  S  V  B  X  T', 'Palm mute · let ring · hammer · slide · vibrato · bend · dead · tie'],
  ['Shift + ← →', 'Extend selection'],
  ['Ctrl/Cmd + C X V A', 'Copy · cut · paste · select all'],
  ['Alt + ↑ ↓', 'Transpose selection'],
  ['Alt + Shift + ↑ ↓', 'Move selection across strings'],
  ['Ctrl/Cmd + Z / Shift+Z', 'Undo / redo'],
  ['Esc', 'Clear selection, then leave edit mode'],
  ['?', 'This help'],
]

function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <div className={tabStyles.help} role="dialog" aria-label="Keyboard shortcuts" onClick={onClose}>
      <div className={tabStyles.helpCard} onClick={(e) => e.stopPropagation()}>
        <div className={tabStyles.drawerHead}>
          <strong>
            <I.KeyboardIcon size={16} /> Keyboard shortcuts
          </strong>
          <Tool icon={I.MinusIcon} title="Close" onClick={onClose} />
        </div>
        <dl>
          {SHORTCUTS.map(([k, v]) => (
            <div key={k}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
