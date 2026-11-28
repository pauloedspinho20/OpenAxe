/**
 * Global tempo + metronome state. One store, one BPM: the header control, the
 * LEARN view, VISUALS and any tempo-synced block all read the same value, so
 * every screen stays in step. Persisted so the tempo survives a reload.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const MIN_BPM = 30
export const MAX_BPM = 300
export const DEFAULT_BPM = 120

/** Taps further apart than this start a new tap sequence. */
export const TAP_RESET_MS = 2000
/** Only the most recent taps are averaged, so the tempo can follow a drift. */
const TAP_WINDOW = 6

export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return DEFAULT_BPM
  // Whole BPM only: tap tempo, typing and the steppers all land on integers.
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)))
}

/**
 * BPM from a list of tap timestamps (ms), or null with fewer than two taps.
 * Averages the intervals of the last few taps.
 */
export function bpmFromTaps(taps: readonly number[]): number | null {
  const recent = taps.slice(-TAP_WINDOW)
  if (recent.length < 2) return null
  const span = recent[recent.length - 1]! - recent[0]!
  if (span <= 0) return null
  return clampBpm(60000 / (span / (recent.length - 1)))
}

export interface TempoState {
  bpm: number
  metronomeOn: boolean
  /** Linear click gain, 0..1. */
  metronomeVolume: number
  setBpm: (bpm: number) => void
  nudgeBpm: (delta: number) => void
  /** Register a tap at `now` (ms, performance.now()). */
  tap: (now: number) => void
  setMetronomeOn: (on: boolean) => void
  setMetronomeVolume: (volume: number) => void
}

// Tap timestamps are transient UI state, not worth persisting or re-rendering for.
let taps: number[] = []

export const useTempoStore = create<TempoState>()(
  persist(
    (set, get) => ({
      bpm: DEFAULT_BPM,
      metronomeOn: false,
      metronomeVolume: 0.5,
      setBpm: (bpm) => set({ bpm: clampBpm(bpm) }),
      nudgeBpm: (delta) => set({ bpm: clampBpm(get().bpm + delta) }),
      tap: (now) => {
        if (taps.length > 0 && now - taps[taps.length - 1]! > TAP_RESET_MS) taps = []
        taps.push(now)
        taps = taps.slice(-TAP_WINDOW)
        const bpm = bpmFromTaps(taps)
        if (bpm !== null) set({ bpm })
      },
      setMetronomeOn: (on) => set({ metronomeOn: on }),
      setMetronomeVolume: (volume) =>
        set({ metronomeVolume: Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 0)) }),
    }),
    {
      name: 'openaxe:tempo',
      // The metronome always starts off: a click on launch is never wanted.
      partialize: (s) => ({ bpm: s.bpm, metronomeVolume: s.metronomeVolume }),
    },
  ),
)

/** Test hook: forget any in-progress tap sequence. */
export function resetTapsForTest(): void {
  taps = []
}

/** Note divisions offered by tempo-synced controls. `beats` is in quarter notes. */
export const NOTE_DIVISIONS = [
  { value: '1/1', label: '1/1', beats: 4 },
  { value: '1/2', label: '1/2', beats: 2 },
  { value: '1/4', label: '1/4', beats: 1 },
  { value: '1/4d', label: '1/4 dotted', beats: 1.5 },
  { value: '1/8', label: '1/8', beats: 0.5 },
  { value: '1/8d', label: '1/8 dotted', beats: 0.75 },
  { value: '1/8t', label: '1/8 triplet', beats: 1 / 3 },
  { value: '1/16', label: '1/16', beats: 0.25 },
] as const

export type NoteDivision = (typeof NOTE_DIVISIONS)[number]['value']

/** Length of one division in milliseconds at `bpm`. */
export function divisionToMs(bpm: number, division: NoteDivision): number {
  const beats = NOTE_DIVISIONS.find((d) => d.value === division)?.beats ?? 1
  return (60000 / clampBpm(bpm)) * beats
}

/** Rate in Hz of a cycle that lasts one `division` at `bpm`. */
export function divisionToHz(bpm: number, division: NoteDivision): number {
  return 1000 / divisionToMs(bpm, division)
}
