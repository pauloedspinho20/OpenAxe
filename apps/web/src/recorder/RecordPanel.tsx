import { useEffect, useRef, useState } from 'react'
import { useAudioEngine } from '../hooks/useAudioEngine'
import { HardwareButton } from '@openaxe/ui'
import { useTakesStore } from './takesStore'
import { usePlayerStore } from '../songs/playerStore'
import { wavBase64FromPcm } from './wav'
import styles from './RecordPanel.module.css'
import type { TakeSource } from './types'

const SOURCE_OPTIONS: { value: TakeSource; label: string; source: number; bus: number }[] = [
  { value: 'master', label: 'Master Mix', source: 0, bus: 0 },
  { value: 'dry', label: 'Dry Input', source: 1, bus: 0 },
  { value: 'song', label: 'Song Only', source: 2, bus: 0 },
  { value: 'grid', label: 'Grid Only', source: 2, bus: 1 },
]

export function RecordPanel() {
  const { rig, status } = useAudioEngine()
  const isReady = status === 'ready'
  const addTake = useTakesStore((s) => s.addTake)
  const [armed, setArmed] = useState(false)
  const [recording, setRecording] = useState(false)
  const [source, setSource] = useState<TakeSource>('master')
  const [recordWithSong, setRecordWithSong] = useState(false)
  const [overdub, setOverdub] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const timerRef = useRef<number | null>(null)
  const levelRef = useRef<number | null>(null)

  const selected = SOURCE_OPTIONS.find((o) => o.value === source)!
  const currentSong = usePlayerStore((s) => s.currentSong)
  const isSongPlaying = usePlayerStore((s) => s.isPlaying)
  const setSongPlaying = usePlayerStore((s) => s.setPlaying)

  useEffect(() => {
    if (!recording) {
      if (timerRef.current) cancelAnimationFrame(timerRef.current)
      if (levelRef.current) cancelAnimationFrame(levelRef.current)
      return
    }
    let start = performance.now()
    const tick = () => {
      setElapsed((performance.now() - start) / 1000)
      timerRef.current = requestAnimationFrame(tick)
    }
    timerRef.current = requestAnimationFrame(tick)

    const pollLevel = async () => {
      if (!rig) return
      try {
        // Use master bus meter as level (0..1)
        const meter = await rig.getBusMeter(1) // grid bus as proxy for input
        setLevel(meter)
      } catch {}
      levelRef.current = requestAnimationFrame(pollLevel as FrameRequestCallback)
    }
    void pollLevel()

    return () => {
      if (timerRef.current) cancelAnimationFrame(timerRef.current)
      if (levelRef.current) cancelAnimationFrame(levelRef.current)
    }
  }, [recording, rig])

  const handleArm = () => setArmed((v) => !v)

  const handleRecord = async () => {
    if (!rig || !isReady) return
    if (recording) {
      // Stop — also stop song if we started it
      rig.captureStop()
      if (recordWithSong && isSongPlaying) setSongPlaying(false)
      // If overdub, keep previous takes playing (they were started before)
      setRecording(false)
      setArmed(false)
      // Drain
      const cap = 48000 * 30 // 30s max
      const pcm = await rig.captureRead(cap)
      if (pcm.length === 0) return
      const wavB64 = wavBase64FromPcm(pcm, 48000, { bits: 16, float: false, normalize: false })
      const peak = Math.max(...Array.from(pcm).map((v) => Math.abs(v)))
      const take = {
        id: crypto.randomUUID(),
        name: `Take ${new Date().toLocaleString()}`,
        createdAt: Date.now(),
        durationFrames: pcm.length / 2,
        sampleRate: 48000,
        channels: 2,
        source,
        wavBase64: wavB64,
        peak,
      }
      await addTake(take as import('./types').Take)
      setElapsed(0)

      // Overdub: if enabled, keep the new take's clip playing for monitoring?
      // For now, the new take is just saved; the user can play it via TakesManager.
      // If overdub was on, we already kept previous clips playing.
    } else {
      if (!armed) setArmed(true)
      // Record-with-song: start song transport sample-synced with capture
      if (recordWithSong && currentSong && !isSongPlaying) {
        setSongPlaying(true)
      }
      // Overdub: ensure existing takes' clips are playing (if any)
      if (overdub) {
        // The TakesManager's clips are already playing if the user started them;
        // here we just ensure we don't mute them. The mixer per-take mute controls
        // monitor. For now, we leave them as-is.
      }
      rig.captureStart(selected.source, selected.bus)
      setRecording(true)
      setElapsed(0)
    }
  }

  const handleJamSave = async () => {
    if (!rig) return
    const pcm = await rig.jamLift(48000 * 10)
    if (pcm.length === 0) return
    const wavB64 = wavBase64FromPcm(pcm, 48000, { bits: 16, float: false, normalize: false })
    const peak = Math.max(...Array.from(pcm).map((v) => Math.abs(v)))
    const take = {
      id: crypto.randomUUID(),
      name: `Jam ${new Date().toLocaleString()}`,
      createdAt: Date.now(),
      durationFrames: pcm.length / 2,
      sampleRate: 48000,
      channels: 2,
      source: 'master' as TakeSource,
      wavBase64: wavB64,
      peak,
    }
    await addTake(take as import('./types').Take)
  }

  if (!isReady) return null

  return (
    <div className={styles.panel} role="region" aria-label="Recorder">
      <div className={styles.header}>
        <span className={styles.title}>RECORDER</span>
        <span className={styles.timer}>{elapsed.toFixed(1)}s</span>
        <span className={styles.level} style={{ width: `${Math.min(100, level * 100)}%` }} aria-hidden />
      </div>

      <div className={styles.controls}>
        <HardwareButton label={armed ? 'Armed' : 'Arm'} active={armed} onClick={handleArm} />
        <HardwareButton label={recording ? 'Stop' : 'Record'} active={recording} onClick={() => void handleRecord()} disabled={!armed && !recording} />
        <select value={source} onChange={(e) => setSource(e.target.value as TakeSource)} className={styles.select} aria-label="Source">
          {SOURCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <HardwareButton label="Save Jam" onClick={() => void handleJamSave()} title="One-click save last 10s" />
        <label className={styles.checkLabel}>
          <input type="checkbox" checked={recordWithSong} onChange={(e) => setRecordWithSong(e.target.checked)} disabled={!currentSong} />
          With song
        </label>
        <label className={styles.checkLabel}>
          <input type="checkbox" checked={overdub} onChange={(e) => setOverdub(e.target.checked)} />
          Overdub
        </label>
      </div>
    </div>
  )
}
