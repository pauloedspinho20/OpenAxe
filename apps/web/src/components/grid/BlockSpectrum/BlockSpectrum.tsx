import { useEffect, useRef, useState } from 'react'
import { HardwareButton } from '@openaxe/ui'
import { SpectrumAnalyzer } from '../../../visuals/audio/fft'
import {
  MAX_HZ,
  MIN_DB,
  MIN_HZ,
  dbToY,
  hzToX,
  smoothDb,
  spectrumColumnsDb,
  xToHz,
} from './spectrumMath'
import styles from './BlockSpectrum.module.css'

/** The slice of a rig the analyser needs (GraphRig on web, NativeGraphRig on desktop). */
export interface SpectrumRig {
  setBlockTap(id: string, enabled: boolean): void
  readBlockSamples(
    id: string,
    count: number,
  ): Promise<{ in: Float32Array; out: Float32Array } | null>
  analysisSampleRate(): number
}

/**
 * Anything the analyser can read from. `in` is optional: a source with only an
 * output (the master bus) draws just the output trace.
 */
export interface SpectrumSource {
  /** Called when the view mounts; switch on whatever tap feeds `read`. */
  start(): void
  /** Called when it unmounts; switch the tap off again. */
  stop(): void
  read(count: number): Promise<{ in?: Float32Array; out: Float32Array } | null>
  sampleRate(): number
  /** True when the source has no input side (the master bus); the legend then omits "In". */
  outputOnly?: boolean
}

/** A block's input/output tap in a rig. */
export function blockSpectrumSource(rig: SpectrumRig, blockId: string): SpectrumSource {
  return {
    start: () => rig.setBlockTap(blockId, true),
    stop: () => rig.setBlockTap(blockId, false),
    read: (count) => rig.readBlockSamples(blockId, count),
    sampleRate: () => rig.analysisSampleRate(),
  }
}

/** The slice of a rig the master-output analyser needs. */
export interface MasterSpectrumRig {
  setMasterTap(enabled: boolean): void
  readMasterSamples(count: number): Promise<Float32Array | null>
  analysisSampleRate(): number
}

/** The master output bus, tapped before the mute so it keeps showing while muted. */
export function masterSpectrumSource(rig: MasterSpectrumRig): SpectrumSource {
  return {
    start: () => rig.setMasterTap(true),
    stop: () => rig.setMasterTap(false),
    read: async (count) => {
      const out = await rig.readMasterSamples(count)
      return out ? { out } : null
    },
    sampleRate: () => rig.analysisSampleRate(),
    outputOnly: true,
  }
}

interface Props {
  source: SpectrumSource | null
  /** Optional dB-vs-frequency curve drawn over the spectrum (e.g. the EQ response). */
  overlay?: ((hz: number) => number) | undefined
}

const FFT_SIZE = 4096
const COLUMNS = 300
const GRID_HZ = [50, 100, 200, 500, 1000, 2000, 5000, 10000]
const GRID_DB = [-72, -54, -36, -18]

const cssVar = (el: Element, name: string, fallback: string) =>
  getComputedStyle(el).getPropertyValue(name).trim() || fallback

/**
 * Real-time spectrum of a block: its input (filled, faint) against its output
 * (line), from the core's analysis tap. The tap is switched on only while this
 * is mounted, so a block nobody is looking at costs the audio thread nothing.
 */
