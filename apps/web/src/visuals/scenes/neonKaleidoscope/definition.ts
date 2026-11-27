import type { Modulation, SceneDefinition, SceneParam } from '../../types'

/**
 * "Neon Kaleidoscope" - a recursive folded-domain kaleidoscope of glowing
 * bands, drawn per pixel. Ported from Sabo Sugi's "Neon Kaleidoscope" CodePen
 * (GLSL, three.js) to TSL, with the pen's "Preset 1" as the defaults.
 *
 * `iterations` is the unrolled layer count, so it is a `rebuild` param.
 */
const params: readonly SceneParam[] = [
  {
    key: 'iterations',
    label: 'Iterations',
    group: 'Geometry',
    type: 'number',
    min: 1,
    max: 12,
    step: 1,
    default: 10,
    rebuild: true,
    description: 'Layers of recursion. More is richer and slower.',
  },
  {
    key: 'cellScale',
    label: 'Cell scale',
    group: 'Geometry',
    type: 'number',
    min: 0.5,
    max: 3,
    step: 0.01,
    default: 1.16,
  },
  {
    key: 'formRadius',
    label: 'Form radius',
    group: 'Geometry',
    type: 'number',
    min: 0.1,
    max: 2,
    step: 0.01,
    default: 0.69,
  },
  {
    key: 'formAngularity',
    label: 'Form angularity',
    group: 'Geometry',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    default: 1,
    description: '0 is round, 1 is faceted.',
  },
  {
    key: 'cornerWeight',
    label: 'Corner weight',
    group: 'Geometry',
    type: 'number',
    min: 0.1,
    max: 1,
    step: 0.01,
    default: 0.45,
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
    key: 'colorRate',
    label: 'Colour rate',
    group: 'Animation',
    type: 'number',
    min: 0,
    max: 2,
    step: 0.01,
    default: 0.5,
  },
  {
    key: 'phaseRate',
    label: 'Phase rate',
    group: 'Animation',
    type: 'number',
    min: 0,
    max: 3,
    step: 0.01,
    default: 1,
    description: 'How fast the bands travel.',
  },
  {
    key: 'layerShift',
    label: 'Layer shift',
    group: 'Animation',
    type: 'number',
    min: 0,
    max: 2,
    step: 0.01,
    default: 0.5,
    description: 'Colour offset between layers.',
  },
  {
    key: 'hueShift',
    label: 'Hue shift',
    group: 'Animation',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.001,
    default: 0,
    wrap: true,
  },

  {
    key: 'bandFrequency',
    label: 'Band frequency',
    group: 'Material',
    type: 'number',
    min: 1,
    max: 60,
    step: 0.1,
    default: 36.1,
  },
  {
    key: 'bandDivisor',
    label: 'Band divisor',
    group: 'Material',
    type: 'number',
    min: 0.5,
    max: 15,
    step: 0.01,
    default: 3.41,
  },
  {
    key: 'lightWidth',
    label: 'Light width',
    group: 'Material',
    type: 'number',
    min: 0.001,
    max: 0.1,
    step: 0.001,
    default: 0.02,
  },
  {
    key: 'lightPower',
    label: 'Light power',
    group: 'Material',
    type: 'number',
    min: 0.1,
    max: 4,
    step: 0.01,
    default: 1.5,
  },
  {
    key: 'brightness',
    label: 'Brightness',
    group: 'Material',
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
  // Level: louder playing widens and brightens the light.
  mod('width-vol', 'lightWidth', 'volume', 0.2, 'ease'),
  mod('bright-vol', 'brightness', 'volume', 0.15, 'ease'),
  // Attacks flash the bands.
  mod('width-onset', 'lightWidth', 'onset', 0.15, 'expo'),
  // Bass breathes the shapes; treble tightens the bands.
  mod('radius-low', 'formRadius', 'bandLow', 0.08, 'ease', 0.02, 0.25),
  mod('freq-high', 'bandFrequency', 'bandHigh', 0.1, 'ease'),
  // Grit roughens the form towards the faceted look.
  mod('angular-grit', 'formAngularity', 'grit', -0.2, 'ease'),
  // Held notes speed the bands up.
  mod('phase-sustain', 'phaseRate', 'sustain', 0.2, 'ease', 0.1, 0.4),
  // Pitch: note -> palette.
  mod('hue-note', 'hueShift', 'pitchClass', 1, 'linear', 0.05),
]

export const neonKaleidoscope: SceneDefinition = {
  id: 'neon-kaleidoscope',
  name: 'Neon Kaleidoscope',
  description: 'Recursive neon geometry that folds in on itself and pulses with your playing.',
  credit: {
    author: 'Sabo Sugi',
    url: 'https://codepen.io/sabosugi/pen/01a02f92-c5a4-7680-9919-88d6778ba369',
    license: 'CodePen public pen',
    note: 'Ported from GLSL to TSL (WebGPU) and made audio reactive.',
  },
  params,
  modulations,
  load: () => import('./scene'),
}
