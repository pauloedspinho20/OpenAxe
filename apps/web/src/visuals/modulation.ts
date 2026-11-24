import { FEATURE_BY_ID, type AudioFeatures } from './audio/features'
import { follow } from './audio/FeatureEngine'
import type { ModCurve, Modulation, NumberParam, ParamValues, SceneParam } from './types'

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

export const CURVES: readonly { value: ModCurve; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'ease', label: 'Ease' },
  { value: 'expo', label: 'Expo' },
  { value: 'gate', label: 'Gate' },
]

export function shape(curve: ModCurve, x: number): number {
  const v = clamp01(x)
  switch (curve) {
    case 'ease':
      return v * v * (3 - 2 * v)
    case 'expo':
      return v * v * v
    case 'gate':
      return v > 0.5 ? 1 : 0
    default:
      return v
  }
}

/** Shortest signed distance from a to b on a 0..1 wheel. */
function wrapDelta(a: number, b: number) {
  let d = (b - a) % 1
  if (d > 0.5) d -= 1
  if (d < -0.5) d += 1
  return d
}

/**
 * Applies audio routes to a scene's base values, once per frame. Keeps the
 * per-route smoothing state between frames; drop it with `reset()` when the
 * scene changes.
 */
export class Modulator {
  private readonly state = new Map<string, number>()

  reset() {
    this.state.clear()
  }

  apply(
    params: readonly SceneParam[],
    base: Readonly<ParamValues>,
    mods: readonly Modulation[],
    audio: Readonly<AudioFeatures>,
    dt: number,
    out: ParamValues,
  ): ParamValues {
    for (const key in out) delete out[key]
    Object.assign(out, base)
    if (mods.length === 0) return out

    const byKey = new Map<string, NumberParam>()
    for (const p of params) if (p.type === 'number' && !p.rebuild) byKey.set(p.key, p)

    for (const m of mods) {
      if (!m.enabled || m.amount === 0) continue
      const p = byKey.get(m.param)
      if (!p) continue
      const cyclic = FEATURE_BY_ID[m.source]?.cyclic ?? false
      const raw = audio[m.source] ?? 0
      let s = this.state.get(m.id)
      if (s === undefined) s = raw
      else if (cyclic) {
        const tau = m.attack
        s = tau > 0 ? s + wrapDelta(s, raw) * (1 - Math.exp(-dt / tau)) : raw
        s -= Math.floor(s)
      } else s = follow(s, raw, dt, m.attack, m.release)
      this.state.set(m.id, s)

      // A cyclic source's value already is a position on the wheel: no curve.
      const v = cyclic ? s : shape(m.curve, s)
      const current = out[p.key]
      if (typeof current !== 'number') continue
      out[p.key] = current + m.amount * v * (p.max - p.min)
    }

    for (const p of byKey.values()) {
      const v = out[p.key]
      if (typeof v !== 'number') continue
      if (p.wrap) {
        const span = p.max - p.min
        out[p.key] = p.min + ((((v - p.min) % span) + span) % span)
      } else out[p.key] = Math.min(p.max, Math.max(p.min, v))
    }
    return out
  }
}
