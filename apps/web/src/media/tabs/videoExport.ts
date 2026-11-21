/**
 * Export a tab / score as a video (issue #459, first version).
 *
 * The song is rendered once by a hidden alphaTab instance (SVG, rasterised
 * once); each video frame then draws the visible part of those images,
 * the playing bar and a cursor, with the camera following playback. Frames
 * and the audio are recorded in real time with MediaRecorder (no encoder
 * dependency), so an export takes as long as the song plus the title card.
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

/**
 * Record the video. Resolves with the file; rejects (AbortError) when
 * `signal` aborts. `onProgress` gets 0..1.
 */
export async function recordVideo(
  input: VideoInput,
  o: VideoOptions,
  onProgress: (f: number) => void,
  signal: AbortSignal,
): Promise<{ blob: Blob; ext: 'mp4' | 'webm' }> {
  const format = pickMime()
  if (!format) throw new Error('This browser cannot record video (MediaRecorder is missing).')
  const { api, host, partials, width: sheetW } = await renderSheet(input.tracks, o)
  const lookup = api.boundsLookup
  const trackSet = new Set(input.tracks.map((t) => t.index))
  const canvas = document.createElement('canvas')
  canvas.width = o.width
  canvas.height = o.height
  const g = canvas.getContext('2d')!
  const audioCtx = new AudioContext({ sampleRate: input.audio?.sampleRate ?? 48_000 })
  const dest = audioCtx.createMediaStreamDestination()
  const stream = new MediaStream([
    ...canvas.captureStream(o.fps).getVideoTracks(),
    ...(input.audio ? dest.stream.getAudioTracks() : []),
  ])
  const recorder = new MediaRecorder(stream, {
    mimeType: format.mime,
    videoBitsPerSecond: Math.round(o.width * o.height * o.fps * 0.12),
  })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)

  let camX = 0
  let camY = 0
  let first = true
  const lead = o.titleCard ? o.titleSeconds : 0
  const total = lead + input.duration + 0.4

  const drawTitle = (alpha: number) => {
    g.save()
    g.globalAlpha = alpha
    g.fillStyle = o.dark ? '#ECE8DE' : '#111111'
    if (!o.paper) g.fillStyle = contrast(o.background)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const unit = Math.min(o.width, o.height)
    g.font = `700 ${Math.round(unit * 0.075)}px Georgia, serif`
    g.fillText(o.title, o.width / 2, o.height / 2 - unit * 0.04)
    g.font = `400 ${Math.round(unit * 0.035)}px Georgia, serif`
    g.fillText(o.subtitle, o.width / 2, o.height / 2 + unit * 0.05)
    g.restore()
  }

  const drawFrame = (t: number) => {
    g.fillStyle = o.background
    g.fillRect(0, 0, o.width, o.height)
    if (t < lead) {
      if (o.paper) {
        g.fillStyle = o.paper
        g.fillRect(0, 0, o.width, o.height)
      }
      drawTitle(Math.min(1, t / 0.4, (lead - t) / 0.4))
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
      wantX = Math.min(Math.max(0, x - o.width / 2), Math.max(0, sheetW - o.width))
      wantY = sys ? sys.y + sys.h / 2 - o.height / 2 : 0
    } else {
      wantY = sys ? Math.max(0, sys.y - o.height * 0.12) : 0
    }
    if (first) {
      camX = wantX
      camY = wantY
      first = false
    } else {
      camX += (wantX - camX) * (o.layout === 'line' ? 0.5 : 0.18)
      camY += (wantY - camY) * 0.18
    }
    if (o.paper) {
      g.fillStyle = o.paper
      g.fillRect(0, 0, o.width, o.height)
    }
    if (mbb) {
      const r = mbb.visualBounds
      g.fillStyle = withAlpha(o.accent, 0.12)
      g.fillRect(r.x - camX, r.y - camY, r.w, r.h)
    }
    for (const p of partials) {
      if (p.x + p.w < camX || p.x > camX + o.width || p.y + p.h < camY || p.y > camY + o.height)
        continue
      g.drawImage(p.canvas, p.x - camX, p.y - camY, p.w, p.h)
    }
    if (mbb) {
      const r = mbb.visualBounds
      g.fillStyle = o.accent
      g.fillRect(Math.round(x - camX) - 1, r.y - camY, 3, r.h)
    }
    // alphaTab's attribution, on every frame.
    g.save()
    g.font = `${Math.round(Math.min(o.width, o.height) * 0.018)}px sans-serif`
    g.fillStyle = withAlpha(o.paper ? contrast(o.paper) : contrast(o.background), 0.55)
    g.textAlign = 'right'
    g.textBaseline = 'bottom'
    g.fillText('♪ alphaTab.net', o.width - 12, o.height - 10)
    g.restore()
  }

  const cleanup = () => {
    api.destroy()
    host.remove()
    void audioCtx.close()
    for (const tr of stream.getTracks()) tr.stop()
  }

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
    cleanup()
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