export function BlockSpectrum({ source, overlay }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [frozen, setFrozen] = useState(false)
  const [tilt, setTilt] = useState(true)
  const [hasSignal, setHasSignal] = useState(false)
  const frozenRef = useRef(frozen)
  const tiltRef = useRef(tilt)
  const overlayRef = useRef(overlay)
  frozenRef.current = frozen
  tiltRef.current = tilt
  overlayRef.current = overlay

  useEffect(() => {
    const canvas = canvasRef.current
    if (!source || !canvas) return
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return

    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const intervalMs = reduceMotion ? 100 : 33
    const smoothing = reduceMotion ? 0 : 0.6

    const fft = new SpectrumAnalyzer(FFT_SIZE)
    const inDb = new Float32Array(COLUMNS).fill(MIN_DB)
    const outDb = new Float32Array(COLUMNS).fill(MIN_DB)
    const scratch = new Float32Array(COLUMNS)
    const colors = {
      grid: cssVar(canvas, '--seam', '#333'),
      text: cssVar(canvas, '--ink-2', '#999'),
      accent: cssVar(canvas, '--accent', '#e8553d'),
      input: cssVar(canvas, '--ink-2', '#888'),
    }

    let alive = true
    let busy = false
    let gotData = false
    source.start()

    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== Math.round(w * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      const g = ctx2d
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      g.font = '9px monospace'
      g.lineWidth = 1
      g.strokeStyle = colors.grid
      g.fillStyle = colors.text
      for (const hz of GRID_HZ) {
        const x = Math.round(hzToX(hz) * w) + 0.5
        g.beginPath()
        g.moveTo(x, 0)
        g.lineTo(x, h)
        g.stroke()
        g.fillText(hz >= 1000 ? `${hz / 1000}k` : String(hz), x + 2, h - 3)
      }
      for (const db of GRID_DB) {
        const y = Math.round(dbToY(db) * h) + 0.5
        g.beginPath()
        g.moveTo(0, y)
        g.lineTo(w, y)
        g.stroke()
        g.fillText(`${db}`, 2, y - 2)
      }
      const trace = (data: Float32Array, close: boolean) => {
        g.beginPath()
        for (let c = 0; c < COLUMNS; c++) {
          const x = ((c + 0.5) / COLUMNS) * w
          const y = Math.min(h, Math.max(0, dbToY(data[c]!) * h))
          if (c === 0) g.moveTo(x, y)
          else g.lineTo(x, y)
        }
        if (close) {
          g.lineTo(w, h)
          g.lineTo(0, h)
          g.closePath()
        }
      }
      g.globalAlpha = 0.25
      g.fillStyle = colors.input
      trace(inDb, true)
      g.fill()
      g.globalAlpha = 1
      g.strokeStyle = colors.accent
      g.lineWidth = 1.5
      trace(outDb, false)
      g.stroke()
      const curve = overlayRef.current
      if (curve) {
        // The overlay is a gain curve in dB around 0, drawn centred on the plot.
        g.strokeStyle = colors.text
        g.setLineDash([4, 3])
        g.lineWidth = 1
        g.beginPath()
        for (let c = 0; c <= COLUMNS; c++) {
          const hz = xToHz(c / COLUMNS)
          const y = h / 2 - (curve(hz) / 30) * h
          if (c === 0) g.moveTo(0, y)
          else g.lineTo((c / COLUMNS) * w, y)
        }
        g.stroke()
        g.setLineDash([])
      }
    }

    const tick = async () => {
      if (!alive || busy || frozenRef.current) return
      busy = true
      try {
        const samples = await source.read(FFT_SIZE)
        if (!alive) return
        if (samples) {
          const sr = source.sampleRate()
          if (samples.in) {
            spectrumColumnsDb(fft.analyze(samples.in), sr, COLUMNS, tiltRef.current, scratch)
            smoothDb(inDb, scratch, smoothing)
          }
          spectrumColumnsDb(fft.analyze(samples.out), sr, COLUMNS, tiltRef.current, scratch)
          smoothDb(outDb, scratch, smoothing)
          if (!gotData) {
            gotData = true
            setHasSignal(true)
          }
        }
        draw()
      } finally {
        busy = false
      }
    }

    draw()
    const timer = window.setInterval(() => void tick(), intervalMs)
    return () => {
      alive = false
      window.clearInterval(timer)
      source.stop()
    }
  }, [source])

  return (
    <div className={styles.wrap}>
      <div className={styles.plot}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          role="img"
          aria-label="Real-time spectrum: block input (filled) and output (line)"
        />
        {!hasSignal && (
          <span className={styles.empty}>
            {source ? 'Waiting for signal…' : 'Start the audio engine to see the spectrum.'}
          </span>
        )}
      </div>
      <div className={styles.controls}>
        <HardwareButton
          label="Freeze"
          size="small"
          active={frozen}
          onClick={() => setFrozen((f) => !f)}
        />
        <HardwareButton
          label="Tilt"
          size="small"
          active={tilt}
          title="Apply a 4.5 dB/octave tilt so guitar spectra read flatter"
          onClick={() => setTilt((t) => !t)}
        />
        <span className={styles.legend}>
          {!source?.outputOnly && (
            <>
              <i className={styles.keyIn} /> In{' '}
            </>
          )}
          <i className={styles.keyOut} /> Out
          {overlay ? (
            <>
              {' '}
              <i className={styles.keyCurve} /> Curve
            </>
          ) : null}
          {' · '}
          {MIN_HZ}–{MAX_HZ / 1000}k Hz
        </span>
      </div>
    </div>
  )
}
