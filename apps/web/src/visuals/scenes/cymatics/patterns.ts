/**
 * Plate modes for the Cymatics scene. Pure data and maths (no three.js) so
 * the definition can list the presets and tests can check the mapping.
 *
 * Presets and the frequency -> mode rule come from Sidmaz666's Cymatics Labs
 * (MIT): https://github.com/Sidmaz666/cymatics-labs
 */

/** One standing wave on the plate: mode numbers (m, n) and its amplitude. */
export interface PlateMode {
  readonly m: number
  readonly n: number
  readonly amp: number
}

export interface PatternPreset {
  readonly id: string
  readonly name: string
  readonly modes: readonly PlateMode[]
}

/** The scene superposes at most this many modes. */
export const MAX_MODES = 4

const p = (m: number, n: number, amp: number): PlateMode => ({ m, n, amp })

export const PATTERN_PRESETS: readonly PatternPreset[] = [
  { id: 'chladni-12', name: 'Chladni (1,2)', modes: [p(1, 2, 1)] },
  { id: 'chladni-23', name: 'Chladni (2,3)', modes: [p(2, 3, 1)] },
  { id: 'chladni-35', name: 'Chladni (3,5)', modes: [p(3, 5, 1)] },
  { id: 'chladni-47', name: 'Chladni (4,7)', modes: [p(4, 7, 1)] },
  { id: 'chladni-58', name: 'Chladni (5,8)', modes: [p(5, 8, 1)] },
  {
    id: 'sri-yantra',
    name: 'Sri Yantra',
    modes: [p(2, 3, 1), p(3, 2, 0.8), p(2, 5, 0.5), p(5, 2, 0.4)],
  },
  { id: 'lotus', name: 'Lotus', modes: [p(1, 4, 1), p(4, 1, 0.7), p(2, 5, 0.5), p(5, 2, 0.3)] },
  { id: 'trident', name: 'Trident', modes: [p(1, 3, 1), p(3, 1, 0.7), p(2, 5, 0.5)] },
  { id: 'fifth', name: 'Perfect fifth', modes: [p(3, 5, 1), p(4, 6, 0.7)] },
  { id: 'triad', name: 'Major triad', modes: [p(3, 5, 1), p(4, 6, 0.6), p(4, 7, 0.4)] },
  {
    id: 'harmonic-series',
    name: 'Harmonic series',
    modes: [p(2, 3, 1), p(3, 5, 0.7), p(4, 6, 0.5), p(5, 7, 0.3)],
  },
  { id: 'cross', name: 'Symmetric cross', modes: [p(2, 5, 1), p(5, 2, 0.8)] },
  { id: 'diamond', name: 'Diamond lattice', modes: [p(2, 6, 1), p(6, 2, 0.7), p(3, 7, 0.5)] },
  {
    id: 'starburst',
    name: 'Starburst',
    modes: [p(6, 1, 0.8), p(1, 6, 0.8), p(8, 2, 0.5), p(2, 8, 0.5)],
  },
  {
    id: 'aurora',
    name: 'Aurora',
    modes: [p(3, 7, 0.7), p(7, 3, 0.5), p(5, 9, 0.3), p(9, 5, 0.2)],
  },
  { id: 'quantum-foam', name: 'Quantum foam', modes: [p(9, 4, 0.7), p(4, 9, 0.5), p(12, 7, 0.3)] },
]

export const MODE_MIN = 1
export const MODE_MAX = 20
/** Frequency that maps to modes (3, 5), the classic plate. */
export const BASE_HZ = 220

/**
 * The original's frequency -> mode rule, unrounded:
 * m = sqrt(f / 220) * 3, n = sqrt(f / 220) * 5, clamped to 1..20.
 */
export function modesFromFrequency(hz: number): { m: number; n: number } {
  const r = Math.sqrt(Math.max(hz, 0) / BASE_HZ)
  const clamp = (v: number) => Math.min(MODE_MAX, Math.max(MODE_MIN, v))
  return { m: clamp(r * 3), n: clamp(r * 5) }
}
