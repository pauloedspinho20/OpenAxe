/**
 * Export a tab / score as a video (issue #459): renders the sheet with a hidden
 * alphaTab instance and encodes faster-than-real-time via WebCodecs +
 * mp4-muxer / webm-muxer when supported, falling back to MediaRecorder when
 * WebCodecs lacks a codec pair.
 */
import {
  AlphaTabApi,
  LayoutMode,
  model,
  PlayerMode,
  Settings,
  type StaveProfile,
} from '@coderline/alphatab'

import type { DecodedTrack } from '../transport'

export type VideoFormat = 'auto' | 'mp4' | 'webm'

export interface VideoSize {
  id: string
  label: string
  width: number
  height: number
}

export const VIDEO_SIZES: VideoSize[] = [
  { id: '1080p', label: '1920×1080 (HD landscape)', width: 1920, height: 1080 },
  { id: '720p', label: '1280×720 (720p landscape)', width: 1280, height: 720 },
  { id: '4k', label: '3840×2160 (4K landscape)', width: 3840, height: 2160 },
  { id: 'vertical', label: '1080×1920 (vertical: Shorts / Reels)', width: 1080, height: 1920 },
  { id: 'square', label: '1080×1080 (square)', width: 1080, height: 1080 },
]

export interface VideoOptions {
  width: number
  height: number
  fps: number
  /** Frame background (CSS colour). */
  background: string
  /** Sheet colours: light on dark instead of black on paper. */
  dark: boolean
  /** Paper colour behind the music (CSS colour); '' = transparent over the background. */
  paper: string
  /** Cursor / highlight colour. */
  accent: string
  /** alphaTab scale of the music. */
  scale: number
  layout: 'line' | 'page'
  profile: StaveProfile
  titleCard: boolean
  title: string
  subtitle: string
  /** Seconds of title card before the music. */
  titleSeconds: number
  /** Drawn over the background colour, scaled to cover the frame. */
  backgroundImage?: ImageBitmap | null
  /** Opacity of the sheet behind the music (0 = the background shows through). */
  paperOpacity?: number
  /** A fretboard under the music showing the notes of this track as they play. */
  fretboard?: { track: number; tunings: number[]; capo: number; maxFret: number } | null
  /** Container format for offline WebCodecs export (default 'auto'). */
  format?: VideoFormat
}

/** One played bar on the score timeline (repeats unrolled). */
export interface TimeSegment {
  start: number
  end: number
  tickStart: number
  tickEnd: number
}

/** Tick at score time `sec` (clamped to the song). */
export function tickAt(segments: readonly TimeSegment[], sec: number): number {
  if (!segments.length) return 0
  if (sec <= segments[0]!.start) return segments[0]!.tickStart
  for (const s of segments) {
    if (sec < s.end) {
      const f = (sec - s.start) / Math.max(1e-9, s.end - s.start)
      return s.tickStart + f * (s.tickEnd - s.tickStart)
    }
  }
  return segments.at(-1)!.tickEnd - 1
}

