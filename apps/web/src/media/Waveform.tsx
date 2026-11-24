import { ButtonGroup, HardwareButton, Stepper } from '@openaxe/ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { DetailPeaks } from './decode'
import styles from './MediaCenter.module.css'
import type { MediaMarker } from './mediaDb'
import { LoopIcon, MinusIcon, PlusIcon } from './tabs/tabIcons'

interface WaveformProps {
  /** Overview min/max pairs (persisted with the library item). */
  peaks: number[]
  /** High-resolution peaks of the loaded track, used when zoomed in. */
  detail?: DetailPeaks | null
  duration: number
  position: number
  playing?: boolean
  loopStart: number | null
  loopEnd: number | null
  loopEnabled: boolean
  markers?: MediaMarker[]
  scoreMarkers?: { id: string; label: string; time: number; title?: string }[]
  onSeek: (seconds: number) => void
  onLoopChange: (start: number | null, end: number | null) => void
  /** Pixel height, or 'fill' to take the container's height. */
  height?: number | 'fill'
  /** Zoom controls, ruler and minimap (the full player). Off for compact uses. */
  zoomable?: boolean
}

type Drag =
  | { kind: 'pending'; x: number; t: number }
  | { kind: 'region'; anchor: number }
  | { kind: 'edge'; which: 'start' | 'end' }
  | { kind: 'mini'; offset: number }

/** Shortest visible span when fully zoomed in. */
const MIN_VIEW_SECONDS = 1
const RULER_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]

function rulerLabel(t: number, step: number): string {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  const sec = step < 1 ? s.toFixed(step < 0.5 ? 2 : 1) : String(Math.round(s))
  const [whole, frac] = sec.split('.')
  return `${m}:${whole!.padStart(2, '0')}${frac ? `.${frac}` : ''}`
}

/**
 * The backing-track waveform: zoom (Ctrl/Cmd + wheel, pinch, or the buttons),
 * scroll (wheel / Shift + wheel, or drag the minimap), a time ruler, the
 * playhead (followed while playing), markers and the A-B loop region.
 * Click seeks; drag paints a loop region; drag a region edge to adjust it.
 */
