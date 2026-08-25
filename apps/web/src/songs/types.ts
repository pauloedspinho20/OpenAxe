import type { ScoreSummary } from '@openaxe/songbook'

export type SongFileType = 'gp' | 'musicxml' | 'mid' | 'atex'

export interface Song {
  id: string
  title: string
  artist: string
  filename: string
  fileType: SongFileType
  barCount: number
  durationTicks: number
  durationMillis: number
  ticksPerBeat: number
  tracks: ScoreSummary['tracks']
  tempoMap: ScoreSummary['tempoMap']
  // base64 of original file bytes (for desktop file persistence and re-parse)
  dataBase64: string
  createdAt: number
  updatedAt: number
  // Optional: parsed score summary for quick access (not persisted as raw, but derived)
  summary?: ScoreSummary
}

export interface PlayerState {
  currentSongId: string | null
  isPlaying: boolean
  positionTicks: number
  positionSamples: number
  tempoScale: number // 0.25..2.0, 1 = original tempo
  loopStartTick: number | null
  loopEndTick: number | null
  // Per-track mute toggles (track id → muted)
  trackMutes: Record<number, boolean>
  // Count-in bars before playback
  countInBars: number
  // Metronome enabled
  metronome: boolean
}

export interface PracticeState {
  speedTrainer: boolean
  speedTrainerStart: number // 0.5..1.0
  speedTrainerStep: number // 0.05..0.2
  speedTrainerTarget: number // 1.0..2.0
}
