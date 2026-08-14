import { useEffect, useRef, useState } from 'react'
import styles from './HeaderPerfWidget.module.css'

export interface HeaderPerfWidgetProps {
  /** For latency - null before power-on. */
  context: AudioContext | null
}

interface PerfStats {
  cpuPercent: number
  memMB: number | null
  latencyMs: number | null
}

const REPORT_INTERVAL_MS = 500
const EXPECTED_FRAME_MS = 1000 / 60

/** Chrome/Edge only (non-standard) - other browsers get "—". */
function readMemoryMB(): number | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
  return memory ? Math.round(memory.usedJSHeapSize / (1024 * 1024)) : null
}

function tierClass(percent: number): string {
  if (percent >= 80) return styles.hot ?? ''
  if (percent >= 50) return styles.warn ?? ''
  return styles.good ?? ''
}

/**
 * A small header readout, always visible (not just while powered on):
 * - CPU: an *approximate* main-thread load, derived from how much longer
 *   requestAnimationFrame ticks take than the 60fps ideal - browsers expose
 *   no real per-process CPU percentage to a web page, so this is a load
 *   proxy, not a literal OS reading (see the tooltip).
 * - MEM: the JS heap size via the non-standard `performance.memory` (Chrome/
 *   Edge only); shows "—" elsewhere.
 * - LAT: the AudioContext's own reported round-trip latency
 *   (baseLatency + outputLatency), both real standard properties - shows
 *   "—" before power-on.
 */
export function HeaderPerfWidget({ context }: HeaderPerfWidgetProps) {
  const [stats, setStats] = useState<PerfStats>({ cpuPercent: 0, memMB: null, latencyMs: null })
  const contextRef = useRef(context)
  contextRef.current = context

  useEffect(() => {
    let raf = 0
    let lastFrame = performance.now()
    let lastReport = lastFrame
    let load = 0

    const tick = (now: number) => {
      const delta = now - lastFrame
      lastFrame = now
      const instantLoad = Math.min(1, Math.max(0, (delta - EXPECTED_FRAME_MS) / EXPECTED_FRAME_MS))
      load = load * 0.9 + instantLoad * 0.1

      if (now - lastReport >= REPORT_INTERVAL_MS) {
        lastReport = now
        const ctx = contextRef.current
        const latencyMs = ctx
          ? Math.round((ctx.baseLatency + (ctx.outputLatency || 0)) * 1000)
          : null
        setStats({ cpuPercent: Math.round(load * 100), memMB: readMemoryMB(), latencyMs })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div
      className={styles.widget}
      title="CPU is an approximate main-thread load (from frame timing, not a literal OS reading). MEM is the JS heap size (Chrome/Edge only). LAT is the audio engine's reported round-trip latency."
    >
      <span className={styles.stat}>
        <span className={`label ${styles.statLabel}`}>CPU</span>
        <span className={`${styles.statValue} ${tierClass(stats.cpuPercent)}`}>
          {stats.cpuPercent}%
        </span>
      </span>
      <span className={styles.stat}>
        <span className={`label ${styles.statLabel}`}>MEM</span>
        <span className={styles.statValue}>{stats.memMB !== null ? `${stats.memMB}MB` : '—'}</span>
      </span>
      <span className={styles.stat}>
        <span className={`label ${styles.statLabel}`}>LAT</span>
        <span className={styles.statValue}>
          {stats.latencyMs !== null ? `${stats.latencyMs}ms` : '—'}
        </span>
      </span>
    </div>
  )
}
