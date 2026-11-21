/**
 * Renders a score to audio with alphaTab's synthesizer (its offline audio
 * exporter), so tabs play through the same core backing-track player as
 * audio files: the user's output device, pitch-preserving speed, transpose
 * and A-B loop all come for free, and alphaTab only follows the position
 * (PlayerMode.EnabledExternalMedia).
 */
import type { AlphaTabApi } from '@coderline/alphatab'
import { model, synth } from '@coderline/alphatab'

import type { DecodedTrack } from '../transport'

let soundFontPromise: Promise<Uint8Array> | null = null

/** alphaTab's bundled Sonivox GM SoundFont (Apache-2.0), copied into public/ by its Vite plugin. */
export function loadSoundFont(): Promise<Uint8Array> {
  soundFontPromise ??= fetch('/soundfont/sonivox.sf2')
    .then((r) => {
      if (!r.ok) throw new Error(`SoundFont download failed (${r.status})`)
      return r.arrayBuffer()
    })
    .then((b) => new Uint8Array(b))
    .catch((err) => {
      soundFontPromise = null
      throw err
    })
  return soundFontPromise
}

export interface RenderOptions {
  sampleRate: number
  /** Track index -> relative volume (0 mutes); tracks not listed play at 1. */
  trackVolume?: Map<number, number>
  metronome?: boolean
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
  /**
   * Play the song this much slower or faster (1 = as written): every tempo is
   * scaled while the synth's MIDI is built, then restored. The synth keeps
   * its pitch, unlike resampling.
   */
  tempoScale?: number
}

export async function renderScoreAudio(
  api: AlphaTabApi,
  opts: RenderOptions,
): Promise<DecodedTrack> {
  const options = new synth.AudioExportOptions()
  options.sampleRate = opts.sampleRate
  options.soundFonts = [await loadSoundFont()]
  options.useSyncPoints = false
  options.masterVolume = 1
  options.metronomeVolume = opts.metronome ? 1.2 : 0
  if (opts.trackVolume) options.trackVolume = opts.trackVolume
  const scale = opts.tempoScale ?? 1
  const score = api.score
  const restore: (() => void)[] = []
  if (score && scale !== 1) {
    // score.tempo is read-only (alphaTab derives it); a song without a tempo
    // change on bar 1 gets one for the render.
    const first = score.masterBars[0]
    if (first && !first.tempoAutomations.some((x) => x.ratioPosition === 0)) {
      const added = model.Automation.buildTempoAutomation(false, 0, score.tempo, 0)
      first.tempoAutomations.unshift(added)
      restore.push(() => {
        first.tempoAutomations.splice(first.tempoAutomations.indexOf(added), 1)
      })
    }
    for (const mb of score.masterBars)
      for (const a of mb.tempoAutomations) {
        const v = a.value
        a.value = v * scale
        restore.push(() => (a.value = v))
      }
  }
  let exporter: Awaited<ReturnType<AlphaTabApi['exportAudio']>>
  try {
    exporter = await api.exportAudio(options)
  } finally {
    for (const r of restore.reverse()) r()
  }
  const chunks: Float32Array[] = []
  let frames = 0
  try {
    for (;;) {
      if (opts.signal?.aborted) throw new DOMException('Render cancelled', 'AbortError')
      const chunk = await exporter.render(2000)
      if (!chunk) break
      chunks.push(chunk.samples)
      frames += chunk.samples.length / 2
      if (chunk.endTime > 0) opts.onProgress?.(Math.min(1, chunk.currentTime / chunk.endTime))
    }
  } finally {
    exporter.destroy()
  }
  // Interleaved stereo chunks -> planar channels.
  const left = new Float32Array(frames)
  const right = new Float32Array(frames)
  let at = 0
  for (const c of chunks) {
    for (let i = 0; i < c.length; i += 2) {
      left[at] = c[i]!
      right[at] = c[i + 1]!
      at++
    }
  }
  return { channels: [left, right], sampleRate: opts.sampleRate, frames }
}
