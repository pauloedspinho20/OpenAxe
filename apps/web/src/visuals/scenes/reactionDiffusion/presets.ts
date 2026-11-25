/**
 * Gray-Scott regimes for the Reaction Diffusion scene: named (feed, kill)
 * operating points, tuned for Du = 1, Dv = 0.5. Pure data (no three.js) so
 * the definition can list them and tests can check them.
 *
 * From Shader Effects Inc.'s `ReactionDiffusion` component (MIT):
 * https://github.com/shader-effects-inc/shaders - which collects the classic
 * coral/mitosis values and points from the mrob/pmneila xmorphia atlas.
 */
export interface GrayScottRegime {
  readonly id: string
  readonly name: string
  readonly feed: number
  readonly kill: number
}

export const REGIMES: readonly GrayScottRegime[] = [
  { id: 'coral', name: 'Coral', feed: 0.0545, kill: 0.062 },
  { id: 'mitosis', name: 'Mitosis', feed: 0.0367, kill: 0.0649 },
  { id: 'spots', name: 'Spots', feed: 0.03, kill: 0.062 },
  { id: 'maze', name: 'Maze', feed: 0.029, kill: 0.057 },
  { id: 'worms', name: 'Worms', feed: 0.078, kill: 0.061 },
  { id: 'fingerprints', name: 'Fingerprints', feed: 0.037, kill: 0.06 },
  { id: 'holes', name: 'Holes', feed: 0.039, kill: 0.058 },
  { id: 'solitons', name: 'Solitons', feed: 0.074, kill: 0.064 },
  { id: 'bubbles', name: 'Bubbles', feed: 0.098, kill: 0.0555 },
  { id: 'waves', name: 'Waves', feed: 0.014, kill: 0.045 },
  { id: 'flowers', name: 'Flowers', feed: 0.062, kill: 0.06093 },
]

/** Feed/kill stay inside the band where Gray-Scott is stable and interesting. */
export const FEED_RANGE = [0.008, 0.11] as const
export const KILL_RANGE = [0.03, 0.075] as const

/**
 * The (feed, kill) to simulate: the regime's point (or the custom sliders)
 * plus the modulatable offsets, clamped into the stable band.
 */
export function operatingPoint(
  regime: string,
  custom: { feed: number; kill: number },
  offset: { feed: number; kill: number },
): { feed: number; kill: number } {
  const base = REGIMES.find((r) => r.id === regime) ?? custom
  const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v))
  return {
    feed: clamp(base.feed + offset.feed, FEED_RANGE),
    kill: clamp(base.kill + offset.kill, KILL_RANGE),
  }
}
