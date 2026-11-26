import type { Modulation, SceneDefinition, SceneParam } from '../../types'

/**
 * "Fractal Studio" - Julia set, Mandelbrot set and Mandelbulb, rendered per
 * pixel. Inspired by BiancaDogareci's Synesthesia Web App (fractal-studio):
 * the same three fractals and the same audio idea (bass breathes the zoom and
 * wobbles the Julia constant, strong bass collapses the Mandelbrot detail,
 * bass/treble push the Mandelbulb power). Re-implemented in TSL for WebGPU
 * with a WebGL2 fallback and wired to this app's audio features.
 *
 * `fractal`, `iterations` and `raySteps` are shader constants, so they are
 * `rebuild` params.
 */
const JULIA_PRESETS = [
  { value: 'chaos', label: 'Chaos', cx: -0.4, cy: -0.59 },
  { value: 'classic', label: 'Classic', cx: -0.7269, cy: 0.1889 },
  { value: 'dragon', label: 'Dragon', cx: -0.8, cy: 0.156 },
  { value: 'rabbit', label: 'Rabbit', cx: -0.123, cy: 0.745 },
  { value: 'spiral', label: 'Spiral', cx: -0.75, cy: 0.11 },
  { value: 'lotus', label: 'Lotus', cx: 0.285, cy: 0.01 },
] as const

/** Julia constant for a preset id; undefined for 'custom'. */
export function juliaPreset(id: unknown): { cx: number; cy: number } | undefined {
  return JULIA_PRESETS.find((p) => p.value === id)
}

const params: readonly SceneParam[] = [
  {
    key: 'fractal',
    label: 'Fractal',
    group: 'Fractal',
    type: 'select',
    default: 'julia',
    rebuild: true,
    options: [
      { value: 'julia', label: 'Julia set' },
      { value: 'mandelbrot', label: 'Mandelbrot set' },
      { value: 'mandelbulb', label: 'Mandelbulb (3D)' },
    ],
  },
  {
    key: 'juliaPreset',
    label: 'Julia preset',
    group: 'Fractal',
    type: 'select',
    default: 'chaos',
    options: [
      ...JULIA_PRESETS.map((p) => ({ value: p.value, label: p.label })),
      { value: 'custom', label: 'Custom (C below)' },
    ],
    description: 'Julia set only.',
  },
  {
    key: 'juliaCx',
    label: 'Julia C real',
    group: 'Fractal',
    type: 'number',
    min: -1.5,
    max: 1.5,
    step: 0.001,
    default: -0.4,
    description: 'Used when the preset is Custom.',
  },
  {
    key: 'juliaCy',
    label: 'Julia C imaginary',
    group: 'Fractal',
    type: 'number',
    min: -1.5,
    max: 1.5,
    step: 0.001,
    default: -0.59,
  },
  {
    key: 'wobbleX',
    label: 'C wobble X',
    group: 'Fractal',
    type: 'number',
    min: 0,
    max: 0.2,
    step: 0.001,
    default: 0.01,
    description: 'How far C drifts along the real axis (Julia).',
  },
  {
    key: 'wobbleY',
    label: 'C wobble Y',
    group: 'Fractal',
    type: 'number',
    min: 0,
    max: 0.2,
    step: 0.001,
    default: 0.01,
  },
  {
    key: 'power',
    label: 'Bulb power',
    group: 'Fractal',
    type: 'number',
    min: 2,
    max: 16,
    step: 0.01,
    default: 8,
    description: 'Mandelbulb exponent.',
  },
  {
    key: 'powerKick',
    label: 'Bulb power kick',
    group: 'Fractal',
    type: 'number',
    min: 0,
    max: 6,
    step: 0.01,
    default: 0,
    description: 'Added to the power; route an impulse (Attack) here.',
  },
  {
    key: 'iterations',
    label: 'Iterations',
    group: 'Quality',
    type: 'number',
    min: 20,
    max: 800,
    step: 1,
    default: 300,
    rebuild: true,
  },
  {
    key: 'raySteps',
    label: 'Ray steps',
    group: 'Quality',
    type: 'number',
    min: 20,
    max: 200,
    step: 1,
    default: 100,
    rebuild: true,
    description: 'Mandelbulb only.',
  },
  {
    key: 'detail',
    label: 'Detail',
    group: 'Quality',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.001,
    default: 1,
    description: 'Fraction of the iterations actually used. Low detail gives soft blobs.',
  },

  {
    key: 'zoom',
    label: 'Zoom',
    group: 'Camera',
    type: 'number',
    min: 0.3,
    max: 4,
    step: 0.01,
    default: 1,
  },
  {
    key: 'camDistance',
    label: 'Distance',
    group: 'Camera',
    type: 'number',
    min: 1.6,
    max: 6,
    step: 0.01,
    default: 3,
    description: 'Mandelbulb camera distance.',
  },
  {
    key: 'timeScale',
    label: 'Time scale',
    group: 'Animation',
    type: 'number',
    min: 0,
    max: 3,
    step: 0.01,
    default: 1,
  },
  { key: 'paused', label: 'Paused', group: 'Animation', type: 'boolean', default: false },
  {
    key: 'rotSpeed',
    label: 'Rotation speed',
    group: 'Animation',
    type: 'number',
    min: -2,
    max: 2,
    step: 0.01,
    default: 0.3,
  },
  {
    key: 'breathe',
    label: 'Breathing',
    group: 'Animation',
    type: 'number',
    min: 0,
    max: 0.2,
    step: 0.001,
    default: 0.03,
    description: 'Slow zoom in and out.',
  },
  { key: 'resetTime', label: 'Reset time', group: 'Animation', type: 'action' },

  {
    key: 'colorA',
    label: 'Primary',
    group: 'Colour',
    type: 'color',
    default: '#ff2e93',
  },
  {
    key: 'colorB',
    label: 'Secondary',
    group: 'Colour',
    type: 'color',
    default: '#2ee6ff',
  },
  {
    key: 'backgroundColor',
    label: 'Background',
    group: 'Colour',
    type: 'color',
    default: '#05020d',
  },
  { key: 'rainbow', label: 'Rainbow', group: 'Colour', type: 'boolean', default: false },
  {
    key: 'hueShift',
    label: 'Hue shift',
    group: 'Colour',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.001,
    default: 0,
    wrap: true,
  },
  {
    key: 'colorSpeed',
    label: 'Colour cycle speed',
    group: 'Colour',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.005,
    default: 0.05,
  },
  {
    key: 'bands',
    label: 'Band density',
    group: 'Colour',
    type: 'number',
    min: 0.01,
    max: 0.3,
    step: 0.001,
    default: 0.06,
    description: 'How quickly colour cycles with the escape count.',
  },
  {
    key: 'glow',
    label: 'Glow',
    group: 'Lighting',
    type: 'number',
    min: 0,
    max: 3,
    step: 0.01,
    default: 0.8,
  },
  {
    key: 'brightness',
    label: 'Brightness',
    group: 'Lighting',
    type: 'number',
    min: 0.2,
    max: 2.5,
    step: 0.01,
    default: 1,
  },
]