export function Waveform({
  peaks,
  detail = null,
  duration,
  position,
  playing = false,
  loopStart,
  loopEnd,
  loopEnabled,
  markers = [],
  scoreMarkers = [],
  onSeek,
  onLoopChange,
  height: heightProp = 96,
  zoomable = false,
}: WaveformProps) {
  const fill = heightProp === 'fill'
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const miniRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(600)
  const [measured, setMeasured] = useState(160)
  const height = fill ? measured : heightProp
  const dragRef = useRef<Drag | null>(null)
  const [zoom, setZoom] = useState(1)
  const [start, setStart] = useState(0)

  const maxZoom = Math.max(1, duration / MIN_VIEW_SECONDS)
  const view = duration > 0 ? duration / zoom : 0
  const clampStart = useCallback(
    (s: number, v = view) => Math.min(Math.max(0, s), Math.max(0, duration - v)),
    [duration, view],
  )

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return
      setWidth(Math.max(100, Math.floor(entry.contentRect.width)))
      setMeasured(Math.max(80, Math.floor(entry.contentRect.height)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Follow the playhead: page forward when it leaves the visible window.
  useEffect(() => {
    if (!playing || zoom <= 1 || dragRef.current) return
    if (position < start || position > start + view * 0.92)
      setStart(clampStart(position - view * 0.08))
  }, [position, playing, zoom, start, view, clampStart])

  // Overall gain, from the loudest overview peak, so quiet tracks fill the view.
  const gain = useMemo(() => {
    let loudest = 0
    for (const p of peaks) loudest = Math.max(loudest, Math.abs(p))
    return loudest > 0.001 ? 0.95 / loudest : 0.95
  }, [peaks])

  /** Min/max over [t0, t1) seconds, from the finest source available. */
  const range = useCallback(
    (t0: number, t1: number): [number, number] => {
      let lo = 0
      let hi = 0
      const pxSeconds = t1 - t0
      const overviewPerSecond = peaks.length / 2 / Math.max(duration, 1e-9)
      if (detail && pxSeconds * overviewPerSecond < 2) {
        const a = Math.floor(t0 * detail.perSecond)
        const b = Math.max(a + 1, Math.ceil(t1 * detail.perSecond))
        const n = detail.data.length / 2
        for (let i = Math.max(0, a); i < b && i < n; i++) {
          lo = Math.min(lo, detail.data[i * 2]!)
          hi = Math.max(hi, detail.data[i * 2 + 1]!)
        }
      } else {
        const n = peaks.length / 2
        const a = Math.floor(t0 * overviewPerSecond)
        const b = Math.max(a + 1, Math.ceil(t1 * overviewPerSecond))
        for (let i = Math.max(0, a); i < b && i < n; i++) {
          lo = Math.min(lo, peaks[i * 2]!)
          hi = Math.max(hi, peaks[i * 2 + 1]!)
        }
      }
      return [lo, hi]
    },
    [peaks, detail, duration],
  )

  const draw = useCallback(
    (canvas: HTMLCanvasElement | null, w: number, h: number, from: number, span: number) => {
      const ctx = canvas?.getContext?.('2d')
      if (!canvas || !ctx) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = getComputedStyle(canvas).getPropertyValue('--wave').trim() || '#7a8a99'
      const mid = h / 2
      if (!peaks.length || span <= 0) {
        ctx.fillRect(0, mid, w, 1)
        return
      }
      const px = span / w
      for (let x = 0; x < w; x++) {
        const [lo, hi] = range(from + x * px, from + (x + 1) * px)
        const top = mid - hi * mid * gain
        const bottom = mid - lo * mid * gain
        ctx.fillRect(x, top, 1, Math.max(1, bottom - top))
      }
    },
    [peaks, range, gain],
  )

  useEffect(() => {
    draw(canvasRef.current, width, height, start, view)
  }, [draw, width, height, start, view])

  useEffect(() => {
    if (zoomable && zoom > 1) draw(miniRef.current, width, 28, 0, duration)
  }, [draw, width, duration, zoomable, zoom > 1]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Zoom ──────────────────────────────────────────────────────────────
  const zoomAround = useCallback(
    (factor: number, anchor: number) => {
      const next = Math.min(maxZoom, Math.max(1, zoom * factor))
      const nextView = duration / next
      const ratio = view > 0 ? (anchor - start) / view : 0.5
      setZoom(next)
      setStart(Math.min(Math.max(0, anchor - ratio * nextView), Math.max(0, duration - nextView)))
    },
    [zoom, maxZoom, duration, view, start],
  )

  const zoomToRange = (a: number, b: number) => {
    const span = Math.max(MIN_VIEW_SECONDS, (b - a) * 1.15)
    const next = Math.min(maxZoom, Math.max(1, duration / span))
    const nextView = duration / next
    setZoom(next)
    setStart(Math.min(Math.max(0, (a + b) / 2 - nextView / 2), Math.max(0, duration - nextView)))
  }

  const timeAt = useCallback(
    (clientX: number) => {
      const rect = wrapRef.current?.getBoundingClientRect()
      if (!rect || duration <= 0) return 0
      return Math.min(duration, Math.max(0, start + ((clientX - rect.left) / rect.width) * view))
    },
    [duration, start, view],
  )

  // Wheel: Ctrl/Cmd (and trackpad pinch) zooms around the pointer; otherwise
  // horizontal movement or Shift scrolls. Non-passive so the page stays put.
  useEffect(() => {
    const el = wrapRef.current
    if (!el || !zoomable) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        zoomAround(Math.exp(-e.deltaY * 0.01), timeAt(e.clientX))
      } else if (zoom > 1 && (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey)) {
        e.preventDefault()
        const d = (e.shiftKey ? e.deltaY : e.deltaX) || e.deltaY
        setStart((s) => clampStart(s + (d / Math.max(1, width)) * view))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomable, zoomAround, timeAt, zoom, width, view, clampStart])

  // ── Pointer ───────────────────────────────────────────────────────────
  const pct = (t: number) => (view > 0 ? `${((t - start) / view) * 100}%` : '0%')
  const visible = (t: number) => t >= start - 1e-6 && t <= start + view + 1e-6
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
    } else if (drag.kind === 'edge' && hasRegion) {
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

  // Minimap: click or drag the window to scroll.
  const miniTime = (clientX: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect()
    return ((clientX - rect.left) / rect.width) * duration
  }
  const onMiniDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const t = miniTime(e.clientX, e.currentTarget)
    const inside = t >= start && t <= start + view
    const offset = inside ? t - start : view / 2
    dragRef.current = { kind: 'mini', offset }
    setStart(clampStart(t - offset))
  }
  const onMiniMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag?.kind !== 'mini') return
    setStart(clampStart(miniTime(e.clientX, e.currentTarget) - drag.offset))
  }
  const onMiniUp = () => {
    dragRef.current = null
  }

  // ── Ruler ─────────────────────────────────────────────────────────────
  const ticks = useMemo(() => {
    if (!zoomable || view <= 0) return []
    const pxPerSecond = width / view
    const step = RULER_STEPS.find((s) => s * pxPerSecond >= 70) ?? 600
    const first = Math.ceil(start / step) * step
    const out: { t: number; label: string }[] = []
    for (let t = first; t <= start + view + 1e-9 && out.length < 60; t += step) {
      out.push({ t, label: rulerLabel(t, step) })
    }
    return out
  }, [zoomable, view, width, start])

  const waveform = (
    <div
      ref={wrapRef}
      className={styles.waveform}
      style={fill ? { flex: 1, minHeight: 0 } : { height }}
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
      title={
        zoomable
          ? 'Click to seek · drag to set an A-B loop · Ctrl/⌘ + wheel to zoom'
          : 'Click to seek · drag to set an A-B loop'
      }
    >
      <canvas ref={canvasRef} className={styles.waveCanvas} style={{ width: '100%', height }} />
      {position > start && (
        <div
          className={styles.wavePlayed}
          style={{ width: visible(position) ? pct(position) : '100%' }}
        />
      )}
      {hasRegion && loopEnd! > start && loopStart! < start + view && (
        <div
          className={`${styles.loopRegion} ${loopEnabled ? styles.loopOn : ''}`}
          style={{
            left: pct(Math.max(loopStart!, start)),
            width: pct(start + Math.min(loopEnd!, start + view) - Math.max(loopStart!, start)),
          }}
        >
          {visible(loopStart!) && <span className={styles.loopEdge} data-edge="start" />}
          {visible(loopEnd!) && <span className={styles.loopEdgeEnd} data-edge="end" />}
        </div>
      )}
      {markers
        .filter((m) => visible(m.time))
        .map((m) => (
          <div key={m.id} className={styles.marker} style={{ left: pct(m.time) }} title={m.label}>
            <span>{m.label}</span>
          </div>
        ))}
      {scoreMarkers
        .filter((m) => visible(m.time))
        .map((m) => (
          <div
            key={m.id}
            className={styles.scoreMarker}
            style={{ left: pct(m.time) }}
            title={m.title ?? m.label}
          >
            <span>{m.label}</span>
          </div>
        ))}
      {visible(position) && <div className={styles.playhead} style={{ left: pct(position) }} />}
    </div>
  )

  if (!zoomable) return waveform

  return (
    <div className={styles.waveStack} style={fill ? { flex: 1, minHeight: 0 } : undefined}>
      <div className={styles.ruler}>
        {ticks.map((tk) => (
          <span
            key={tk.t}
            className={styles.rulerTick}
            style={{ left: pct(tk.t) }}
            aria-hidden="true"
          >
            {tk.label}
          </span>
        ))}
        <div className={styles.zoomBar}>
          <Stepper
            label="Waveform zoom"
            value={zoom < 1.05 ? 'fit' : `${zoom < 10 ? zoom.toFixed(1) : Math.round(zoom)}×`}
            decrementIcon={<MinusIcon size={14} />}
            incrementIcon={<PlusIcon size={14} />}
            decrementLabel="Zoom out"
            incrementLabel="Zoom in"
            decrementTitle="Zoom out (Ctrl/⌘ + wheel)"
            incrementTitle="Zoom in (Ctrl/⌘ + wheel)"
            decrementDisabled={zoom <= 1}
            incrementDisabled={zoom >= maxZoom}
            onDecrement={() => zoomAround(1 / 1.6, position)}
            onIncrement={() => zoomAround(1.6, position)}
          />
          <ButtonGroup label="Zoom shortcuts">
            <HardwareButton
              size="small"
              iconOnly
              icon={<LoopIcon size={14} />}
              label="Zoom to the loop"
              disabled={!hasRegion}
              onClick={() => (hasRegion ? zoomToRange(loopStart!, loopEnd!) : undefined)}
            />
            <HardwareButton
              size="small"
              label="⤢"
              ariaLabel="Fit"
              title="Fit the whole track"
              disabled={zoom <= 1}
              onClick={() => {
                setZoom(1)
                setStart(0)
              }}
            />
          </ButtonGroup>
        </div>
      </div>
      {waveform}
      {zoom > 1 && (
        <div
          className={styles.minimap}
          onPointerDown={onMiniDown}
          onPointerMove={onMiniMove}
          onPointerUp={onMiniUp}
          title="Overview — drag the window to scroll"
        >
          <canvas
            ref={miniRef}
            className={styles.waveCanvas}
            style={{ width: '100%', height: 28 }}
          />
          <div
            className={styles.miniWindow}
            style={{ left: `${(start / duration) * 100}%`, width: `${(view / duration) * 100}%` }}
          />
          <div
            className={styles.miniPlayhead}
            style={{ left: `${(position / duration) * 100}%` }}
          />
        </div>
      )}
    </div>
  )
}
