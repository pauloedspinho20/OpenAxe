/**
 * Live recording of the VISUALS canvas plus the monitor mix. Unlike the tab
 * video export (media/tabs/videoExport.ts), which renders faster than real
 * time from a known score, visuals react to playing as it happens - so this
 * captures in real time with MediaRecorder.
 */
import { pickMime } from '../../media/videoFormats'

export interface Recording {
  readonly mime: string
  readonly ext: 'mp4' | 'webm'
  /** Stops capture and resolves with the encoded file. */
  stop(): Promise<Blob>
  /** Stops and throws the data away. */
  cancel(): void
}

export function recordingSupported(canvas: HTMLCanvasElement | null): boolean {
  return Boolean(canvas && typeof canvas.captureStream === 'function' && pickMime())
}

export function startRecording(
  canvas: HTMLCanvasElement,
  fps: number,
  audio: MediaStream | null,
): Recording {
  const format = pickMime()
  if (!format) throw new Error('This browser cannot record video (no MediaRecorder container).')
  const video = canvas.captureStream(fps)
  const tracks = [...video.getVideoTracks(), ...(audio?.getAudioTracks() ?? [])]
  const stream = new MediaStream(tracks)
  const pixels = canvas.width * canvas.height
  const recorder = new MediaRecorder(stream, {
    mimeType: format.mime,
    // ~0.15 bits/pixel/frame: comfortably clean for fast-moving visuals.
    videoBitsPerSecond: Math.round(Math.min(60_000_000, Math.max(4_000_000, pixels * fps * 0.15))),
    audioBitsPerSecond: 256_000,
  })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  recorder.start(1000)

  const release = () => {
    for (const t of video.getTracks()) t.stop()
  }

  return {
    mime: format.mime,
    ext: format.ext,
    stop: () =>
      new Promise<Blob>((resolve, reject) => {
        recorder.onstop = () => {
          release()
          resolve(new Blob(chunks, { type: format.mime.split(';')[0] ?? format.mime }))
        }
        recorder.onerror = (e) => {
          release()
          reject(e instanceof ErrorEvent ? e.error : new Error('Recording failed'))
        }
        if (recorder.state === 'inactive') recorder.onstop?.(new Event('stop'))
        else recorder.stop()
      }),
    cancel: () => {
      recorder.ondataavailable = null
      if (recorder.state !== 'inactive') recorder.stop()
      release()
    },
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
