import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Meter, MiniMeter, MediumMeter, StereoMeter, levelToPeakDb } from '@openaxe/ui'

/**
 * The narrow analyser surface the meters actually read. Both the Web Audio
 * `AnalyserNode` and the desktop shell's `NativeAnalyser` shim satisfy it
 * (declared with method syntax so the two remain mutually assignable), so the
 * same components work on both engines without casting at the call site.
 */
export interface MeterAnalyser {
  readonly fftSize: number
  getByteTimeDomainData(array: Uint8Array): void
}

export interface LiveMeterProps {
  label?: string
  analyser: MeterAnalyser | null
  /** 'segments' (default) is the full VU-style meter; 'mini' is a single bar for tight spaces. */
  variant?: 'segments' | 'medium' | 'mini'
}

/** Rolling peak-hold window for the dB readout above the medium/large meters. */
const PEAK_WINDOW_MS = 1000

/** Peak of a time-domain byte buffer in [0, 1] - the same calc everywhere. */
function readPeak(analyser: MeterAnalyser, buffer: Uint8Array): number {
  analyser.getByteTimeDomainData(buffer)
  let peak = 0
  for (let i = 0; i < buffer.length; i++) {
    peak = Math.max(peak, Math.abs(buffer[i]! - 128) / 128)
  }
  return peak
}

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
      const peak = readPeak(analyser, buffer)
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
        {...(label !== undefined ? { label } : {})}
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

export interface LiveStereoMeterProps {
  /** Group label rendered below the pair (e.g. "Output"). */
  label?: string
  /** Left-channel tap; null reads as silence. */
  analyserL: MeterAnalyser | null
  /** Right-channel tap; null reads as silence. */
  analyserR: MeterAnalyser | null
}

/**
 * Stereo sibling of `LiveMeter`: drives the slim L/R `StereoMeter` pair from
 * two per-channel analysers through a single shared requestAnimationFrame
 * loop, with an independent rolling 1-second peak-hold readout per side.
 * A missing side renders as silence (same as `LiveMeter` with no analyser).
 */
export function LiveStereoMeter({ label, analyserL, analyserR }: LiveStereoMeterProps) {
  const [levelL, setLevelL] = useState(0)
  const [levelR, setLevelR] = useState(0)
  const [valueLabelL, setValueLabelL] = useState<string | undefined>(undefined)
  const [valueLabelR, setValueLabelR] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!analyserL && !analyserR) {
      setLevelL(0)
      setLevelR(0)
      setValueLabelL(undefined)
      setValueLabelR(undefined)
      return
    }
    const bufferL = analyserL ? new Uint8Array(analyserL.fftSize) : null
    const bufferR = analyserR ? new Uint8Array(analyserR.fftSize) : null
    const windowL: Array<[number, number]> = []
    const windowR: Array<[number, number]> = []
    let frame: number

    const holdLabel = (
      window: Array<[number, number]>,
      peak: number,
      setLabel: Dispatch<SetStateAction<string | undefined>>,
    ) => {
      const now = performance.now()
      window.push([now, peak])
      const cutoff = now - PEAK_WINDOW_MS
      while (window.length > 0 && window[0]![0] < cutoff) window.shift()
      let held = 0
      for (const [, v] of window) held = Math.max(held, v)
      setLabel((prev) => {
        const next = levelToPeakDb(held)
        return prev === next ? prev : next
      })
    }

    const tick = () => {
      if (analyserL && bufferL) {
        const peak = readPeak(analyserL, bufferL)
        setLevelL(peak)
        holdLabel(windowL, peak, setValueLabelL)
      }
      if (analyserR && bufferR) {
        const peak = readPeak(analyserR, bufferR)
        setLevelR(peak)
        holdLabel(windowR, peak, setValueLabelR)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [analyserL, analyserR])

  return (
    <StereoMeter
      levelL={levelL}
      levelR={levelR}
      title={label}
      {...(label !== undefined ? { label } : {})}
      {...(valueLabelL !== undefined ? { valueLabelL } : {})}
      {...(valueLabelR !== undefined ? { valueLabelR } : {})}
    />
  )
}
