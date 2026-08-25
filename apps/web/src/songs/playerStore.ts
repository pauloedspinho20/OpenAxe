import { create } from 'zustand'
import type { Song } from './types'

interface PlayerState {
  currentSong: Song | null
  isPlaying: boolean
  positionTicks: number
  positionSamples: number
  tempoScale: number // 0.25..2.0
  loopStartTick: number | null
  loopEndTick: number | null
  trackMutes: Record<number, boolean>
  countInBars: number
  metronome: boolean
  transposeSemitones: number // -12..12

  // Actions
  setCurrentSong: (song: Song | null) => void
  setPlaying: (playing: boolean) => void
  setPositionTicks: (ticks: number) => void
  setTempoScale: (scale: number) => void
  setLoop: (start: number | null, end: number | null) => void
  clearLoop: () => void
  toggleTrackMute: (trackId: number) => void
  setCountIn: (bars: number) => void
  setMetronome: (on: boolean) => void
  setTranspose: (semitones: number) => void
}

// Speed trainer presets (from #170)
export const SPEED_TRAINER_PRESETS = [
  { label: 'Slow', scale: 0.5 },
  { label: 'Practice', scale: 0.75 },
  { label: 'Normal', scale: 1 },
  { label: 'Fast', scale: 1.25 },
] as const

export const usePlayerStore = create<PlayerState>()((set) => ({
  currentSong: null,
  isPlaying: false,
  positionTicks: 0,
  positionSamples: 0,
  tempoScale: 1,
  loopStartTick: null,
  loopEndTick: null,
  trackMutes: {},
  countInBars: 0,
  metronome: false,
  transposeSemitones: 0,

  setCurrentSong: (song) =>
    set({ currentSong: song, positionTicks: 0, positionSamples: 0, isPlaying: false }),
  setPlaying: (playing) => set({ isPlaying: playing }),
  setPositionTicks: (ticks) => set({ positionTicks: ticks }),
  setTempoScale: (scale) => set({ tempoScale: Math.min(2, Math.max(0.25, scale)) }),
  setLoop: (start, end) => set({ loopStartTick: start, loopEndTick: end }),
  clearLoop: () => set({ loopStartTick: null, loopEndTick: null }),
  toggleTrackMute: (trackId) =>
    set((s) => ({ trackMutes: { ...s.trackMutes, [trackId]: !s.trackMutes[trackId] } })),
  setCountIn: (bars) => set({ countInBars: Math.max(0, Math.min(4, bars)) }),
  setMetronome: (on) => set({ metronome: on }),
  setTranspose: (semitones) => set({ transposeSemitones: Math.max(-12, Math.min(12, semitones)) }),
}))