const mod = (
  id: string,
  param: string,
  source: Modulation['source'],
  amount: number,
  curve: Modulation['curve'] = 'linear',
  attack = 0,
  release = 0,
): Modulation => ({ id, param, source, amount, curve, attack, release, enabled: true })

const modulations: readonly Modulation[] = [
  // Bass: the fractal breathes and wobbles (the original's bass mapping).
  mod('zoom-low', 'zoom', 'bandLow', 0.05, 'ease', 0.02, 0.25),
  mod('wobx-low', 'wobbleX', 'bandLow', 0.5, 'ease'),
  mod('detail-low', 'detail', 'bandLow', -0.3, 'ease', 0.02, 0.3),
  // Treble: wobbles the other axis and pushes the bulb.
  mod('woby-high', 'wobbleY', 'bandHigh', 0.5, 'ease'),
  mod('power-high', 'power', 'bandHigh', 0.08, 'ease'),
  // Attacks kick the bulb's power and flash the glow.
  mod('kick-onset', 'powerKick', 'onset', 0.3, 'expo'),
  mod('glow-onset', 'glow', 'onset', 0.2, 'expo'),
  // Sustain and volume: motion and brightness.
  mod('rot-sustain', 'rotSpeed', 'sustain', 0.05),
  mod('bright-vol', 'brightness', 'volume', 0.1, 'ease'),
  // Pitch: note -> palette, register -> colour banding.
  mod('hue-note', 'hueShift', 'pitchClass', 1, 'linear', 0.05),
  mod('bands-bright', 'bands', 'brightness', 0.2, 'ease'),
]

export const fractalStudio: SceneDefinition = {
  id: 'fractal-studio',
  name: 'Fractal Studio',
  description: 'Julia set, Mandelbrot set and a ray-marched Mandelbulb that follow your playing.',
  credit: {
    author: 'Bianca Dogareci (Synesthesia Web App)',
    url: 'https://github.com/BiancaDogareci/Synesthesia-Web-App',
    note: 'Inspired by its fractal studio (Julia, Mandelbrot, Mandelbulb and the bass/treble mapping); re-implemented in TSL with this app’s audio features. Check the source repository for its licence.',
  },
  params,
  modulations,
  load: () => import('./scene'),
}
