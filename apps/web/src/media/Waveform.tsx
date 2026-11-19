import { useCallback, useEffect, useRef, useState } from 'react'

import styles from './MediaCenter.module.css'
import type { MediaMarker } from './mediaDb'

interface WaveformProps {
  peaks: number[]
  duration: number
  position: number
  loopStart: number | null
  loopEnd: number | null
  loopEnabled: boolean
  markers?: MediaMarker[]
  onSeek: (seconds: number) => void
  onLoopChange: (start: number | null, end: number | null) => void
  height?: number
}

type Drag =
  | { kind: 'pending'; x: number; t: number }
  | { kind: 'region'; anchor: number }
  | { kind: 'edge'; which: 'start' | 'end' }

/**
 * Waveform overview with the playhead and the A-B loop region. Click seeks;
 * drag paints a loop region; drag a region edge to adjust it.
 */
export function Waveform({
  peaks,
  duration,
  position,
  loopStart,
  loopEnd,
  loopEnabled,
  markers = [],
  onSeek,
  onLoopChange,
  height = 96,
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(600)
  const dragRef = useRef<Drag | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(100, Math.floor(entry.contentRect.width)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Waveform body: redrawn only when the data or size changes.
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext?.('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const style = getComputedStyle(canvas)
    ctx.fillStyle = style.getPropertyValue('--wave').trim() || '#7a8a99'
    const buckets = peaks.length / 2
    const mid = height / 2
    if (buckets === 0) {
      ctx.fillRect(0, mid, width, 1)
      return
    }
    for (let x = 0; x < width; x++) {
      const b0 = Math.floor((x / width) * buckets)
      const b1 = Math.max(b0 + 1, Math.floor(((x + 1) / width) * buckets))
      let lo = 0
      let hi = 0
      for (let b = b0; b < b1 && b < buckets; b++) {
        lo = Math.min(lo, peaks[b * 2]!)
        hi = Math.max(hi, peaks[b * 2 + 1]!)
      }
      const top = mid - hi * mid * 0.95
      const bottom = mid - lo * mid * 0.95
      ctx.fillRect(x, top, 1, Math.max(1, bottom - top))
    }
  }, [peaks, width, height])

  const timeAt = useCallback(
    (clientX: number) => {
      const rect = wrapRef.current?.getBoundingClientRect()
      if (!rect || duration <= 0) return 0
      return Math.min(duration, Math.max(0, ((clientX - rect.left) / rect.width) * duration))
    },
    [duration],
  )

  const pct = (t: number) => (duration > 0 ? `${(t / duration) * 100}%` : '0%')
  const hasRegion = loopStart !== null && loopEnd !== null && loopEnd > loopStart

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (duration <= 0) return
    const target = e.target as HTMLElement
    e.currentTarget.setPointerCapture(e.pointerId)
    const edge = target.dataset.edge as 'start' | 'end' | undefined
    if (edge) {
      dragRef.current = { kind: 'edge', which: edge }
      return
    }
    dragRef.current = { kind: 'pending', x: e.clientX, t: timeAt(e.clientX) }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const t = timeAt(e.clientX)
    if (drag.kind === 'pending') {
      if (Math.abs(e.clientX - drag.x) < 5) return
      dragRef.current = { kind: 'region', anchor: drag.t }
      onLoopChange(Math.min(drag.t, t), Math.max(drag.t, t))
    } else if (drag.kind === 'region') {
      onLoopChange(Math.min(drag.anchor, t), Math.max(drag.anchor, t))
    } else if (hasRegion) {
      if (drag.which === 'start') onLoopChange(Math.min(t, loopEnd! - 0.05), loopEnd)
      else onLoopChange(loopStart, Math.max(t, loopStart! + 0.05))
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    dragRef.current = null
    if (drag?.kind === 'pending') onSeek(timeAt(e.clientX))
    else if (drag?.kind === 'region' && hasRegion) onSeek(loopStart!)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 2
    if (e.key === 'ArrowLeft') onSeek(Math.max(0, position - step))
    else if (e.key === 'ArrowRight') onSeek(Math.min(duration, position + step))
    else return
    e.preventDefault()
  }

  return (
    <div
      ref={wrapRef}
      className={styles.waveform}
      style={{ height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
      role="slider"
      tabIndex={0}
      aria-label="Track position"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(position)}
      title="Click to seek · drag to set an A-B loop"
    >
      <canvas ref={canvasRef} className={styles.waveCanvas} style={{ width: '100%', height }} />
      <div className={styles.wavePlayed} style={{ width: pct(position) }} />
      {hasRegion && (
        <div
          className={`${styles.loopRegion} ${loopEnabled ? styles.loopOn : ''}`}
          style={{ left: pct(loopStart!), width: pct(loopEnd! - loopStart!) }}
        >
          <span className={styles.loopEdge} data-edge="start" />
          <span className={styles.loopEdgeEnd} data-edge="end" />
        </div>
      )}
      {markers.map((m) => (
        <div key={m.id} className={styles.marker} style={{ left: pct(m.time) }} title={m.label}>
          <span>{m.label}</span>
        </div>
      ))}
      <div className={styles.playhead} style={{ left: pct(position) }} />
    </div>
  )
}
