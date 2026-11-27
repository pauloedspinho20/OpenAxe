import type { Modulation, SceneDefinition, SceneParam } from '../../types'
import { PATTERN_PRESETS } from './patterns'

/**
 * "Cymatics Labs" by Sidmaz666 - sand on a vibrating Chladni plate. Each
 * grain is pushed down the gradient of the plate's displacement energy
 * |z|^2, so the grains gather on the nodal lines of the standing wave.
 * Ported from the original Three.js (CPU physics + GLSL points) to a TSL
 * compute pass so it runs on WebGPU with a WebGL2 fallback, and made audio
 * reactive.
 *
 * New on top of the original: a "Follow pitch" pattern that maps the note
 * you play to the plate modes with the original's frequency -> mode rule
 * (plus an octave overtone), mode morphing, a shake impulse for attacks
 * and a hue shift.
 */
const params: readonly SceneParam[] = [
  {
    key: 'pattern',
    label: 'Pattern',
    group: 'Pattern',
    type: 'select',
    default: 'pitch',
    options: [
      { value: 'pitch', label: 'Follow pitch' },
      { value: 'manual', label: 'Manual oscillators' },
      ...PATTERN_PRESETS.map((p) => ({ value: p.id, label: p.name })),
    ],
    description:
      'Follow pitch maps the note you play to the plate modes; Manual uses the oscillators below.',
  },
  {
    key: 'waveform',
    label: 'Waveform',
    group: 'Pattern',
    type: 'select',
    default: 'sine',
    options: [
      { value: 'sine', label: 'Sine' },
      { value: 'square', label: 'Square' },
      { value: 'sawtooth', label: 'Sawtooth' },
      { value: 'triangle', label: 'Triangle' },
    ],
    description:
      'Shapes the force on the grains: square caps it, sawtooth swirls, triangle softens.',
  },
  {
    key: 'pitchScale',
    label: 'Pitch → mode scale',
    group: 'Pattern',
    type: 'number',
    min: 0.25,
    max: 4,
    step: 0.01,
    default: 1,
    description:
      'Multiplies the detected pitch before it is mapped to modes. Higher = busier plates.',
  },
  {
    key: 'harmonics',
    label: 'Octave overtone',
    group: 'Pattern',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.3,
    description: 'Follow pitch only: blends in the modes of the octave above.',
  },
  {
    key: 'quantize',
    label: 'Whole modes',
    group: 'Pattern',
    type: 'boolean',
    default: true,
    description:
      'Round modes to whole numbers (true Chladni figures). Off lets modulation morph them.',
  },
  {
    key: 'morphTime',
    label: 'Mode glide',
    group: 'Pattern',
    type: 'number',
    min: 0,
    max: 2,
    step: 0.01,
    default: 0.2,
    unit: 's',
    description: 'How long the plate takes to slide to a new pattern.',
  },

  ...([1, 2, 3] as const).flatMap((i): SceneParam[] => [
    {
      key: `m${i}`,
      label: `Osc ${i} mode m`,
      group: 'Manual oscillators',
      type: 'number',
      min: 1,
      max: 20,
      step: 1,
      default: [3, 2, 4][i - 1]!,
    },
    {
      key: `n${i}`,
      label: `Osc ${i} mode n`,
      group: 'Manual oscillators',
      type: 'number',
      min: 1,
      max: 20,
      step: 1,
      default: [5, 3, 7][i - 1]!,
    },
    {
      key: `amp${i}`,
      label: `Osc ${i} amplitude`,
      group: 'Manual oscillators',
      type: 'number',
      min: 0,
      max: 1,
      step: 0.01,
      default: [1, 0, 0][i - 1]!,
    },
  ]),

  {
    key: 'timeScale',
    label: 'Time scale',
    group: 'Physics',
    type: 'number',
    min: 0,
    max: 3,
    step: 0.01,
    default: 1,
  },
  { key: 'paused', label: 'Paused', group: 'Physics', type: 'boolean', default: false },
  {
    key: 'vibration',
    label: 'Vibration',
    group: 'Physics',
    type: 'number',
    min: 0,
    max: 4,
    step: 0.01,
    default: 1,
    description: 'Strength of the push toward the nodal lines.',
  },
  {
    key: 'speed',
    label: 'Speed',
    group: 'Physics',
    type: 'number',
    min: 0,
    max: 4,
    step: 0.01,
    default: 1,
  },
  {
    key: 'damping',
    label: 'Damping',
    group: 'Physics',
    type: 'number',
    min: 0.8,
    max: 0.999,
    step: 0.001,
    default: 0.98,
    description: 'Velocity kept per frame. Lower = grains settle faster.',
  },
  {
    key: 'noise',
    label: 'Noise',
    group: 'Physics',
    type: 'number',
    min: 0,
    max: 2,
    step: 0.01,
    default: 0.15,
    description: 'Random jitter that keeps the sand alive.',
  },
  {
    key: 'shake',
    label: 'Shake',
    group: 'Physics',
    type: 'number',
    min: 0,
    max: 4,
    step: 0.01,
    default: 0,
    description: 'Extra jitter that knocks grains off the lines; route an impulse (Attack) here.',
  },
  { key: 'scatter', label: 'Scatter sand', group: 'Physics', type: 'action' },
  {
    key: 'particleCount',
    label: 'Particles',
    group: 'Physics',
    type: 'number',
    min: 5000,
    max: 200000,
    step: 1000,
    default: 60000,
    rebuild: true,
  },

  {
    key: 'zoom',
    label: 'Zoom',
    group: 'View',
    type: 'number',
    min: 1,
    max: 4,
    step: 0.01,
    default: 1,
    description: 'Drag the stage to pan when zoomed in.',
  },
  { key: 'resetView', label: 'Reset view', group: 'View', type: 'action' },

  {
    key: 'palette',
    label: 'Palette',
    group: 'Colour',
    type: 'select',
    default: 'classic',
    options: [
      { value: 'classic', label: 'Classic sand' },
      { value: 'rainbow', label: 'Rainbow' },
      { value: 'heat', label: 'Heat map' },
      { value: 'ocean', label: 'Ocean' },
      { value: 'neon', label: 'Neon' },
      { value: 'custom', label: 'Custom' },
    ],
  },
  { key: 'colorA', label: 'Custom colour A', group: 'Colour', type: 'color', default: '#00ff88' },
  { key: 'colorB', label: 'Custom colour B', group: 'Colour', type: 'color', default: '#ff0066' },
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
    description: 'Rotates the palette around the colour wheel.',
  },
  {
    key: 'colorCycle',
    label: 'Colour cycle speed',
    group: 'Colour',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.005,
    default: 0.05,
    description: 'Drift speed of the Rainbow and Neon palettes.',
  },
  {
    key: 'backgroundColor',
    label: 'Background',
    group: 'Colour',
    type: 'color',
    default: '#0a0a0f',
  },

  {
    key: 'particleSize',
    label: 'Grain size',
    group: 'Look',
    type: 'number',
    min: 0.5,
    max: 8,
    step: 0.05,
    default: 1.6,
    unit: 'px',
  },
  {
    key: 'brightness',
    label: 'Brightness',
    group: 'Look',
    type: 'number',
    min: 0,
    max: 3,
    step: 0.01,
    default: 1,
  },
  {
    key: 'glow',
    label: 'Glow',
    group: 'Look',
    type: 'number',
    min: 0,
    max: 3,
    step: 0.01,
    default: 0.3,
  },
  {
    key: 'fieldOverlay',
    label: 'Field overlay',
    group: 'Look',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0,
    description: 'Shows the vibration energy |z|² of the plate under the sand.',
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
  // Volume: the plate vibrates harder and the sand glows.
  mod('vib-vol', 'vibration', 'volume', 0.2, 'ease'),
  mod('glow-vol', 'glow', 'volume', 0.15),
  mod('bright-sustain', 'brightness', 'sustain', 0.1),
  // Attacks knock the grains loose; they resettle on the lines.
  mod('shake-onset', 'shake', 'onset', 0.35, 'expo'),
  // Pitch: the note picks the hue (the pattern itself follows pitch in the scene).
  mod('hue-note', 'hueShift', 'pitchClass', 1, 'linear', 0.05),
  // Timbre.
  mod('harm-bright', 'harmonics', 'brightness', 0.3, 'ease', 0.1, 0.4),
  mod('noise-grit', 'noise', 'grit', 0.08, 'ease', 0.1, 0.5),
  mod('size-low', 'particleSize', 'bandLow', 0.04, 'ease'),
  mod('field-highmid', 'fieldOverlay', 'bandHighMid', 0.12, 'ease', 0.05, 0.4),
]

export const cymatics: SceneDefinition = {
  id: 'cymatics',
  name: 'Cymatics',
  description:
    'Sand on a vibrating Chladni plate: grains gather on the nodal lines of the note you play.',
  credit: {
    author: 'Sidmaz666',
    url: 'https://github.com/Sidmaz666/cymatics-labs',
    license: 'MIT',
    note: 'Ported from CPU physics + GLSL points to a TSL compute pass (WebGPU) and made audio reactive.',
  },
  params,
  modulations,
  load: () => import('./scene'),
}
