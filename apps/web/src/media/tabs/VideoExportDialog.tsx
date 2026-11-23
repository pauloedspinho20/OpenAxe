/**
 * Video export options and progress (issue #459): size and format, frame
 * rate, colours, zoom, layout, tracks, title card and audio - then record.
 */
import { Dialog, HardwareButton, Select } from '@openaxe/ui'
import { useEffect, useRef, useState } from 'react'

import styles from '../MediaCenter.module.css'
import * as I from './tabIcons'
import t from './TabWorkspace.module.css'
import {
  detectExportCapabilities,
  type ExportCapabilities,
  pickMime,
  VIDEO_SIZES,
  type VideoFormat,
} from './videoExport'

export type VideoAudio = 'synth' | 'recording' | 'none'

export interface VideoDialogChoice {
  sizeId: string
  fps: number
  background: string
  paper: string
  dark: boolean
  accent: string
  scale: number
  layout: 'line' | 'page'
  profile: 'tab' | 'both' | 'score'
  tracks: number[]
  titleCard: boolean
  audio: VideoAudio
  /** What to record: the whole song, the A-B loop, or bars from..to (1-based). */
  range: 'song' | 'loop' | 'bars'
  fromBar: number
  toBar: number
  /** Playback speed (synth only; 1 = as written). */
  speed: number
  /** A bar of metronome clicks before the music. */
  countIn: boolean
  backgroundImage: File | null
  /** 0..1: how solid the sheet behind the music is. */
  paperOpacity: number
  /** Show a fretboard with the playing notes under the music. */
  fretboard: boolean
  /** Output container for offline WebCodecs export. */
  format: VideoFormat
}

interface VideoExportDialogProps {
  tracks: { name: string }[]
  shown: number[]
  profile: 'tab' | 'both' | 'score'
  dark: boolean
  hasRecording: boolean
  barCount: number
  hasLoop: boolean
  /** Default bar range (the selection, or the cursor's bar), 1-based. */
  span: [number, number]
  /** Runs the export; resolves when done (or rejects). */
  onExport: (
    c: VideoDialogChoice,
    onProgress: (f: number) => void,
    signal: AbortSignal,
  ) => Promise<void>
  onClose: () => void
}

