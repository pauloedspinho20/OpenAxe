/**
 * Video export options and progress (issue #459): size and format, frame
 * rate, colours, zoom, layout, tracks, title card and audio - then record.
 */
import { HardwareButton } from '@openaxe/ui'
import { useRef, useState } from 'react'

import styles from '../MediaCenter.module.css'
import * as I from './tabIcons'
import t from './TabWorkspace.module.css'
import { pickMime, VIDEO_SIZES } from './videoExport'

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
}

interface VideoExportDialogProps {
  tracks: { name: string }[]
  shown: number[]
  profile: 'tab' | 'both' | 'score'
  dark: boolean
  hasRecording: boolean
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
  })
  const [progress, setProgress] = useState<number | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const set = <K extends keyof VideoDialogChoice>(k: K, v: VideoDialogChoice[K]) =>
    setC((x) => ({ ...x, [k]: v }))
  const format = pickMime()
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
    <div className={t.texPane} role="dialog" aria-label="Export video">
      <div className={t.texHead}>
        <I.DownloadIcon size={16} />
        <strong>Export video</strong>
        <span className={styles.dim}>
          {format
            ? `Records in real time as ${format.ext.toUpperCase()} - keep this window open.`
            : 'This browser cannot record video.'}
        </span>
        <span className={t.footerSpacer} />
        <HardwareButton size="small" label="Close" disabled={busy} onClick={p.onClose} />
      </div>
      <fieldset className={t.printGrid} disabled={busy}>
        <fieldset>
          <legend>Format</legend>
          <select
            value={c.sizeId}
            onChange={(e) => set('sizeId', e.target.value)}
            aria-label="Video size"
          >
            {VIDEO_SIZES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <label>
            <span className={styles.dim}>frame rate</span>
            <select
              value={c.fps}
              onChange={(e) => set('fps', Number(e.target.value))}
              aria-label="Frame rate"
            >
              <option value={30}>30 fps</option>
              <option value={60}>60 fps</option>
            </select>
          </label>
          <label>
            <span className={styles.dim}>audio</span>
            <select
              value={c.audio}
              onChange={(e) => set('audio', e.target.value as VideoAudio)}
              aria-label="Audio"
            >
              <option value="synth">Synth (tracks as mixed)</option>
              {p.hasRecording && <option value="recording">Synced recording</option>}
              <option value="none">No audio</option>
            </select>
          </label>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={c.titleCard}
              onChange={(e) => set('titleCard', e.target.checked)}
            />
            Title card
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
          <select
            value={c.layout}
            onChange={(e) => set('layout', e.target.value as 'line' | 'page')}
            aria-label="Layout"
          >
            <option value="line">One line, cursor centred</option>
            <option value="page">Pages, current line at the top</option>
          </select>
          <select
            value={c.profile}
            onChange={(e) => set('profile', e.target.value as 'tab' | 'both' | 'score')}
            aria-label="Staves"
          >
            <option value="tab">Tab only</option>
            <option value="both">Notation + tab</option>
            <option value="score">Notation only</option>
          </select>
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
            label="Record video"
            icon={<I.DownloadIcon size={14} />}
            disabled={!format || c.tracks.length === 0}
            onClick={start}
          />
        )}
        {message && <span className={styles.dim}>{message}</span>}
      </div>
    </div>
  )
}
