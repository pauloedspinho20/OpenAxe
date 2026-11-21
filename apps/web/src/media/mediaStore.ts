/**
 * Media center state (issue #205): the library, the loaded track and the
 * practice controls, all driving the core backing-track player through a
 * BackingTransport. One player serves both backing tracks (audio files) and
 * tabs (the score is rendered to audio first - see tabs/scoreAudio.ts), so
 * speed/transpose/loop behave identically for both.
 */
import { create } from 'zustand'

import {
  computeDetailPeaks,
  computePeaks,
  decodeAudio,
  MAX_AUDIO_BYTES,
  type DetailPeaks,
} from './decode'
import {
  DEFAULT_PRACTICE,
  deleteMedia,
  isScoreFile,
  listMedia,
  loadMediaFile,
  newMediaId,
  saveMedia,
  saveMediaFile,
  titleFromFileName,
  type MediaItem,
  type PracticeSettings,
} from './mediaDb'
import type { BackingTransport, DecodedTrack, PlayerStatus } from './transport'

export type LoadState = 'idle' | 'loading' | 'ready' | 'error'

/** The slice of AnalyserNode (or the desktop's NativeAnalyser) wait mode reads. */
export interface AnalyserLike {
  fftSize: number
  context: { sampleRate: number }
  getFloatTimeDomainData(buffer: Float32Array<ArrayBuffer>): void
}

/** What is in the core player right now. */
export interface LoadedSource {
  itemId: string
  /** Bumped by score edits so a stale render is never mistaken for current. */
  revision: number
}

interface MediaState {
  items: MediaItem[]
  libraryLoaded: boolean
  transport: BackingTransport | null
  /** Preferred decode rate (the engine's), so the core can skip rate conversion. */
  engineRate: number

  activeId: string | null
  loaded: LoadedSource | null
  loadState: LoadState
  loadProgress: number
  error: string | null

  position: number
  duration: number
  playing: boolean
  meter: number
  /** High-resolution min/max peaks of the loaded audio track, for the zoomed waveform. */
  detail: DetailPeaks | null
  practice: PracticeSettings
  /** Speed trainer: raise the speed by `step` every `every` loop passes, up to `target`. */
  trainer: SpeedTrainer
  loopCount: number
  /** Accuracy of the last scored pass (Listen mode), for display. */
  lastPass: number | null
  /** The speed that pass was played at (the trainer may have raised it since). */
  lastPassSpeed: number
  cleanStreak: number
  /** Increments on every scored pass (lets views react to each one). */
  passCount: number
  /** A count-in is sounding. */
  counting: boolean
  /** Tempo/meter at the play position, set by the tab workspace (overrides the item's). */
  tempoHint: { bpm: number; beatsPerBar: number } | null
  /** The guitar input (the tuner's analyser), for wait mode. */
  inputAnalyser: AnalyserLike | null
  /**
   * Set by the tab workspace: makes sure the open score's current revision
   * is rendered and loaded before play. Resolves false to abort playing.
   */
  prepare: (() => Promise<boolean>) | null
}

export interface SpeedTrainer {
  enabled: boolean
  /** Only count passes scored at >= 90% (needs Listen mode). */
  clean: boolean
  step: number
  every: number
  target: number
}

interface MediaActions {
  loadLibrary(): Promise<void>
  importFiles(files: FileList | File[]): Promise<MediaItem[]>
  removeItem(id: string): Promise<void>
  updateItem(
    id: string,
    patch: Partial<
      Pick<
        MediaItem,
        | 'name'
        | 'artist'
        | 'markers'
        | 'sync'
        | 'resume'
        | 'view'
        | 'runs'
        | 'tone'
        | 'barNotes'
        | 'favorite'
        | 'status'
        | 'tags'
        | 'info'
      >
    >,
  ): Promise<void>
  setTransport(transport: BackingTransport | null, engineRate?: number): void

  /** Select a library item; audio items load into the player immediately. */
  open(id: string): Promise<void>
  /** Load already-decoded audio (a rendered score) as `itemId`'s audio. */
  loadDecoded(itemId: string, track: DecodedTrack, revision: number): Promise<void>
  close(): Promise<void>

  play(): Promise<void>
  pause(): Promise<void>
  toggle(): Promise<void>
  seek(seconds: number): Promise<void>
  skip(deltaSeconds: number): Promise<void>
  setSpeed(speed: number): void
  setSemitones(semitones: number): void
  setVolume(volume: number): void
  setLoopPoint(which: 'start' | 'end', seconds: number | null): void
  setLoop(start: number | null, end: number | null, enabled?: boolean): void
  toggleLoop(): void
  setTrainer(patch: Partial<SpeedTrainer>): void
  /** Listen mode reports each scored loop pass; the clean-pass trainer acts on it. */
  reportPass(accuracy: number, speed?: number): void
  setCountIn(patch: Partial<Pick<PracticeSettings, 'countInBars' | 'bpm' | 'beatsPerBar'>>): void
  /** Called by the poller with the core's report. */
  applyStatus(status: PlayerStatus): void
}