/** The best container this browser can record, or null. */
export function pickMime(): { mime: string; ext: 'mp4' | 'webm' } | null {
  if (typeof MediaRecorder === 'undefined') return null
  const options: { mime: string; ext: 'mp4' | 'webm' }[] = [
    { mime: 'video/mp4;codecs=avc1.640028,mp4a.40.2', ext: 'mp4' },
    { mime: 'video/mp4;codecs=avc1,mp4a', ext: 'mp4' },
    { mime: 'video/mp4', ext: 'mp4' },
    { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
    { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' },
  ]
  return options.find((o) => MediaRecorder.isTypeSupported(o.mime)) ?? null
}

/** H.264/AVC codec strings ordered by preference for the target resolution/fps. */
export function avcCodecCandidates(width: number, height: number, fps: number): string[] {
  const pixels = width * height
  if (pixels > 2_097_152) {
    return fps > 30
      ? ['avc1.640034', 'avc1.4d0034', 'avc1.640033']
      : ['avc1.640033', 'avc1.640034', 'avc1.4d0033', 'avc1.420033']
  }
  if (pixels >= 1_900_000 && fps > 30) {
    return ['avc1.64002a', 'avc1.4d002a', 'avc1.640028', 'avc1.420028']
  }
  return ['avc1.640028', 'avc1.4d0028', 'avc1.42001f']
}

/** VP9/VP8 WebCodecs + Matroska muxer codec candidates for WebM export. */
export function vpCodecCandidates(
  width: number,
  height: number,
): { codec: string; muxerCodec: 'V_VP9' | 'V_VP8' }[] {
  return [
    {
      codec: width * height > 2_097_152 ? 'vp09.00.51.08' : 'vp09.00.41.08',
      muxerCodec: 'V_VP9',
    },
    { codec: 'vp8', muxerCodec: 'V_VP8' },
  ]
}

/**
 * Pad `track` with `leadSeconds` of silence at the front and silence at the tail
 * to reach `totalSeconds`, so offline audio starts cleanly at timestamp 0.
 */
export function padAudioForVideo(
  track: DecodedTrack,
  leadSeconds: number,
  totalSeconds: number,
): DecodedTrack {
  const sr = track.sampleRate
  const leadFrames = Math.max(0, Math.round(leadSeconds * sr))
  const totalFrames = Math.max(leadFrames + track.frames, Math.round(totalSeconds * sr))
  const channels = track.channels.map((ch) => {
    const out = new Float32Array(totalFrames)
    out.set(ch, leadFrames)
    return out
  })
  return { channels, sampleRate: sr, frames: totalFrames }
}

/** Pack `[offset, offset + count)` of planar channels into contiguous `'f32-planar'` data. */
export function packPlanarFloat32(
  channels: readonly Float32Array[],
  offset: number,
  count: number,
): Float32Array<ArrayBuffer> {
  const out = new Float32Array(channels.length * count)
  for (let c = 0; c < channels.length; c++) {
    out.set(channels[c]!.subarray(offset, offset + count), c * count)
  }
  return out
}

export interface WebCodecsTarget {
  container: 'mp4' | 'webm'
  mime: string
  videoConfig: VideoEncoderConfig
  audioConfig: AudioEncoderConfig | null
  muxerVideoCodec: 'avc' | 'V_VP9' | 'V_VP8'
  muxerAudioCodec: 'aac' | 'A_OPUS' | null
}

/** Probe WebCodecs for a supported video+audio encoder pair for the chosen container. */
export async function pickWebCodecsTarget(opts: {
  width: number
  height: number
  fps: number
  hasAudio: boolean
  sampleRate: number
  channels: number
  format?: VideoFormat
}): Promise<WebCodecsTarget | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null
  if (opts.hasAudio && (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined')) {
    return null
  }
  const width = Math.max(2, opts.width & ~1)
  const height = Math.max(2, opts.height & ~1)
  const bitrate = Math.min(
    25_000_000,
    Math.max(2_000_000, Math.round(width * height * opts.fps * 0.12)),
  )
  const fmt = opts.format ?? 'auto'

  const testVideo = async (cfg: VideoEncoderConfig): Promise<VideoEncoderConfig | null> => {
    try {
      const res = await VideoEncoder.isConfigSupported(cfg)
      return res.supported ? (res.config ?? cfg) : null
    } catch {
      return null
    }
  }
  const testAudio = async (cfg: AudioEncoderConfig): Promise<AudioEncoderConfig | null> => {
    try {
      const res = await AudioEncoder.isConfigSupported(cfg)
      return res.supported ? (res.config ?? cfg) : null
    } catch {
      return null
    }
  }

  if (fmt === 'auto' || fmt === 'mp4') {
    let audioCfg: AudioEncoderConfig | null = null
    let audioOk = !opts.hasAudio
    if (opts.hasAudio) {
      audioCfg = await testAudio({
        codec: 'mp4a.40.2',
        sampleRate: opts.sampleRate,
        numberOfChannels: opts.channels,
        bitrate: 192_000,
      })
      audioOk = audioCfg !== null
    }
    if (audioOk) {
      for (const codec of avcCodecCandidates(width, height, opts.fps)) {
        const videoCfg = await testVideo({
          codec,
          width,
          height,
          bitrate,
          framerate: opts.fps,
          hardwareAcceleration: 'no-preference',
          avc: { format: 'avc' },
        })
        if (videoCfg) {
          return {
            container: 'mp4',
            mime: 'video/mp4',
            videoConfig: videoCfg,
            audioConfig: audioCfg,
            muxerVideoCodec: 'avc',
            muxerAudioCodec: audioCfg ? 'aac' : null,
          }
        }
      }
    }
  }

  if (fmt === 'auto' || fmt === 'webm') {
    let audioCfg: AudioEncoderConfig | null = null
    let audioOk = !opts.hasAudio
    if (opts.hasAudio) {
      audioCfg = await testAudio({
        codec: 'opus',
        sampleRate: opts.sampleRate,
        numberOfChannels: opts.channels,
        bitrate: 128_000,
      })
      audioOk = audioCfg !== null
    }
    if (audioOk) {
      for (const cand of vpCodecCandidates(width, height)) {
        const videoCfg = await testVideo({
          codec: cand.codec,
          width,
          height,
          bitrate,
          framerate: opts.fps,
          hardwareAcceleration: 'no-preference',
        })
        if (videoCfg) {
          return {
            container: 'webm',
            mime: 'video/webm',
            videoConfig: videoCfg,
            audioConfig: audioCfg,
            muxerVideoCodec: cand.muxerCodec,
            muxerAudioCodec: audioCfg ? 'A_OPUS' : null,
          }
        }
      }
    }
  }

  return null
}

export interface ExportCapabilities {
  offline: boolean
  mp4: boolean
  webm: boolean
  realtime: { mime: string; ext: 'mp4' | 'webm' } | null
}

/** Detect offline WebCodecs container support and real-time MediaRecorder fallback. */
export async function detectExportCapabilities(): Promise<ExportCapabilities> {
  const [mp4, webm] = await Promise.all([
    pickWebCodecsTarget({
      width: 1920,
      height: 1080,
      fps: 30,
      hasAudio: true,
      sampleRate: 48_000,
      channels: 2,
      format: 'mp4',
    }),
    pickWebCodecsTarget({
      width: 1920,
      height: 1080,
      fps: 30,
      hasAudio: true,
      sampleRate: 48_000,
      channels: 2,
      format: 'webm',
    }),
  ])
  return {
    offline: !!(mp4 || webm),
    mp4: !!mp4,
    webm: !!webm,
    realtime: pickMime(),
  }
}

const INK = {
  staffLineColor: '#8C877C',
  barSeparatorColor: '#B9B3A6',
  barNumberColor: '#E8836A',
  mainGlyphColor: '#ECE8DE',
  secondaryGlyphColor: '#ECE8DE99',
  scoreInfoColor: '#ECE8DE',
}

interface Partial {
  canvas: HTMLCanvasElement
  x: number
  y: number
  w: number
  h: number
}

let musicFont: Promise<string> | null = null

/** alphaTab's music font as a data URL, to embed in the SVGs we rasterise. */
function musicFontUrl(): Promise<string> {
  musicFont ??= fetch('/font/Bravura.woff2')
    .then((r) => {
      if (!r.ok) throw new Error(`Music font download failed (${r.status})`)
      return r.blob()
    })
    .then(
      (b) =>
        new Promise<string>((resolve, reject) => {
          const fr = new FileReader()
          fr.onload = () => resolve(String(fr.result).replace(/^data:[^;]*;/, 'data:font/woff2;'))
          fr.onerror = () => reject(fr.error ?? new Error('Could not read the music font'))
          fr.readAsDataURL(b)
        }),
    )
    .catch((err: unknown) => {
      musicFont = null
      throw err
    })
  return musicFont
}

/** An SVG partial as a canvas (fonts embedded: an SVG image can't load page fonts). */
async function rasterise(
  svg: SVGSVGElement,
  w: number,
  h: number,
  css: string,
): Promise<HTMLCanvasElement> {
  const copy = svg.cloneNode(true) as SVGSVGElement
  copy.setAttribute('width', String(w))
  copy.setAttribute('height', String(h))
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = css
  copy.insertBefore(style, copy.firstChild)
  const xml = new XMLSerializer().serializeToString(copy)
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`
  await img.decode()
  const c = document.createElement('canvas')
  c.width = Math.ceil(w)
  c.height = Math.ceil(h)
  c.getContext('2d')!.drawImage(img, 0, 0, w, h)
  return c
}

/**
 * Render the tracks with alphaTab (its SVG engine - the one the app shows) in
 * a hidden container, then turn each part into a canvas to draw frames from.
 */
async function renderSheet(
  tracks: model.Track[],
  o: VideoOptions,
): Promise<{ api: AlphaTabApi; host: HTMLDivElement; partials: Partial[]; width: number }> {
  const font = await musicFontUrl()
  const host = document.createElement('div')
  // Laid out (alphaTab measures it) but off screen.
  host.style.cssText = `position:fixed;left:-200000px;top:0;width:${o.layout === 'page' ? o.width : 4000}px;`
  document.body.appendChild(host)
  const settings = new Settings()
  settings.core.useWorkers = false
  settings.core.enableLazyLoading = false
  settings.core.fontDirectory = '/font/'
  settings.display.layoutMode = o.layout === 'page' ? LayoutMode.Page : LayoutMode.Horizontal
  settings.display.scale = o.scale
  settings.display.staveProfile = o.profile
  settings.display.padding = [Math.round(o.width * 0.04), Math.round(o.height * 0.05)]
  settings.player.playerMode = PlayerMode.Disabled
  if (o.dark) {
    const r = settings.display.resources as unknown as Record<string, model.Color>
    for (const [k, v] of Object.entries(INK)) r[k] = model.Color.fromJson(v) ?? r[k]!
  }
  const api = new AlphaTabApi(host, settings)
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The sheet took too long to render')), 60_000)
      api.postRenderFinished.on(() => {
        clearTimeout(timer)
        resolve()
      })
      api.error.on((e) => {
        clearTimeout(timer)
        reject(e instanceof Error ? e : new Error(String(e)))
      })
      api.renderTracks(tracks)
    })
    // alphaTab's own glyph styles (see its .at rules), with the font inlined.
    const css =
      `@font-face{font-family:alphaTab;src:url(${font}) format('woff2');}` +
      '.at{font-family:alphaTab;font-style:normal;font-weight:normal;line-height:1;font-size:36px;}' +
      'text{dominant-baseline:alphabetic;white-space:pre;}'
    const base = host.getBoundingClientRect()
    const svgs = [...host.querySelectorAll<SVGSVGElement>('svg')]
    const partials: Partial[] = []
    for (const svg of svgs) {
      const r = svg.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) continue
      partials.push({
        canvas: await rasterise(svg, r.width, r.height, css),
        x: r.left - base.left,
        y: r.top - base.top,
        w: r.width,
        h: r.height,
      })
    }
    const width = Math.max(0, ...partials.map((p) => p.x + p.w))
    return { api, host, partials, width }
  } catch (err) {
    api.destroy()
    host.remove()
    throw err
  }
}

export interface VideoInput {
  score: model.Score
  tracks: model.Track[]
  /** The main view's tick lookup (beats are shared - same score object). */
  tickCache: NonNullable<AlphaTabApi['tickCache']>
  segments: TimeSegment[]
  /** Audio to record (null = silent video). */
  audio: DecodedTrack | null
  /** Audio time -> score time (a synced recording; identity for the synth). */
  toScore: (sec: number) => number
  /** Length of the music in audio seconds. */
  duration: number
}

interface FrameRenderer {
  canvas: HTMLCanvasElement
  drawFrame: (t: number) => void
  lead: number
  total: number
}

function createFrameRenderer(
  input: VideoInput,
  o: VideoOptions,
  api: AlphaTabApi,
  partials: Partial[],
  sheetW: number,
  width: number,
  height: number,
): FrameRenderer {
  const lookup = api.boundsLookup
  const trackSet = new Set(input.tracks.map((t) => t.index))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g = canvas.getContext('2d')!

  let camX = 0
  let camY = 0
  let first = true
  let lastT = 0
  const lead = o.titleCard ? o.titleSeconds : 0
  const total = lead + input.duration + 0.4

  const fb = o.fretboard ?? null
  const musicH = fb ? Math.round(height * 0.74) : height
  const paperAlpha = o.paperOpacity ?? 1
  const fbTrack = fb ? new Set([fb.track]) : null

  const drawTitle = (alpha: number) => {
    g.save()
    g.globalAlpha = alpha
    g.fillStyle = o.paper && paperAlpha > 0.5 ? contrast(o.paper) : contrast(o.background)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const unit = Math.min(width, height)
    g.font = `700 ${Math.round(unit * 0.075)}px Georgia, serif`
    g.fillText(o.title, width / 2, height / 2 - unit * 0.04)
    g.font = `400 ${Math.round(unit * 0.035)}px Georgia, serif`
    g.fillText(o.subtitle, width / 2, height / 2 + unit * 0.05)
    g.restore()
  }

  const drawBackground = () => {
    g.fillStyle = o.background
    g.fillRect(0, 0, width, height)
    const img = o.backgroundImage
    if (img) {
      // Cover: fill the frame, crop the overflow, keep the aspect ratio.
      const k = Math.max(width / img.width, height / img.height)
      const w = img.width * k
      const h = img.height * k
      g.drawImage(img, (width - w) / 2, (height - h) / 2, w, h)
    }
  }

  // alphaTab's attribution, on every frame.
  const drawAttribution = () => {
    g.save()
    g.font = `${Math.round(Math.min(width, height) * 0.018)}px sans-serif`
    g.fillStyle = withAlpha(contrast(fb ? '#2c2016' : o.paper || o.background), 0.6)
    g.textAlign = 'right'
    g.textBaseline = 'bottom'
    g.fillText('♪ alphaTab.net', width - 12, height - 10)
    g.restore()
  }

  const drawFrame = (t: number) => {
    drawBackground()
    if (t < lead) {
      if (o.paper && paperAlpha > 0) {
        g.fillStyle = withAlpha(o.paper, paperAlpha)
        const bandH = Math.min(width, height) * 0.32
        g.fillRect(0, height / 2 - bandH / 2, width, bandH)
      }
      drawTitle(Math.min(1, t / 0.4, (lead - t) / 0.4))
      drawAttribution()
      return
    }
    const scoreSec = input.toScore(t - lead)
    const tick = tickAt(input.segments, scoreSec)
    const found = input.tickCache.findBeat(trackSet, tick)
    const bb = found ? lookup?.findBeat(found.beat) : null
    const mbb = bb?.barBounds.masterBarBounds
    const sys = mbb?.staffSystemBounds?.realBounds
    let x = bb ? bb.visualBounds.x : 0
    if (found && bb) {
      const next = found.nextBeat ? lookup?.findBeat(found.nextBeat.beat) : null
      // Glide toward the next beat when it's further along the same line; at a
      // line end or a repeat (the next beat jumps back) glide to the bar's end.
      const ahead =
        next &&
        next.barBounds.masterBarBounds.staffSystemBounds === mbb!.staffSystemBounds &&
        next.visualBounds.x > x
      const endX = ahead ? next.visualBounds.x : mbb!.visualBounds.x + mbb!.visualBounds.w
      const f = Math.min(1, Math.max(0, (tick - found.start) / Math.max(1, found.tickDuration)))
      x += (endX - x) * f
    }
    // Camera: the line keeps the cursor centred; pages show the current system near the top.
    let wantX = 0
    let wantY = 0
    if (o.layout === 'line') {
      wantX = Math.min(Math.max(0, x - width / 2), Math.max(0, sheetW - width))
      wantY = sys ? sys.y + sys.h / 2 - musicH / 2 : 0
    } else {
      wantY = sys ? Math.max(0, sys.y - musicH * 0.12) : 0
    }
    if (first) {
      camX = wantX
      camY = wantY
      lastT = t
      first = false
    } else {
      const dt = Math.max(0, t - lastT)
      lastT = t
      const lineA = 1 - Math.pow(0.5, dt * 30)
      const pageA = 1 - Math.pow(0.82, dt * 30)
      camX += (wantX - camX) * (o.layout === 'line' ? lineA : pageA)
      camY += (wantY - camY) * pageA
    }
    g.save()
    g.beginPath()
    g.rect(0, 0, width, musicH)
    g.clip()
    // The sheet: a band behind the line, or the whole music area for pages.
    if (o.paper && paperAlpha > 0) {
      g.fillStyle = withAlpha(o.paper, paperAlpha)
      if (o.layout === 'line' && sys) {
        const pad = musicH * 0.06
        g.fillRect(0, sys.y - camY - pad, width, sys.h + 2 * pad)
      } else g.fillRect(0, 0, width, musicH)
    }
    if (mbb) {
      const r = mbb.visualBounds
      g.fillStyle = withAlpha(o.accent, 0.12)
      g.fillRect(r.x - camX, r.y - camY, r.w, r.h)
    }
    for (const p of partials) {
      if (p.x + p.w < camX || p.x > camX + width || p.y + p.h < camY || p.y > camY + musicH)
        continue
      g.drawImage(p.canvas, p.x - camX, p.y - camY, p.w, p.h)
    }
    if (mbb) {
      const r = mbb.visualBounds
      g.fillStyle = o.accent
      g.fillRect(Math.round(x - camX) - 1, r.y - camY, 3, r.h)
    }
    g.restore()
    if (fb && fbTrack) {
      const beat = input.tickCache.findBeat(fbTrack, tick)?.beat
      const notes = (beat?.notes ?? []).map((n) => ({ string: n.string, fret: n.fret }))
      drawFretboard(g, 0, musicH, width, height - musicH, fb, notes, o.accent)
    }
    drawAttribution()
  }

  return { canvas, drawFrame, lead, total }
}

function waitQueue(encoder: VideoEncoder | AudioEncoder, limit: number) {
  if (encoder.encodeQueueSize <= limit) return Promise.resolve()
  return new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      encoder.ondequeue = null
      resolve()
    }
    const timer = setTimeout(finish, 16)
    encoder.ondequeue = finish
  })
}

export interface OfflineEncodeInput {
  canvas: CanvasImageSource
  drawFrame: (t: number) => void
  lead: number
  total: number
  fps: number
  width: number
  height: number
  audio: DecodedTrack | null
  target: WebCodecsTarget
  onProgress: (f: number) => void
  signal: AbortSignal
}

/**
 * Encode `drawFrame` + `audio` faster than real time using WebCodecs and mux
 * into MP4 (`mp4-muxer`) or WebM (`webm-muxer`).
 */
export async function runOfflineEncode(
  p: OfflineEncodeInput,
): Promise<{ blob: Blob; ext: 'mp4' | 'webm' }> {
  const { target, width, height, fps, lead, total, signal, onProgress } = p
  const audioCfg = target.audioConfig
  let encoderErr: Error | null = null
  const onError = (e: unknown) => {
    encoderErr ??= e instanceof Error ? e : new Error(String(e))
  }

  const checkAbort = () => {
    if (signal.aborted) throw new DOMException('Video export cancelled', 'AbortError')
    if (encoderErr) throw encoderErr
  }

  let videoEncoder: VideoEncoder | null = null
  let audioEncoder: AudioEncoder | null = null

  try {
    let buffer: ArrayBuffer
    let finalize: () => void
    let addVideo: (chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => void
    let addAudio: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => void

    if (target.container === 'mp4') {
      const { Muxer, ArrayBufferTarget } = await import('mp4-muxer')
      const muxTarget = new ArrayBufferTarget()
      const muxer = new Muxer({
        target: muxTarget,
        video: { codec: 'avc', width, height, frameRate: fps },
        ...(audioCfg && target.muxerAudioCodec
          ? {
              audio: {
                codec: target.muxerAudioCodec as 'aac' | 'opus',
                numberOfChannels: audioCfg.numberOfChannels,
                sampleRate: audioCfg.sampleRate,
              },
            }
          : {}),
        fastStart: 'in-memory',
        firstTimestampBehavior: 'offset',
      })
      addVideo = (chunk, meta) => muxer.addVideoChunk(chunk, meta)
      addAudio = (chunk, meta) => muxer.addAudioChunk(chunk, meta)
      finalize = () => {
        muxer.finalize()
        buffer = muxTarget.buffer
      }
    } else {
      const { Muxer, ArrayBufferTarget } = await import('webm-muxer')
      const muxTarget = new ArrayBufferTarget()
      const muxer = new Muxer({
        target: muxTarget,
        video: { codec: target.muxerVideoCodec, width, height, frameRate: fps },
        ...(audioCfg && target.muxerAudioCodec
          ? {
              audio: {
                codec: target.muxerAudioCodec,
                numberOfChannels: audioCfg.numberOfChannels,
                sampleRate: audioCfg.sampleRate,
              },
            }
          : {}),
        firstTimestampBehavior: 'offset',
      })
      addVideo = (chunk, meta) => muxer.addVideoChunk(chunk, meta)
      addAudio = (chunk, meta) => muxer.addAudioChunk(chunk, meta)
      finalize = () => {
        muxer.finalize()
        buffer = muxTarget.buffer
      }
    }

    videoEncoder = new VideoEncoder({
      output: (chunk, meta) => addVideo(chunk, meta),
      error: onError,
    })
    videoEncoder.configure(target.videoConfig)

    const audioWeight = p.audio && audioCfg ? 0.1 : 0
    if (p.audio && audioCfg) {
      audioEncoder = new AudioEncoder({
        output: (chunk, meta) => addAudio(chunk, meta),
        error: onError,
      })
      audioEncoder.configure(audioCfg)
      const padded = padAudioForVideo(p.audio, lead, total)
      const sr = padded.sampleRate
      const chCount = padded.channels.length
      const chunkFrames = 4096
      for (let at = 0; at < padded.frames; at += chunkFrames) {
        checkAbort()
        const count = Math.min(chunkFrames, padded.frames - at)
        const ad = new AudioData({
          format: 'f32-planar',
          sampleRate: sr,
          numberOfFrames: count,
          numberOfChannels: chCount,
          timestamp: Math.round((at * 1_000_000) / sr),
          data: packPlanarFloat32(padded.channels, at, count),
        })
        audioEncoder.encode(ad)
        ad.close()
        if (audioEncoder.encodeQueueSize > 16) await waitQueue(audioEncoder, 8)
        onProgress(audioWeight * Math.min(1, (at + count) / padded.frames))
      }
      checkAbort()
      await audioEncoder.flush()
    }

    const totalFrames = Math.max(1, Math.ceil(total * fps))
    const keyEvery = Math.max(1, Math.round(fps * 2))
    const frameDurUs = Math.round(1_000_000 / fps)
    let lastYield = typeof performance !== 'undefined' ? performance.now() : Date.now()

    for (let i = 0; i < totalFrames; i++) {
      checkAbort()
      p.drawFrame(i / fps)
      const frame = new VideoFrame(p.canvas, {
        timestamp: Math.round((i * 1_000_000) / fps),
        duration: frameDurUs,
      })
      videoEncoder.encode(frame, { keyFrame: i % keyEvery === 0 })
      frame.close()
      if (videoEncoder.encodeQueueSize > 8) await waitQueue(videoEncoder, 4)
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
      if (now - lastYield >= 16) {
        onProgress(audioWeight + (1 - audioWeight - 0.02) * ((i + 1) / totalFrames))
        await new Promise<void>((r) => setTimeout(r, 0))
        lastYield = typeof performance !== 'undefined' ? performance.now() : Date.now()
      }
    }

    checkAbort()
    await videoEncoder.flush()
    checkAbort()
    finalize()
    onProgress(1)
    return { blob: new Blob([buffer!], { type: target.mime }), ext: target.container }
  } finally {
    if (videoEncoder && videoEncoder.state !== 'closed') videoEncoder.close()
    if (audioEncoder && audioEncoder.state !== 'closed') audioEncoder.close()
  }
}

async function recordRealtime(
  input: VideoInput,
  o: VideoOptions,
  renderer: FrameRenderer,
  format: { mime: string; ext: 'mp4' | 'webm' },
  onProgress: (f: number) => void,
  signal: AbortSignal,
): Promise<{ blob: Blob; ext: 'mp4' | 'webm' }> {
  const { canvas, drawFrame, lead, total } = renderer
  const audioCtx = new AudioContext({ sampleRate: input.audio?.sampleRate ?? 48_000 })
  const dest = audioCtx.createMediaStreamDestination()
  const stream = new MediaStream([
    ...canvas.captureStream(o.fps).getVideoTracks(),
    ...(input.audio ? dest.stream.getAudioTracks() : []),
  ])
  const recorder = new MediaRecorder(stream, {
    mimeType: format.mime,
    videoBitsPerSecond: Math.round(canvas.width * canvas.height * o.fps * 0.12),
  })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)

  try {
    drawFrame(0)
    const done = new Promise<Blob>((resolve) => {
      recorder.onstop = () =>
        resolve(new Blob(chunks, { type: format.mime.split(';')[0] ?? format.mime }))
    })
    await audioCtx.resume()
    recorder.start(1000)
    const t0 = audioCtx.currentTime + 0.05
    if (input.audio) {
      const buf = audioCtx.createBuffer(
        input.audio.channels.length,
        input.audio.frames,
        input.audio.sampleRate,
      )
      input.audio.channels.forEach((ch, i) => buf.copyToChannel(ch as Float32Array<ArrayBuffer>, i))
      const src = audioCtx.createBufferSource()
      src.buffer = buf
      src.connect(dest)
      src.start(t0 + lead)
    }
    await new Promise<void>((resolve, reject) => {
      // A timer, not requestAnimationFrame: keeps going when the page isn't painted.
      const step = () => {
        if (signal.aborted) {
          reject(new DOMException('Video export cancelled', 'AbortError'))
          return
        }
        const t = audioCtx.currentTime - t0
        drawFrame(Math.max(0, t))
        onProgress(Math.min(1, Math.max(0, t / total)))
        if (t >= total) resolve()
        else setTimeout(step, 1000 / o.fps / 2)
      }
      step()
    })
    recorder.stop()
    const blob = await done
    return { blob, ext: format.ext }
  } catch (err) {
    if (recorder.state !== 'inactive') recorder.stop()
    throw err
  } finally {
    void audioCtx.close()
    for (const tr of stream.getTracks()) tr.stop()
  }
}

/**
 * Render and encode the video: uses offline WebCodecs + muxer when supported,
 * falling back to real-time MediaRecorder otherwise.
 */
export async function recordVideo(
  input: VideoInput,
  o: VideoOptions,
  onProgress: (f: number) => void,
  signal: AbortSignal,
): Promise<{ blob: Blob; ext: 'mp4' | 'webm' }> {
  const width = Math.max(2, o.width & ~1)
  const height = Math.max(2, o.height & ~1)
  const target = await pickWebCodecsTarget({
    width,
    height,
    fps: o.fps,
    hasAudio: !!input.audio,
    sampleRate: input.audio?.sampleRate ?? 48_000,
    channels: input.audio?.channels.length ?? 2,
    format: o.format ?? 'auto',
  })
  const fallback = target ? null : pickMime()
  if (!target && !fallback) {
    throw new Error(
      'This browser cannot export video (WebCodecs and MediaRecorder are unavailable).',
    )
  }

  const { api, host, partials, width: sheetW } = await renderSheet(input.tracks, o)
  try {
    const renderer = createFrameRenderer(input, o, api, partials, sheetW, width, height)
    if (target) {
      return await runOfflineEncode({
        canvas: renderer.canvas,
        drawFrame: renderer.drawFrame,
        lead: renderer.lead,
        total: renderer.total,
        fps: o.fps,
        width,
        height,
        audio: input.audio,
        target,
        onProgress,
        signal,
      })
    }
    return await recordRealtime(input, o, renderer, fallback!, onProgress, signal)
  } finally {
    api.destroy()
    host.remove()
  }
}

function withAlpha(css: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(css)
  if (!m) return css
  const n = parseInt(m[1]!, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

/** Black or white, whichever reads on `css` (a #rrggbb colour). */
export function contrast(css: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(css)
  if (!m) return '#111111'
  const n = parseInt(m[1]!, 16)
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)
  return lum > 140 ? '#111111' : '#F4F1EA'
}

/** `track` cut to [from, to] seconds, with 5 ms fades at the cut edges. */
export function sliceAudio(track: DecodedTrack, from: number, to: number): DecodedTrack {
  const sr = track.sampleRate
  const a = Math.max(0, Math.min(track.frames, Math.round(from * sr)))
  const b = Math.max(a, Math.min(track.frames, Math.round(to * sr)))
  const fade = Math.max(1, Math.round(0.005 * sr))
  const channels = track.channels.map((ch) => {
    const out = ch.slice(a, b)
    for (let i = 0; i < Math.min(fade, out.length); i++) {
      out[i]! *= i / fade
      out[out.length - 1 - i]! *= i / fade
    }
    return out
  })
  return { channels, sampleRate: sr, frames: b - a }
}

/** `beats` metronome clicks `interval` seconds apart (accent on the first), then `track`. */
export function withCountIn(track: DecodedTrack, beats: number, interval: number): DecodedTrack {
  const sr = track.sampleRate
  const lead = Math.round(beats * interval * sr)
  const clickLen = Math.round(0.05 * sr)
  const channels = track.channels.map((ch) => {
    const out = new Float32Array(lead + ch.length)
    for (let b = 0; b < beats; b++) {
      const at = Math.round(b * interval * sr)
      const freq = b === 0 ? 1600 : 1100
      for (let i = 0; i < clickLen && at + i < lead; i++)
        out[at + i] = 0.5 * Math.sin((2 * Math.PI * freq * i) / sr) * Math.exp(-i / (0.008 * sr))
    }
    out.set(ch, lead)
    return out
  })
  return { channels, sampleRate: sr, frames: lead + track.frames }
}

/** Silence of `seconds` (a video with no audio still needs a count-in's time). */
export function silence(seconds: number, sampleRate = 48_000, channels = 2): DecodedTrack {
  const frames = Math.round(seconds * sampleRate)
  return {
    channels: Array.from({ length: channels }, () => new Float32Array(frames)),
    sampleRate,
    frames,
  }
}

const INLAYS = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24]

/** A fretboard with the playing notes (strings: 1 = lowest, drawn at the bottom). */
function drawFretboard(
  g: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  w: number,
  h: number,
  fb: { tunings: number[]; capo: number; maxFret: number },
  notes: { string: number; fret: number }[],
  accent: string,
): void {
  const strings = fb.tunings.length
  const padX = w * 0.04
  const padY = h * 0.14
  const left = x0 + padX * 1.6
  const right = x0 + w - padX
  // The neck, with a row under it for the fret numbers.
  const top = y0 + h * 0.12
  const bottom = y0 + h * 0.7
  const frets = fb.maxFret
  const fretX = (f: number) => left + ((right - left) * f) / frets
  const stringY = (s: number) => bottom - ((bottom - top) * (s - 1)) / Math.max(1, strings - 1)
  g.save()
  // Neck.
  const wood = g.createLinearGradient(0, top, 0, bottom)
  wood.addColorStop(0, '#3a2a1c')
  wood.addColorStop(1, '#2c2016')
  g.fillStyle = wood
  g.fillRect(left, top - padY * 0.5, right - left, bottom - top + padY)
  // Inlays.
  g.fillStyle = 'rgba(236, 232, 222, 0.35)'
  const mid = (top + bottom) / 2
  const r = Math.min(h * 0.05, (fretX(1) - fretX(0)) * 0.18)
  for (const f of INLAYS) {
    if (f > frets) continue
    const cx = (fretX(f - 1) + fretX(f)) / 2
    if (f % 12 === 0) {
      g.beginPath()
      g.arc(cx, mid - (bottom - top) * 0.22, r, 0, Math.PI * 2)
      g.arc(cx, mid + (bottom - top) * 0.22, r, 0, Math.PI * 2)
      g.fill()
    } else {
      g.beginPath()
      g.arc(cx, mid, r, 0, Math.PI * 2)
      g.fill()
    }
  }
  // Capo.
  if (fb.capo > 0 && fb.capo <= frets) {
    g.fillStyle = 'rgba(0, 0, 0, 0.45)'
    g.fillRect(fretX(fb.capo) - 6, top - padY * 0.5, 12, bottom - top + padY)
  }
  // Frets and nut.
  for (let f = 0; f <= frets; f++) {
    g.fillStyle = f === 0 ? '#e9e4d6' : '#b9b3a6'
    g.fillRect(fretX(f) - (f === 0 ? 3 : 1), top - padY * 0.5, f === 0 ? 6 : 2, bottom - top + padY)
  }
  // Strings, thicker toward the low end.
  for (let s = 1; s <= strings; s++) {
    g.fillStyle = '#d9d2c0'
    const thick = 1 + (strings - s) * 0.35
    g.fillRect(left, stringY(s) - thick / 2, right - left, thick)
  }
  // Fret numbers.
  g.fillStyle = 'rgba(236, 232, 222, 0.7)'
  g.font = `${Math.round(h * 0.075)}px sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'top'
  for (const f of INLAYS)
    if (f <= frets) g.fillText(String(f), (fretX(f - 1) + fretX(f)) / 2, bottom + h * 0.12)
  // Playing notes.
  const dot = Math.min(h * 0.075, (fretX(1) - fretX(0)) * 0.36)
  g.font = `700 ${Math.round(dot * 1.1)}px sans-serif`
  g.textBaseline = 'middle'
  for (const n of notes) {
    if (n.string < 1 || n.string > strings || n.fret > frets) continue
    const cx = n.fret === 0 ? left - padX * 0.7 : (fretX(n.fret - 1) + fretX(n.fret)) / 2
    const cy = stringY(n.string)
    g.beginPath()
    g.arc(cx, cy, dot, 0, Math.PI * 2)
    if (n.fret === 0) {
      g.strokeStyle = accent
      g.lineWidth = 3
      g.stroke()
    } else {
      g.fillStyle = accent
      g.fill()
      g.fillStyle = '#fff'
      g.fillText(String(n.fret), cx, cy + 1)
    }
  }
  g.restore()
}