export function VideoExportDialog(p: VideoExportDialogProps) {
  const [c, setC] = useState<VideoDialogChoice>({
    sizeId: '1080p',
    fps: 30,
    background: p.dark ? '#141416' : '#1d1d22',
    paper: p.dark ? '#1b1b1e' : '#fbfaf7',
    dark: p.dark,
    accent: '#e4572e',
    scale: 1.3,
    layout: 'line',
    profile: p.profile,
    tracks: [...p.shown],
    titleCard: true,
    audio: p.hasRecording ? 'recording' : 'synth',
    range: 'song',
    fromBar: p.span[0],
    toBar: p.span[1],
    speed: 1,
    countIn: false,
    backgroundImage: null,
    paperOpacity: 1,
    fretboard: false,
    format: 'auto',
  })
  const [progress, setProgress] = useState<number | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [caps, setCaps] = useState<ExportCapabilities>(() => ({
    offline: false,
    mp4: false,
    webm: false,
    realtime: pickMime(),
  }))
  const abort = useRef<AbortController | null>(null)
  const set = <K extends keyof VideoDialogChoice>(k: K, v: VideoDialogChoice[K]) =>
    setC((x) => ({ ...x, [k]: v }))
  useEffect(() => {
    let cancelled = false
    void detectExportCapabilities().then((next) => {
      if (!cancelled) setCaps(next)
    })
    return () => {
      cancelled = true
    }
  }, [])
  const canExport = caps.offline || !!caps.realtime
  const busy = progress !== null

  const start = () => {
    const ctrl = new AbortController()
    abort.current = ctrl
    setMessage(null)
    setProgress(0)
    p.onExport(c, setProgress, ctrl.signal)
      .then(() => setMessage('Done - the video was downloaded.'))
      .catch((err: unknown) => {
        setMessage(
          err instanceof DOMException && err.name === 'AbortError'
            ? 'Cancelled.'
            : `Could not export: ${err instanceof Error ? err.message : String(err)}`,
        )
      })
      .finally(() => {
        setProgress(null)
        abort.current = null
      })
  }

  return (
    <Dialog
      open
      onClose={p.onClose}
      closeDisabled={busy}
      title="Export video"
      width="min(760px, 94vw)"
    >
      <span className={styles.dim}>
        {caps.offline
          ? `Renders offline (faster than real time) as ${caps.mp4 && caps.webm ? 'MP4 or WebM' : caps.mp4 ? 'MP4' : 'WebM'}.`
          : caps.realtime
            ? `Records in real time as ${caps.realtime.ext.toUpperCase()} — keep this window open.`
            : 'This browser cannot export video.'}
      </span>
      <fieldset className={t.printGrid} disabled={busy}>
        <fieldset>
          <legend>Format</legend>
          <Select
            value={c.sizeId}
            onChange={(e) => set('sizeId', e.target.value)}
            aria-label="Video size"
          >
            {VIDEO_SIZES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
          <label>
            <span className={styles.dim}>frame rate</span>
            <Select
              value={c.fps}
              onChange={(e) => set('fps', Number(e.target.value))}
              aria-label="Frame rate"
            >
              <option value={30}>30 fps</option>
              <option value={60}>60 fps</option>
            </Select>
          </label>
          <label>
            <span className={styles.dim}>audio</span>
            <Select
              value={c.audio}
              onChange={(e) => set('audio', e.target.value as VideoAudio)}
              aria-label="Audio"
            >
              <option value="synth">Synth (tracks as mixed)</option>
              {p.hasRecording && <option value="recording">Synced recording</option>}
              <option value="none">No audio</option>
            </Select>
          </label>
          {caps.mp4 && caps.webm && (
            <label>
              <span className={styles.dim}>container</span>
              <Select
                value={c.format}
                onChange={(e) => set('format', e.target.value as VideoFormat)}
                aria-label="Container format"
              >
                <option value="auto">Auto (MP4)</option>
                <option value="mp4">MP4 (H.264 + AAC)</option>
                <option value="webm">WebM (VP9/VP8 + Opus)</option>
              </Select>
            </label>
          )}
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={c.titleCard}
              onChange={(e) => set('titleCard', e.target.checked)}
            />
            Title card
          </label>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={c.countIn}
              onChange={(e) => set('countIn', e.target.checked)}
            />
            Count-in bar
          </label>
        </fieldset>
        <fieldset>
          <legend>Part</legend>
          <Select
            value={c.range}
            onChange={(e) => set('range', e.target.value as VideoDialogChoice['range'])}
            aria-label="Part to record"
          >
            <option value="song">Whole song</option>
            {p.hasLoop && <option value="loop">The A–B loop</option>}
            <option value="bars">Bars…</option>
          </Select>
          {c.range === 'bars' && (
            <div className={t.tapRow}>
              <input
                type="number"
                min={1}
                max={p.barCount}
                value={c.fromBar}
                onChange={(e) =>
                  set('fromBar', Math.min(p.barCount, Math.max(1, Number(e.target.value) || 1)))
                }
                aria-label="First bar"
              />
              <span className={styles.dim}>to</span>
              <input
                type="number"
                min={1}
                max={p.barCount}
                value={c.toBar}
                onChange={(e) =>
                  set('toBar', Math.min(p.barCount, Math.max(1, Number(e.target.value) || 1)))
                }
                aria-label="Last bar"
              />
            </div>
          )}
          <label>
            <span className={styles.dim}>
              speed {Math.round(c.speed * 100)}%{c.audio === 'recording' ? ' (synth only)' : ''}
            </span>
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.05}
              value={c.audio === 'recording' ? 1 : c.speed}
              disabled={c.audio === 'recording'}
              onChange={(e) => set('speed', Number(e.target.value))}
              aria-label="Speed"
            />
          </label>
        </fieldset>
        <fieldset>
          <legend>Look</legend>
          <label className={t.colorRow}>
            <input
              type="color"
              value={c.background}
              onChange={(e) => set('background', e.target.value)}
              aria-label="Background colour"
            />
            background
          </label>
          <label className={t.colorRow}>
            <input
              type="color"
              value={c.paper}
              onChange={(e) => set('paper', e.target.value)}
              aria-label="Sheet colour"
            />
            sheet
          </label>
          <label className={t.colorRow}>
            <input
              type="color"
              value={c.accent}
              onChange={(e) => set('accent', e.target.value)}
              aria-label="Cursor colour"
            />
            cursor
          </label>
          <label>
            <span className={styles.dim}>background image</span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => set('backgroundImage', e.target.files?.[0] ?? null)}
              aria-label="Background image"
            />
          </label>
          {c.backgroundImage && (
            <HardwareButton
              size="small"
              label="Remove image"
              onClick={() => set('backgroundImage', null)}
            />
          )}
          <label>
            <span className={styles.dim}>sheet {Math.round(c.paperOpacity * 100)}%</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={c.paperOpacity}
              onChange={(e) => set('paperOpacity', Number(e.target.value))}
              aria-label="Sheet opacity"
            />
          </label>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={c.dark}
              onChange={(e) => set('dark', e.target.checked)}
            />
            Light music on dark
          </label>
          <label>
            <span className={styles.dim}>zoom {Math.round(c.scale * 100)}%</span>
            <input
              type="range"
              min={0.6}
              max={2.5}
              step={0.05}
              value={c.scale}
              onChange={(e) => set('scale', Number(e.target.value))}
              aria-label="Music zoom"
            />
          </label>
        </fieldset>
        <fieldset>
          <legend>Music</legend>
          <Select
            value={c.layout}
            onChange={(e) => set('layout', e.target.value as 'line' | 'page')}
            aria-label="Layout"
          >
            <option value="line">One line, cursor centred</option>
            <option value="page">Pages, current line at the top</option>
          </Select>
          <Select
            value={c.profile}
            onChange={(e) => set('profile', e.target.value as 'tab' | 'both' | 'score')}
            aria-label="Staves"
          >
            <option value="tab">Tab only</option>
            <option value="both">Notation + tab</option>
            <option value="score">Notation only</option>
          </Select>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={c.fretboard}
              onChange={(e) => set('fretboard', e.target.checked)}
            />
            Fretboard with the playing notes
          </label>
          {p.tracks.map((tr, i) => (
            <label key={i} className={styles.check}>
              <input
                type="checkbox"
                checked={c.tracks.includes(i)}
                onChange={() =>
                  set(
                    'tracks',
                    c.tracks.includes(i)
                      ? c.tracks.filter((x) => x !== i)
                      : [...c.tracks, i].sort((a, b) => a - b),
                  )
                }
              />
              {tr.name}
            </label>
          ))}
        </fieldset>
      </fieldset>
      <div className={t.tapRow}>
        {busy ? (
          <>
            <progress value={progress ?? 0} max={1} className={t.videoProgress} />
            <span>{Math.round((progress ?? 0) * 100)}%</span>
            <HardwareButton
              size="small"
              label="Cancel"
              variant="danger"
              onClick={() => abort.current?.abort()}
            />
          </>
        ) : (
          <HardwareButton
            size="small"
            label="Export video"
            icon={<I.DownloadIcon size={14} />}
            disabled={!canExport || c.tracks.length === 0}
            onClick={start}
          />
        )}
        {message && <span className={styles.dim}>{message}</span>}
      </div>
    </Dialog>
  )
}
