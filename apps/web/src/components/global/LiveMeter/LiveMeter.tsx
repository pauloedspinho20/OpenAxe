import { useEffect, useRef, useState } from 'react'
import { Meter, MiniMeter, MediumMeter, levelToPeakDb } from '@openaxe/ui'

export interface LiveMeterProps {
  label?: string
  analyser: AnalyserNode | null
  /** 'segments' (default) is the full VU-style meter; 'mini' is a single bar for tight spaces. */
  variant?: 'segments' | 'medium' | 'mini'
}

/** Rolling peak-hold window for the dB readout above the medium/large meters. */
const PEAK_WINDOW_MS = 1000

/**
 * Drives the presentational Meter from a live AnalyserNode via its own
 * requestAnimationFrame loop and local state, so the ~60fps updates don't
 * re-render anything outside this component. Also keeps a rolling 1-second
 * peak in dB and hands it to the medium/large meters as `valueLabel` - the
 * presentational Meter/MediumMeter stay passive, this component owns the
 * window.
 */
export function LiveMeter({ label, analyser, variant = 'segments' }: LiveMeterProps) {
  const [level, setLevel] = useState(0)
  const [valueLabel, setValueLabel] = useState<string | undefined>(undefined)
  const bufferRef = useRef<Uint8Array<ArrayBuffer> | null>(null)
  const peakWindowRef = useRef<Array<[number, number]>>([])

  useEffect(() => {
    if (!analyser) {
      setLevel(0)
      setValueLabel(undefined)
      return
    }
    bufferRef.current ??= new Uint8Array(analyser.fftSize) as Uint8Array<ArrayBuffer>
    let frame: number

    const tick = () => {
      const buffer = bufferRef.current!
      analyser.getByteTimeDomainData(buffer)
      let peak = 0
      for (let i = 0; i < buffer.length; i++) {
        peak = Math.max(peak, Math.abs(buffer[i]! - 128) / 128)
      }
      // Rolling peak-hold over the trailing 1 s: the label only steps up within
      // the window and rolls back down as older, louder samples age out.
      const now = performance.now()
      const window = peakWindowRef.current
      window.push([now, peak])
      const cutoff = now - PEAK_WINDOW_MS
      while (window.length > 0 && window[0]![0] < cutoff) window.shift()
      let held = 0
      for (const [, v] of window) held = Math.max(held, v)
      setValueLabel((prev) => {
        const next = levelToPeakDb(held)
        return prev === next ? prev : next
      })
      setLevel(peak)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [analyser])

  if (variant === 'mini') return <MiniMeter level={level} title={label} />
  if (variant === 'medium') {
    return (
      <MediumMeter
        level={level}
        title={label}
        {...(valueLabel !== undefined ? { valueLabel } : {})}
      />
    )
  }
  const meterProps = {
    level,
    ...(label !== undefined ? { label } : {}),
    ...(valueLabel !== undefined ? { valueLabel } : {}),
  }
  return <Meter {...meterProps} />
}
