import { useEffect, useRef } from 'react'
import { usePlayerStore } from './playerStore'
import { useSongsStore, getSongBytes } from './songsStore'
import { parseScore, extractTrackEvents } from '@openaxe/songbook'
import { lookaheadSchedule } from '../engine/songScheduler'
import { ensureDefaultSoundfont } from '../soundfonts/soundfontLoader'
import type { AudioEngineState, AudioEngineActions } from '../hooks/useAudioEngine'
import type { ScoreEvent } from '@openaxe/songbook'

export function useSongEngine(engine: AudioEngineState & AudioEngineActions) {
  const rig = engine.rig
  const context = engine.context
  const isReady = engine.status === 'ready'

  const currentSong = usePlayerStore((s) => s.currentSong)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const tempoScale = usePlayerStore((s) => s.tempoScale)
  const loopStart = usePlayerStore((s) => s.loopStartTick)
  const loopEnd = usePlayerStore((s) => s.loopEndTick)
  const trackMutes = usePlayerStore((s) => s.trackMutes)
  const transpose = usePlayerStore((s) => s.transposeSemitones)
  const setPositionTicks = usePlayerStore((s) => s.setPositionTicks)
  const setPlaying = usePlayerStore((s) => s.setPlaying)

  const eventsRef = useRef<ScoreEvent[]>([])
  const scoreTicksRef = useRef(0)

  useEffect(() => {
    if (!currentSong || !isReady || !rig) return
    let cancelled = false
    const load = async () => {
      try {
        await ensureDefaultSoundfont((bytes) => rig.loadSoundfont(bytes))
      } catch {
        // dummy sine will still play in tests
      }
      const bytes = getSongBytes(currentSong)
      const isText = currentSong.fileType === 'musicxml' || currentSong.fileType === 'atex'
      const data: Uint8Array | string = isText ? new TextDecoder().decode(bytes) : bytes
      const summary = await parseScore(data as string & Uint8Array, {
        filename: currentSong.filename,
      })
      if (cancelled) return
      const allTrackIds = summary.tracks.map((t) => t.id)
      const activeIds = allTrackIds.filter((id) => !trackMutes[id])
      const events = extractTrackEvents(summary, activeIds)
      if (transpose !== 0) {
        for (const ev of events) {
          if (ev.type === 'noteOn' || ev.type === 'noteOff')
            ev.key = Math.min(127, Math.max(0, ev.key + transpose))
        }
      }
      eventsRef.current = events
      scoreTicksRef.current = summary.durationTicks
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [currentSong, isReady, rig, trackMutes, transpose])

  const scheduleRef = useRef<number | null>(null)
  const positionRef = useRef(0)

  useEffect(() => {
    if (!isReady || !rig || !context) return
    if (!isPlaying || !currentSong) {
      if (scheduleRef.current !== null) {
        cancelAnimationFrame(scheduleRef.current)
        scheduleRef.current = null
      }
      return
    }

    let lastTime = performance.now()
    const sampleRate = context.sampleRate
    const lookaheadSamples = 4096

    const tick = async () => {
      const now = performance.now()
      const deltaMs = now - lastTime
      lastTime = now
      const deltaSamples = (deltaMs / 1000) * sampleRate * tempoScale
      positionRef.current += deltaSamples
      const positionTicks = Math.floor((positionRef.current / sampleRate) * ((120 * 960) / 60))

      try {
        const pos = await rig.songPosition()
        positionRef.current = pos
        const ticks = Math.floor((pos / sampleRate) * ((120 * 960) / 60))
        setPositionTicks(ticks)
      } catch {
        setPositionTicks(positionTicks)
      }

      const currentTick = Math.floor((positionRef.current / sampleRate) * ((120 * 960) / 60))
      const lookaheadTicks = Math.floor((lookaheadSamples / sampleRate) * ((120 * 960) / 60))
      const scheduled = lookaheadSchedule(eventsRef.current, currentTick, lookaheadTicks, {
        sampleRate,
        tempoScale,
        ...(loopStart !== null ? { loopStartTick: loopStart } : {}),
        ...(loopEnd !== null ? { loopEndTick: loopEnd } : {}),
      } as import('../engine/songScheduler').LookaheadOptions)
      for (const ev of scheduled) {
        const kindMap: Record<string, number> = {
          noteOn: 0,
          noteOff: 1,
          cc: 2,
          program: 3,
          pitchBend: 4,
        }
        const kind = kindMap[ev.kind] ?? 0
        rig.scheduleSongEvent(kind, ev.channel, ev.key, ev.value, ev.deltaFrames)
      }

      if (
        loopStart !== null &&
        loopEnd !== null &&
        positionRef.current >= (loopEnd / 960) * (60 / 120) * sampleRate
      ) {
        const loopStartSamples = (loopStart / 960) * (60 / 120) * sampleRate
        positionRef.current = loopStartSamples
        rig.songSeek(Math.floor(loopStartSamples))
      }

      if (positionRef.current >= (scoreTicksRef.current / 960) * (60 / 120) * sampleRate) {
        setPlaying(false)
        rig.songStop()
        return
      }

      scheduleRef.current = requestAnimationFrame(tick)
    }

    rig.songStart()
    scheduleRef.current = requestAnimationFrame(tick)

    return () => {
      if (scheduleRef.current !== null) cancelAnimationFrame(scheduleRef.current)
      scheduleRef.current = null
      rig.songStop()
    }
  }, [
    isPlaying,
    isReady,
    rig,
    context,
    currentSong,
    tempoScale,
    loopStart,
    loopEnd,
    setPositionTicks,
    setPlaying,
  ])

  const selectedId = useSongsStore((s) => s.selectedId)
  const songs = useSongsStore((s) => s.songs)
  useEffect(() => {
    if (selectedId) {
      const song = songs.find((s) => s.id === selectedId) ?? null
      if (song && usePlayerStore.getState().currentSong?.id !== song.id) {
        usePlayerStore.getState().setCurrentSong(song)
      }
    }
  }, [selectedId, songs])
}
