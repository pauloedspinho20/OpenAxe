import type { DecodedTrack } from './transport'

/** Audio formats the import picker offers (decodeAudioData decides what actually works). */
export const AUDIO_ACCEPT = '.mp3,.wav,.flac,.ogg,.oga,.m4a,.aac,.opus,.webm,audio/*'

/** Largest file the library accepts, so a stray video can't exhaust memory. */
export const MAX_AUDIO_BYTES = 200 * 1024 * 1024

/**
 * Decode an audio file with the platform decoder. An OfflineAudioContext
 * decodes without opening an audio device (which matters in the desktop
 * webview, where the app's audio goes through the native engine instead).
 * `sampleRate` is the rate to decode at - the engine's rate when known, so
 * the core can skip its rate conversion; the core compensates either way.
 */
export async function decodeAudio(bytes: ArrayBuffer, sampleRate = 48_000): Promise<DecodedTrack> {
  const Ctx =
    globalThis.OfflineAudioContext ??
    (globalThis as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext
  if (!Ctx) throw new Error('This browser cannot decode audio files')
  const ctx = new Ctx(2, 1, sampleRate)
  const buffer = await ctx.decodeAudioData(bytes.slice(0))
  const n = Math.min(2, buffer.numberOfChannels)
  const channels: Float32Array[] = []
  for (let c = 0; c < n; c++) channels.push(buffer.getChannelData(c))
  return { channels, sampleRate: buffer.sampleRate, frames: buffer.length }
}

/**
 * Min/max pairs for a waveform overview: `buckets` x [min, max], interleaved,
 * rounded to 3 decimals so they persist compactly.
 */
export function computePeaks(track: DecodedTrack, buckets = 1200): number[] {
  const out: number[] = []
  const size = Math.max(1, Math.floor(track.frames / buckets))
  for (let b = 0; b < buckets; b++) {
    const start = b * size
    if (start >= track.frames) break
    const end = Math.min(track.frames, start + size)
    let lo = 0
    let hi = 0
    for (const ch of track.channels) {
      for (let i = start; i < end; i++) {
        const v = ch[i]!
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
    }
    out.push(Math.round(lo * 1000) / 1000, Math.round(hi * 1000) / 1000)
  }
  return out
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const t = Math.floor((seconds * 10) % 10)
  return `${m}:${String(s).padStart(2, '0')}.${t}`
}
