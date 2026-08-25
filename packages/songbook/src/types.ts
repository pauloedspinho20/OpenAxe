export interface TrackSummary {
  id: number
  name: string
  instrument: string
  channel: number
  tuning: number[] // MIDI note numbers per string, low to high
  isPercussion: boolean
}

export interface TempoEntry {
  tick: number
  bpm: number
}

export interface ScoreSummary {
  title: string
  artist: string
  tracks: TrackSummary[]
  barCount: number
  tempoMap: TempoEntry[]
  durationTicks: number
  durationMillis: number
  ticksPerBeat: number
  // Opaque raw score for extractTrackEvents — not serialized, holds the parsed model.
  __raw?: unknown
}

export interface ScoreEvent {
  tick: number
  type: 'noteOn' | 'noteOff' | 'cc' | 'program' | 'pitchBend'
  channel: number
  key: number // note number / cc number / program / pitch value LSB
  value: number // velocity / cc value / pitch MSB / etc.
}

export interface ExtractOptions {
  ticksPerBeat?: number
}