export type MediaStore = MediaState & MediaActions

const SPEED_MIN = 0.25
const SPEED_MAX = 2
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

let persistTimer: ReturnType<typeof setTimeout> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let loadToken = 0

export const useMediaStore = create<MediaStore>()((set, get) => {
  /** Frames <-> seconds use the loaded track's own rate. */
  let trackRate = 48_000

  const report = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    set({ error: message })
  }

  /** Save where the active backing track is (tabs save their own score time). */
  const rememberPosition = () => {
    const { activeId, items, position, loaded } = get()
    const item = items.find((i) => i.id === activeId)
    if (!item || item.kind !== 'audio' || loaded?.itemId !== item.id) return
    const resume = Math.round(position * 10) / 10
    if (resume === (item.resume ?? 0)) return
    const next = { ...item, resume }
    set({ items: get().items.map((i) => (i.id === item.id ? next : i)) })
    void saveMedia(next).catch(() => {})
  }

  const persistPractice = () => {
    const { activeId, practice, items } = get()
    if (!activeId) return
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      const item = items.find((i) => i.id === activeId)
      if (!item) return
      const next = { ...item, practice }
      set({ items: get().items.map((i) => (i.id === activeId ? next : i)) })
      void saveMedia(next).catch(() => {})
    }, 400)
  }

  const pushLoop = () => {
    const { transport, practice, loadState } = get()
    if (!transport || loadState !== 'ready') return
    const { loopStart, loopEnd, loopEnabled } = practice
    const on = loopEnabled && loopStart !== null && loopEnd !== null && loopEnd > loopStart
    void transport
      .setLoop((loopStart ?? 0) * trackRate, (loopEnd ?? 0) * trackRate, on)
      .catch(report)
  }

  const applyPractice = async (transport: BackingTransport) => {
    const { practice } = get()
    await transport.setSpeed(practice.speed)
    await transport.setSemitones(practice.semitones)
    await transport.setVolume(practice.volume)
    pushLoop()
  }

  // 20 Hz while playing (smooth playhead), ~4 Hz while paused (catch end of
  // track / external changes without chattering over the bridge).
  let pollSkip = 0
  const startPolling = () => {
    if (pollTimer) return
    pollTimer = setInterval(() => {
      const { transport, loadState, playing } = get()
      if (!transport || loadState !== 'ready') return
      if (!playing && ++pollSkip % 5 !== 0) return
      transport
        .status()
        .then((s) => get().applyStatus(s))
        .catch(() => {})
    }, 50)
  }

  const stopPolling = () => {
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = null
  }

  const loadIntoPlayer = async (itemId: string, track: DecodedTrack, revision: number) => {
    const transport = get().transport
    if (!transport) throw new Error('Power on the audio engine to play tracks')
    const token = ++loadToken
    set({ loadState: 'loading', loadProgress: 0, error: null, playing: false })
    const status = await transport.load(track, (p) => {
      if (token === loadToken) set({ loadProgress: p })
    })
    if (token !== loadToken) return
    trackRate = track.sampleRate
    set({
      loaded: { itemId, revision },
      loadState: 'ready',
      loadProgress: 1,
      duration: track.frames / track.sampleRate,
      position: 0,
    })
    get().applyStatus(status)
    await applyPractice(transport)
    startPolling()
  }

  return {
    items: [],
    libraryLoaded: false,
    transport: null,
    engineRate: 48_000,
    activeId: null,
    loaded: null,
    detail: null,
    loadState: 'idle',
    loadProgress: 0,
    error: null,
    position: 0,
    duration: 0,
    playing: false,
    meter: 0,
    practice: { ...DEFAULT_PRACTICE },
    trainer: { enabled: false, clean: false, step: 0.05, every: 2, target: 1 },
    lastPass: null,
    lastPassSpeed: 1,
    cleanStreak: 0,
    passCount: 0,
    loopCount: 0,
    prepare: null,
    counting: false,
    tempoHint: null,
    inputAnalyser: null,

    setCountIn(patch) {
      const p = get().practice
      set({
        practice: {
          ...p,
          ...patch,
          countInBars: Math.min(4, Math.max(0, Math.round(patch.countInBars ?? p.countInBars))),
          bpm: Math.min(400, Math.max(20, Math.round(patch.bpm ?? p.bpm))),
          beatsPerBar: Math.min(16, Math.max(1, Math.round(patch.beatsPerBar ?? p.beatsPerBar))),
        },
      })
      persistPractice()
    },

    reportPass(accuracy, speed) {
      const { trainer, practice } = get()
      set({
        lastPass: accuracy,
        lastPassSpeed: speed ?? practice.speed,
        passCount: get().passCount + 1,
      })
      if (!trainer.enabled || !trainer.clean) return
      if (accuracy < 0.9) {
        set({ cleanStreak: 0 })
        return
      }
      const cleanStreak = get().cleanStreak + 1
      set({ cleanStreak })
      if (cleanStreak % Math.max(1, trainer.every) === 0 && practice.speed < trainer.target) {
        get().setSpeed(Math.min(trainer.target, practice.speed + trainer.step))
      }
    },

    setTrainer(patch) {
      set({ trainer: { ...get().trainer, ...patch }, loopCount: 0 })
    },

    async loadLibrary() {
      try {
        set({ items: await listMedia(), libraryLoaded: true })
      } catch (err) {
        set({ libraryLoaded: true })
        report(err)
      }
    },

    async importFiles(files) {
      const added: MediaItem[] = []
      for (const file of Array.from(files)) {
        try {
          if (file.size > MAX_AUDIO_BYTES) throw new Error(`${file.name} is larger than 200 MB`)
          const score = isScoreFile(file.name)
          const { name, artist } = titleFromFileName(file.name)
          const item: MediaItem = {
            id: newMediaId(),
            kind: score ? 'score' : 'audio',
            name,
            artist,
            fileName: file.name,
            mime: file.type,
            size: file.size,
            addedAt: Date.now(),
            duration: 0,
            peaks: [],
            practice: { ...DEFAULT_PRACTICE },
            markers: [],
          }
          if (!score) {
            // Decode once up front: validates the file and gives the waveform.
            const track = await decodeAudio(await file.arrayBuffer(), get().engineRate)
            item.duration = track.frames / track.sampleRate
            item.peaks = computePeaks(track)
          }
          await saveMediaFile(item.id, file)
          await saveMedia(item)
          added.push(item)
        } catch (err) {
          report(
            new Error(
              `Could not import ${file.name}: ${err instanceof Error ? err.message : String(err)}`,
            ),
          )
        }
      }
      if (added.length) set({ items: [...added, ...get().items] })
      return added
    },

    async removeItem(id) {
      if (get().activeId === id) await get().close()
      await deleteMedia(id)
      set({ items: get().items.filter((i) => i.id !== id) })
    },

    async updateItem(id, patch) {
      const item = get().items.find((i) => i.id === id)
      if (!item) return
      const next = { ...item, ...patch }
      set({ items: get().items.map((i) => (i.id === id ? next : i)) })
      await saveMedia(next)
    },

    setTransport(transport, engineRate) {
      const prev = get().transport
      if (prev === transport) {
        if (engineRate) set({ engineRate })
        return
      }
      // A new transport is a new (empty) core player: whatever was loaded is gone.
      set({
        transport,
        ...(engineRate ? { engineRate } : {}),
        loaded: null,
        loadState: 'idle',
        playing: false,
        meter: 0,
      })
      if (!transport) stopPolling()
    },

    async open(id) {
      const item = get().items.find((i) => i.id === id)
      if (!item) return
      if (get().activeId !== id) rememberPosition()
      if (persistTimer) clearTimeout(persistTimer)
      set({ activeId: id, practice: { ...item.practice }, error: null })
      if (item.kind !== 'audio') {
        set({ detail: null })
        // Scores load once rendered (tabs/useScorePlayback).
        if (get().loaded?.itemId !== id) {
          set({ position: 0, duration: 0, playing: false, loadState: 'idle' })
          if (get().transport && get().loaded) void get().transport!.pause()
        }
        return
      }
      if (get().loaded?.itemId === id && get().loadState === 'ready') return
      try {
        const blob = await loadMediaFile(id)
        if (!blob) throw new Error('The file for this track is missing')
        set({ loadState: 'loading', loadProgress: 0, duration: item.duration })
        const track = await decodeAudio(await blob.arrayBuffer(), get().engineRate)
        set({ detail: computeDetailPeaks(track) })
        if (get().activeId !== id) return
        await loadIntoPlayer(id, track, 0)
        // Pick up where this track was left.
        const resume = get().items.find((i) => i.id === id)?.resume ?? 0
        if (resume > 0 && resume < track.frames / track.sampleRate - 1) await get().seek(resume)
      } catch (err) {
        set({ loadState: 'error' })
        report(err)
      }
    },

    async loadDecoded(itemId, track, revision) {
      try {
        await loadIntoPlayer(itemId, track, revision)
      } catch (err) {
        set({ loadState: 'error' })
        report(err)
      }
    },

    async close() {
      rememberPosition()
      const { transport } = get()
      stopPolling()
      set({
        detail: null,
        activeId: null,
        loaded: null,
        loadState: 'idle',
        playing: false,
        position: 0,
        duration: 0,
      })
      if (transport) await transport.unload().catch(() => {})
    },

    async play() {
      if (!get().transport) return report(new Error('Power on the audio engine to play tracks'))
      const prepare = get().prepare
      if (prepare && !(await prepare())) return
      const { transport, loadState, activeId, loaded } = get()
      if (!transport) return
      if (loadState !== 'ready') {
        // Lost on an engine restart: reload, then play.
        if (activeId && loaded === null) {
          const item = get().items.find((i) => i.id === activeId)
          if (item?.kind === 'audio') {
            await get().open(activeId)
            if (get().loadState !== 'ready') return
          } else return
        } else return
      }
      const { practice, tempoHint } = get()
      if (practice.countInBars > 0) {
        const bpm = tempoHint?.bpm ?? practice.bpm
        const beats = tempoHint?.beatsPerBar ?? practice.beatsPerBar
        // Interval in output time: the count-in follows the practice speed.
        await transport.setCountIn(practice.countInBars * beats, 60 / (bpm * practice.speed), beats)
      } else {
        await transport.setCountIn(0, 0.5, 4)
      }
      get().applyStatus(await transport.play())
    },

    async pause() {
      const { transport } = get()
      if (!transport || get().loadState !== 'ready') return
      get().applyStatus(await transport.pause())
      rememberPosition()
    },

    async toggle() {
      if (get().playing) await get().pause()
      else await get().play()
    },

    async seek(seconds) {
      const { transport, duration } = get()
      const t = clamp(seconds, 0, duration || 0)
      set({ position: t })
      if (!transport || get().loadState !== 'ready') return
      get().applyStatus(await transport.seek(t * trackRate))
    },

    async skip(delta) {
      await get().seek(get().position + delta)
    },

    setSpeed(speed) {
      const value = clamp(Math.round(speed * 100) / 100, SPEED_MIN, SPEED_MAX)
      set({ practice: { ...get().practice, speed: value } })
      const { transport, loadState } = get()
      if (transport && loadState === 'ready') void transport.setSpeed(value).catch(report)
      persistPractice()
    },

    setSemitones(semitones) {
      const value = clamp(Math.round(semitones), -12, 12)
      set({ practice: { ...get().practice, semitones: value } })
      const { transport, loadState } = get()
      if (transport && loadState === 'ready') void transport.setSemitones(value).catch(report)
      persistPractice()
    },

    setVolume(volume) {
      const value = clamp(volume, 0, 2)
      set({ practice: { ...get().practice, volume: value } })
      const { transport, loadState } = get()
      if (transport && loadState === 'ready') void transport.setVolume(value).catch(report)
      persistPractice()
    },

    setLoopPoint(which, seconds) {
      const p = get().practice
      let loopStart = which === 'start' ? seconds : p.loopStart
      let loopEnd = which === 'end' ? seconds : p.loopEnd
      if (loopStart !== null && loopEnd !== null && loopEnd < loopStart) {
        ;[loopStart, loopEnd] = [loopEnd, loopStart]
      }
      const loopEnabled =
        loopStart !== null && loopEnd !== null && loopEnd - loopStart > 0.05 ? true : p.loopEnabled
      set({ practice: { ...p, loopStart, loopEnd, loopEnabled } })
      pushLoop()
      persistPractice()
    },

    setLoop(start, end, enabled) {
      const p = get().practice
      set({
        practice: {
          ...p,
          loopStart: start,
          loopEnd: end,
          loopEnabled: enabled ?? (start !== null && end !== null),
        },
      })
      pushLoop()
      persistPractice()
    },

    toggleLoop() {
      const p = get().practice
      set({ practice: { ...p, loopEnabled: !p.loopEnabled } })
      pushLoop()
      persistPractice()
    },

    applyStatus(status) {
      const rate = status.sampleRate || trackRate
      const next = status.position / rate
      const { practice, trainer, position: prev, playing } = get()
      // A loop pass shows up as the position jumping back to the loop start.
      if (
        playing &&
        status.playing &&
        practice.loopEnabled &&
        practice.loopStart !== null &&
        next < prev - 0.25 &&
        next <= practice.loopStart + 0.5
      ) {
        const loopCount = get().loopCount + 1
        set({ loopCount })
        if (
          trainer.enabled &&
          !trainer.clean &&
          loopCount % Math.max(1, trainer.every) === 0 &&
          practice.speed < trainer.target
        ) {
          get().setSpeed(Math.min(trainer.target, practice.speed + trainer.step))
        }
      }
      set({
        position: next,
        playing: status.playing,
        meter: status.meter,
        counting: !!status.counting,
        ...(status.length > 0 ? { duration: status.length / rate } : {}),
      })
    },
  }
})

/** Practice presets for the speed trainer. */
export const SPEED_PRESETS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25]
