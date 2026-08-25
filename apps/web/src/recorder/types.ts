export type TakeSource = 'master' | 'dry' | 'song' | 'grid'

export interface Take {
  id: string
  name: string
  createdAt: number
  durationFrames: number
  sampleRate: number
  channels: number
  source: TakeSource
  // base64 of WAV file bytes (valid RIFF, for download and for clip feed)
  wavBase64: string
  // peak for display
  peak: number
}

export interface SessionState {
  id: string
  name: string
  createdAt: number
  mixer: Record<number, { gain: number; pan: number; muted: boolean; soloed: boolean }>
  songId: string | null
  takeIds: string[]
}
