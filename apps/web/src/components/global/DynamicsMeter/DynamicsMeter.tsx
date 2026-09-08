import { useEffect, useRef, useState } from 'react'
import { MediumMeter } from '@openaxe/ui'
import type { GraphRig } from '@/engine/GraphRig'
import type { NativeGraphRig } from '@/native/NativeGraphRig'

type Rig = GraphRig | NativeGraphRig

const GR_RANGE_DB = 20

/** Rolling peak-hold window for the dB label, matching the level meters' 1 s hold. */
const PEAK_WINDOW_MS = 1000

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/** Format a dB value (≤0) for the label above the meter: −6.2, 0.0 dB. */
function dbLabel(db: number): string {
  if (db >= -0.05) return '0.0 dB'
  return `${db.toFixed(1).replace('-', '−')}`
}

export interface DynamicsMeterProps {
  rig: Rig | null
  blockId: string
  kind: string
}

/**
 * Medium vertical meter for dynamics blocks:
 * - compressor: gain reduction (red-only, 0..GR_RANGE_DB), labelled with the
 *   peak reduction in dB over the trailing 1 second.
 * - noise-gate: what's being gated (red-only) - inverted from the gate's
 *   openness so a closed gate reads as a full bar, like a gain-reduction
 *   meter (open gate = no gating = empty bar), labelled with the peak
 *   attenuation over the trailing 1 second.
 *
 * Driven by the core's metering (openaxe_get_gain_reduction /
 * openaxe_get_gate_gain) polled via the rig's own meter polling.
 */
export function DynamicsMeter({ rig, blockId, kind }: DynamicsMeterProps) {
  const [level, setLevel] = useState(0)
  const [title, setTitle] = useState<string | undefined>(undefined)
  const [valueLabel, setValueLabel] = useState<string | undefined>(undefined)
  const peakWindowRef = useRef<Array<[number, number]>>([])

  useEffect(() => {
    if (!rig || (kind !== 'compressor' && kind !== 'noise-gate')) {
      setLevel(0)
      setValueLabel(undefined)
      return
    }
    peakWindowRef.current = []
    let raf: number
    let alive = true

    // Push one dB reading into the rolling window and return the deepest cut
    // in the trailing 1 s (dB ≤ 0, so the peak is the minimum). The label only
    // steps up in depth within the window and rolls back as old cuts age out.
    const pushPeakDb = (db: number): number => {
      const now = performance.now()
      const window = peakWindowRef.current
      window.push([now, db])
      const cutoff = now - PEAK_WINDOW_MS
      while (window.length > 0 && window[0]![0] < cutoff) window.shift()
      let deepest = 0
      for (const [, v] of window) deepest = Math.min(deepest, v)
      return deepest
    }

    const tick = () => {
      if (!alive) return
      if (kind === 'compressor') {
        const grDb =
          (rig as unknown as { getGainReduction: (id: string) => number }).getGainReduction?.(
            blockId,
          ) ?? 0
        // grDb is ≤0, 0 = no reduction. Map -GR_RANGE_DB..0 -> 0..1
        const lvl = clamp01(-grDb / GR_RANGE_DB)
        setLevel(lvl)
        setTitle(grDb < -0.1 ? `GR: ${grDb.toFixed(1)} dB` : 'GR: 0 dB')
        setValueLabel(dbLabel(pushPeakDb(grDb)))
      } else if (kind === 'noise-gate') {
        const gain =
          (rig as unknown as { getGateGain: (id: string) => number }).getGateGain?.(blockId) ?? 0
        // Inverted: show how much the gate is attenuating. Open (gain 1) → empty,
        // closed (gain 0) → full. Convert openness to attenuation for the label.
        const gated = 1 - clamp01(gain)
        const grDb = gain > 0 ? 20 * Math.log10(Math.max(gain, 1e-6)) : -100
        if (gated < 0.01) setTitle('Gate: open')
        else if (gated > 0.99) setTitle(`Gate: closed (${grDb.toFixed(0)} dB)`)
        else setTitle(`Gate: ${Math.round(gated * 100)}% gated`)
        setLevel(gated)
        setValueLabel(dbLabel(pushPeakDb(grDb)))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
    }
  }, [rig, blockId, kind])

  if (kind !== 'compressor' && kind !== 'noise-gate') return null

  // Always red for dynamics. The value label above the bar carries the peak
  // reading over the last 2 s (gain reduction dB for the compressor,
  // attenuation dB for the gate).
  return (
    <MediumMeter
      level={level}
      variant="gainReduction"
      label="GR"
      title={title}
      {...(valueLabel !== undefined ? { valueLabel } : {})}
    />
  )
}
