import { useEffect, useState } from 'react'
import { MediumMeter } from '@openaxe/ui'
import type { GraphRig } from '@/engine/GraphRig'
import type { NativeGraphRig } from '@/native/NativeGraphRig'

type Rig = GraphRig | NativeGraphRig

const GR_RANGE_DB = 20

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

export interface DynamicsMeterProps {
  rig: Rig | null
  blockId: string
  kind: string
}

/**
 * Medium vertical meter for dynamics blocks:
 * - compressor: gain reduction (red-only, 0..GR_RANGE_DB)
 * - noise-gate: gate openness (red-only, 0..1)
 *
 * Driven by the core's metering (openaxe_get_gain_reduction /
 * openaxe_get_gate_gain) polled via the rig's own meter polling.
 */
export function DynamicsMeter({ rig, blockId, kind }: DynamicsMeterProps) {
  const [level, setLevel] = useState(0)
  const [title, setTitle] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!rig || (kind !== 'compressor' && kind !== 'noise-gate')) {
      setLevel(0)
      return
    }
    let raf: number
    let alive = true

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
      } else if (kind === 'noise-gate') {
        const gain =
          (rig as unknown as { getGateGain: (id: string) => number }).getGateGain?.(blockId) ?? 0
        const lvl = clamp01(gain)
        // Convert gain to attenuation for tooltip when closed
        const grDb = gain > 0 ? 20 * Math.log10(Math.max(gain, 1e-6)) : -100
        if (lvl > 0.99) setTitle('Gate: open')
        else if (lvl < 0.01) setTitle(`Gate: closed (${grDb.toFixed(0)} dB)`)
        else setTitle(`Gate: ${Math.round(lvl * 100)}% open`)
        setLevel(lvl)
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

  const label = kind === 'compressor' ? 'GR' : 'Gate'

  // Always red for dynamics, per spec. Wrapped with a label like Meter does.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <MediumMeter level={level} variant="gainReduction" title={title} />
      <span className="label" style={{ fontSize: 9, opacity: 0.7 }}>
        {label}
      </span>
    </div>
  )
}
