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
  type Settings,
  StaveProfile,
  type synth,
} from '@coderline/alphatab'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { formatTime } from '../decode'
import styles from '../MediaCenter.module.css'
import { loadMediaFile, saveMedia, saveMediaFile, type MediaItem } from '../mediaDb'
import { useMediaStore } from '../mediaStore'
import { PracticeControls, TransportButtons } from '../TransportBar'
import { renderScoreAudio } from './scoreAudio'
import * as edit from './scoreEdit'
import tabStyles from './TabWorkspace.module.css'

type Score = model.Score
type Profile = 'tab' | 'both' | 'score'

const PROFILE: Record<Profile, StaveProfile> = {
  tab: StaveProfile.Tab,
  both: StaveProfile.ScoreTab,
  score: StaveProfile.Score,
}

const UNDO_LIMIT = 100

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
  const [tracks, setTracks] = useState<{ name: string; strings: number }[]>([])
  const [trackIndex, setTrackIndex] = useState(0)
  const [muted, setMuted] = useState<Set<number>>(new Set())
  const [solo, setSolo] = useState<Set<number>>(new Set())
  const [profile, setProfile] = useState<Profile>('both')
  const [zoom, setZoom] = useState(1)
  const [horizontal, setHorizontal] = useState(false)
  const [metronome, setMetronome] = useState(false)
  const [editing, setEditing] = useState(false)
  const [cursor, setCursor] = useState<edit.EditCursor>(edit.startCursor())
  const [box, setBox] = useState<CursorBox | null>(null)
  const [, setTick] = useState(0) // re-render after in-place model edits
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
      setTracks(
        score.tracks.map((t) => ({
          name: t.name || `Track ${t.index + 1}`,
          strings: t.staves[0]?.stringTuning.tunings.length ?? 0,
        })),
      )
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
        if (s.loaded?.itemId === item.id) void s.seek(ms / 1000)
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
    if (output && loaded?.itemId === item.id) output.updatePosition(position * 1000)
  }, [position, loaded, item.id])

  // Display settings.
  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    api.settings.display.staveProfile = PROFILE[profile]
    api.settings.display.scale = zoom
    api.settings.display.layoutMode = horizontal ? LayoutMode.Horizontal : LayoutMode.Page
    api.updateSettings()
    if (api.score) api.render()
  }, [profile, zoom, horizontal])

  useEffect(() => {
    const api = apiRef.current
    const score = scoreRef.current
    if (!api || !score) return
    const t = score.tracks[trackIndex]
    if (t) api.renderTracks([t])
    setCursor((c) => edit.clampCursor(score, { ...c, track: trackIndex }))
  }, [trackIndex, status === 'ready' && tracks.length > 0]) // eslint-disable-line react-hooks/exhaustive-deps

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
    if (
      s.loaded?.itemId === item.id &&
      s.loaded.revision === revisionRef.current &&
      s.loadState === 'ready'
    ) {
      return true
    }
    if (renderingRef.current) return renderingRef.current
    const revision = revisionRef.current
    const at = s.loaded?.itemId === item.id ? s.position : 0
    renderingRef.current = (async () => {
      try {
        setRenderProgress(0)
        const track = await renderScoreAudio(api, {
          sampleRate: useMediaStore.getState().engineRate || 48_000,
          trackVolume: renderVolumes(),
          metronome,
          onProgress: setRenderProgress,
        })
        await useMediaStore.getState().loadDecoded(item.id, track, revision)
        if (at > 0)
          await useMediaStore.getState().seek(Math.min(at, track.frames / track.sampleRate))
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
  }, [item.id, metronome, renderVolumes])

  useEffect(() => {
    useMediaStore.setState({ prepare })
    return () => {
      if (useMediaStore.getState().prepare === prepare) useMediaStore.setState({ prepare: null })
    }
  }, [prepare])

  // A stale render keeps playing until the user presses play again; flag it.
  const stale = loaded?.itemId === item.id && loaded.revision !== revision

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
      const t = score.tracks[trackIndex]
      if (t) api.renderTracks([t])
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
      api.renderScore(score, [trackIndex])
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
    if (!api || !score || !editing) {
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
  }, [cursor, editing, status, zoom, profile, horizontal, score, revision])

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
    if (!editing) return
    const s = settings()
    const c = cursor
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
          setEditing(false)
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

  const loopBars = (from: number, to: number) => {
    const a = barTimes(Math.min(from, to))
    const b = barTimes(Math.max(from, to))
    if (!a || !b) return
    useMediaStore.getState().setLoop(a.start, b.end, true)
    void prepare().then(async (ok) => {
      if (ok) await useMediaStore.getState().seek(a.start)
    })
  }

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
        new midi.AlphaSynthMidiFileHandler(file),
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

  // ── Render ────────────────────────────────────────────────────────────
  const beat = score ? edit.beatAt(score, cursor) : null
  const note = score ? edit.noteAt(score, cursor) : null
  const mb = score?.masterBars[cursor.bar]
  const fill = score ? edit.barFill(score, cursor) : { used: 0, capacity: 0 }
  const s = () => settings()

  const toggleIn = (set: Set<number>, i: number) => {
    const next = new Set(set)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    return next
  }

  return (
    <div className={styles.view}>
      <header className={styles.viewHeader}>
        <div>
          <h3 className={styles.viewTitle}>{title.title || item.name}</h3>
          <div className={styles.viewSub}>
            {title.artist || item.artist}
            {savedAt && <span className={tabStyles.saved}> · saved</span>}
          </div>
        </div>
        <div className={tabStyles.toolbar}>
          <select
            className={styles.select}
            value={profile}
            onChange={(e) => setProfile(e.target.value as Profile)}
            aria-label="Notation"
          >
            <option value="both">Score + Tab</option>
            <option value="tab">Tab</option>
            <option value="score">Score</option>
          </select>
          <button
            type="button"
            className={styles.chip}
            onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))}
            aria-label="Zoom out"
          >
            −
          </button>
          <span className={styles.dim}>{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className={styles.chip}
            onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2)))}
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className={`${styles.chip} ${horizontal ? styles.chipOn : ''}`}
            onClick={() => setHorizontal((h) => !h)}
            title="Single horizontal line"
          >
            ⟷
          </button>
          <button
            type="button"
            className={`${styles.chip} ${metronome ? styles.chipOn : ''}`}
            onClick={() => setMetronome((m) => !m)}
            aria-pressed={metronome}
            title="Metronome clicks in the playback"
          >
            Metronome
          </button>
          <button
            type="button"
            className={`${styles.chip} ${editing ? styles.chipOn : ''}`}
            onClick={() => {
              setEditing((v) => !v)
              setTimeout(() => viewportRef.current?.focus(), 0)
            }}
            aria-pressed={editing}
          >
            ✎ Edit
          </button>
          <select
            className={styles.select}
            value=""
            onChange={(e) => {
              const v = e.target.value as 'gp' | 'atex' | 'mid' | 'print' | 'tex'
              if (v === 'tex') openTex()
              else if (v) exportAs(v)
              e.target.value = ''
            }}
            aria-label="Export"
          >
            <option value="">Export…</option>
            <option value="gp">Guitar Pro (.gp)</option>
            <option value="atex">AlphaTex (.atex)</option>
            <option value="mid">MIDI (.mid)</option>
            <option value="print">Print / PDF</option>
            <option value="tex">Edit as AlphaTex…</option>
          </select>
        </div>
      </header>

      {tracks.length > 0 && (
        <div className={tabStyles.tracks} role="list" aria-label="Tracks">
          {tracks.map((t, i) => (
            <div
              key={i}
              role="listitem"
              className={`${tabStyles.track} ${i === trackIndex ? tabStyles.trackOn : ''}`}
            >
              <button
                type="button"
                className={tabStyles.trackName}
                onClick={() => setTrackIndex(i)}
                title="Show this track"
              >
                {t.name}
                {t.strings > 0 && <span className={styles.dim}> · {t.strings}str</span>}
              </button>
              <button
                type="button"
                className={`${tabStyles.ms} ${muted.has(i) ? tabStyles.msOn : ''}`}
                onClick={() => setMuted((m) => toggleIn(m, i))}
                aria-pressed={muted.has(i)}
                title="Mute in playback"
              >
                M
              </button>
              <button
                type="button"
                className={`${tabStyles.ms} ${solo.has(i) ? tabStyles.soloOn : ''}`}
                onClick={() => setSolo((m) => toggleIn(m, i))}
                aria-pressed={solo.has(i)}
                title="Solo in playback"
              >
                S
              </button>
            </div>
          ))}
        </div>
      )}

      {editing && score && (
        <div className={tabStyles.palette} aria-label="Edit palette">
          <div className={tabStyles.paletteGroup}>
            {edit.DURATIONS.map((d) => (
              <button
                key={d}
                type="button"
                className={`${tabStyles.pbtn} ${beat?.duration === d ? tabStyles.pbtnOn : ''}`}
                onClick={() => apply((sc) => edit.setDuration(sc, cursor, d, s()))}
                title={`Duration ${edit.DURATION_LABEL[d]} (+/−)`}
              >
                {edit.DURATION_LABEL[d]}
              </button>
            ))}
            <button
              type="button"
              className={`${tabStyles.pbtn} ${beat?.dots ? tabStyles.pbtnOn : ''}`}
              onClick={() => apply((sc) => edit.toggleDot(sc, cursor, s()))}
              title="Dotted (.)"
            >
              •
            </button>
            <button
              type="button"
              className={`${tabStyles.pbtn} ${beat?.tupletNumerator === 3 ? tabStyles.pbtnOn : ''}`}
              onClick={() => apply((sc) => edit.setTuplet(sc, cursor, 3, 2, s()))}
              title="Triplet"
            >
              3
            </button>
            <button
              type="button"
              className={`${tabStyles.pbtn} ${beat?.isRest ? tabStyles.pbtnOn : ''}`}
              onClick={() => apply((sc) => edit.makeRest(sc, cursor, s()))}
              title="Rest (R)"
            >
              𝄽
            </button>
          </div>
          <div className={tabStyles.paletteGroup}>
            {(
              [
                ['palmMute', 'P.M.', 'Palm mute (P)', note?.isPalmMute],
                ['letRing', 'L.R.', 'Let ring (L)', note?.isLetRing],
                ['hammer', 'H/P', 'Hammer-on / pull-off (H)', note?.isHammerPullOrigin],
                [
                  'slide',
                  'sl.',
                  'Slide (S)',
                  note && note.slideOutType !== model.SlideOutType.None,
                ],
                ['bend', 'bend', 'Full bend (B)', note?.hasBend],
                ['vibrato', '~', 'Vibrato (V)', note && note.vibrato !== model.VibratoType.None],
                ['dead', '×', 'Dead note (X)', note?.isDead],
                ['ghost', '( )', 'Ghost note', note?.isGhost],
                [
                  'harmonic',
                  '◇',
                  'Natural harmonic',
                  note && note.harmonicType !== model.HarmonicType.None,
                ],
                ['staccato', '·', 'Staccato', note?.isStaccato],
                ['accent', '>', 'Accent', note && note.accentuated !== model.AccentuationType.None],
                ['tie', '⌒', 'Tie (T)', note?.isTieDestination],
              ] as const
            ).map(([fx, label, tip, on]) => (
              <button
                key={fx}
                type="button"
                className={`${tabStyles.pbtn} ${on ? tabStyles.pbtnOn : ''}`}
                disabled={!note}
                onClick={() => apply((sc) => void edit.toggleNoteEffect(sc, cursor, fx, s()))}
                title={tip}
              >
                {label}
              </button>
            ))}
            {(
              [
                ['tap', 'T', 'Tapping', beat?.tap],
                ['pickDown', '⊓', 'Pick down', beat?.pickStroke === model.PickStroke.Down],
                ['pickUp', 'V', 'Pick up', beat?.pickStroke === model.PickStroke.Up],
              ] as const
            ).map(([fx, label, tip, on]) => (
              <button
                key={fx}
                type="button"
                className={`${tabStyles.pbtn} ${on ? tabStyles.pbtnOn : ''}`}
                disabled={!beat}
                onClick={() => apply((sc) => void edit.toggleBeatEffect(sc, cursor, fx, s()))}
                title={tip}
              >
                {label}
              </button>
            ))}
          </div>
          <div className={tabStyles.paletteGroup}>
            <span className={styles.dim}>Bar {cursor.bar + 1}</span>
            <input
              className={tabStyles.num}
              type="number"
              min={1}
              max={32}
              value={mb?.timeSignatureNumerator ?? 4}
              onChange={(e) =>
                apply((sc) =>
                  edit.setTimeSignature(
                    sc,
                    cursor.bar,
                    Number(e.target.value),
                    mb?.timeSignatureDenominator ?? 4,
                    s(),
                  ),
                )
              }
              aria-label="Beats per bar"
            />
            <span className={styles.dim}>/</span>
            <select
              className={styles.select}
              value={mb?.timeSignatureDenominator ?? 4}
              onChange={(e) =>
                apply((sc) =>
                  edit.setTimeSignature(
                    sc,
                    cursor.bar,
                    mb?.timeSignatureNumerator ?? 4,
                    Number(e.target.value),
                    s(),
                  ),
                )
              }
              aria-label="Beat unit"
            >
              {[2, 4, 8, 16].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <span className={styles.dim}>♩=</span>
            <input
              className={tabStyles.num}
              type="number"
              min={20}
              max={400}
              value={edit.tempoAt(score, cursor.bar)}
              onChange={(e) =>
                apply((sc) => edit.setTempo(sc, cursor.bar, Number(e.target.value), s()))
              }
              aria-label="Tempo"
            />
            <button
              type="button"
              className={`${tabStyles.pbtn} ${mb?.isRepeatStart ? tabStyles.pbtnOn : ''}`}
              onClick={() => apply((sc) => edit.toggleRepeat(sc, cursor.bar, 'start', s()))}
              title="Repeat start"
            >
              𝄆
            </button>
            <button
              type="button"
              className={`${tabStyles.pbtn} ${mb && mb.repeatCount > 0 ? tabStyles.pbtnOn : ''}`}
              onClick={() => apply((sc) => edit.toggleRepeat(sc, cursor.bar, 'end', s()))}
              title="Repeat end (x2)"
            >
              𝄇
            </button>
            <button
              type="button"
              className={tabStyles.pbtn}
              onClick={() =>
                apply((sc) => ({ ...cursor, bar: edit.insertBar(sc, cursor.bar, s()), beat: 0 }))
              }
              title="Insert bar after"
            >
              + bar
            </button>
            <button
              type="button"
              className={tabStyles.pbtn}
              onClick={() =>
                apply((sc) => ({ ...cursor, bar: edit.duplicateBar(sc, cursor.bar, s()), beat: 0 }))
              }
              title="Duplicate bar"
            >
              ⧉ bar
            </button>
            <button
              type="button"
              className={tabStyles.pbtn}
              disabled={score.masterBars.length <= 1}
              onClick={() =>
                apply((sc) => {
                  edit.deleteBar(sc, cursor.bar, s())
                  return { ...cursor, beat: 0 }
                })
              }
              title="Delete bar"
            >
              − bar
            </button>
            <button
              type="button"
              className={tabStyles.pbtn}
              onClick={() => apply((sc) => edit.transposeBar(sc, cursor, -1, s()))}
              title="Bar down a semitone"
            >
              ♭
            </button>
            <button
              type="button"
              className={tabStyles.pbtn}
              onClick={() => apply((sc) => edit.transposeBar(sc, cursor, 1, s()))}
              title="Bar up a semitone"
            >
              ♯
            </button>
          </div>
          <div className={tabStyles.paletteGroup}>
            <button
              type="button"
              className={tabStyles.pbtn}
              disabled={history.undo === 0}
              onClick={undo}
              title="Undo (Ctrl/Cmd+Z)"
            >
              ↶
            </button>
            <button
              type="button"
              className={tabStyles.pbtn}
              disabled={history.redo === 0}
              onClick={redo}
              title="Redo (Ctrl/Cmd+Shift+Z)"
            >
              ↷
            </button>
            <span className={`${styles.dim} ${fill.used > fill.capacity ? tabStyles.over : ''}`}>
              {fill.capacity > 0 && fill.used !== fill.capacity
                ? fill.used > fill.capacity
                  ? 'bar too long'
                  : 'bar incomplete'
                : ''}
            </span>
          </div>
        </div>
      )}

      {error && <div className={`${styles.errorNotice} ${tabStyles.pre}`}>{error}</div>}
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
          {box && (
            <>
              <div
                className={tabStyles.beatBox}
                style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
              />
              <div
                className={tabStyles.stringMark}
                style={{ left: box.x, top: box.stringY - 7, width: box.w }}
              />
            </>
          )}
        </div>
      </div>

      <div className={styles.transportRow}>
        <TransportButtons />
        <div className={styles.markers}>
          {renderProgress !== null && (
            <span className={styles.dim}>Rendering audio… {Math.round(renderProgress * 100)}%</span>
          )}
          {stale && !playing && renderProgress === null && (
            <span className={styles.dim}>Edited — press play to hear changes</span>
          )}
          <button
            type="button"
            className={styles.chip}
            onClick={() => loopBars(cursor.bar, cursor.bar)}
            title="Loop the bar under the cursor"
          >
            ⟲ Bar {cursor.bar + 1}
          </button>
          <button
            type="button"
            className={styles.chip}
            onClick={() => loopBars(cursor.bar, cursor.bar + 3)}
            title="Loop 4 bars from the cursor"
          >
            ⟲ 4 bars
          </button>
          <span className={styles.dim}>{formatTime(position)}</span>
        </div>
      </div>
      <PracticeControls />

      {texOpen && (
        <div className={tabStyles.texPane}>
          <div className={tabStyles.texHead}>
            <strong>AlphaTex</strong>
            <span className={styles.dim}>Edit the score as text, then apply.</span>
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
