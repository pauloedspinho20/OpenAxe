import { useEffect, useRef, useState } from 'react'
import { Meter, MiniMeter } from '@/components/primitives/Meter/Meter'

export interface LiveMeterProps {
  label?: string
  analyser: AnalyserNode | null
  /** 'segments' (default) is the full VU-style meter; 'mini' is a single bar for tight spaces. */
  variant?: 'segments' | 'mini'
}

/**
 * Drives the presentational Meter from a live AnalyserNode via its own
 * requestAnimationFrame loop and local state, so the ~60fps updates don't
 * re-render anything outside this component.
 */
export function LiveMeter({ label, analyser, variant = 'segments' }: LiveMeterProps) {
  const [level, setLevel] = useState(0)
  const bufferRef = useRef<Uint8Array<ArrayBuffer> | null>(null)

  useEffect(() => {
    if (!analyser) {
      setLevel(0)
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
      setLevel(peak)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [analyser])

  if (variant === 'mini') return <MiniMeter level={level} title={label} />
  return label === undefined ? <Meter level={level} /> : <Meter label={label} level={level} />
}
