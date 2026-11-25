import type { Modulation, SceneDefinition, SceneParam } from '../../types'

/**
 * "Bolt" by Adam Chernick (Codevember 2026, day 21) - a plasma globe:
 * filaments writhe from the electrode to the glass, each a rope of strands
 * that frays into twigs where it meets the glass, and a touch on the glass
 * pulls one bolt and its neighbours to that point. Ported from React Three
 * Fiber to a plain three.js scene (the CPU filament simulation is kept as
 * is) and made audio reactive.
 *
 * Audio drives an invisible "touch" on the glass: the note you play picks
 * where around the globe the lightning gathers (a clock face, one hour per
 * note), the register how far out toward the rim, and
 * held notes keep it there. The mouse still touches the glass as in the
 * original; dragging off the glass turns the view.
 *
 * Left out: IRL Hands (camera hand tracking), the sound, the HDRI rooms (the
 * glass reflects a small procedural room instead), the refracted rim pass
 * and the floating dust.
 */
const params: readonly SceneParam[] = [
  {
    key: 'storm',
    label: 'Storm',
    group: 'Discharge',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.2,
    description: 'How many filaments are lit and how fast they writhe.',
  },
  {
    key: 'timeScale',
    label: 'Time scale',
    group: 'Discharge',
    type: 'number',
    min: 0,
    max: 3,
    step: 0.01,
    default: 1,
  },
  { key: 'paused', label: 'Paused', group: 'Discharge', type: 'boolean', default: false },

  {
    key: 'touch',
    label: 'Touch',
    group: 'Audio touch',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0,
    description:
      'How firmly an invisible finger presses the glass. Above ~0.1 the lightning gathers to it.',
  },
  {
    key: 'touchAngle',
    label: 'Touch angle',
    group: 'Audio touch',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.001,
    default: 0.125,
    wrap: true,
    description:
      'Where around the globe the touch lands, as a clock face seen from the camera (0 = 12 o’clock). Each note is an hour.',
  },
  {
    key: 'touchReach',
    label: 'Touch reach',
    group: 'Audio touch',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.55,
    description: 'From the middle of the view (0) out to the rim of the globe (1).',
  },

  {
    key: 'gas',
    label: 'Gas',
    group: 'Colour',
    type: 'select',
    default: 'classic',
    options: [
      { value: 'classic', label: 'Classic' },
      { value: 'neon', label: 'Neon' },
      { value: 'argon', label: 'Argon' },
      { value: 'xenon', label: 'Xenon' },
    ],
  },
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
    key: 'gasGlow',
    label: 'Gas glow',
    group: 'Colour',
    type: 'number',
    min: 0,
    max: 3,
    step: 0.01,
    default: 1,
    description: 'The haze of lit gas inside the glass.',
  },
  {
    key: 'backgroundColor',
    label: 'Background',
    group: 'Colour',
    type: 'color',
    default: '#000000',
  },

  {
    key: 'camDistance',
    label: 'Distance',
    group: 'Camera',
    type: 'number',
    min: 2.2,
    max: 9,
    step: 0.01,
    default: 4.15,
  },
  {
    key: 'camHeight',
    label: 'Height',
    group: 'Camera',
    type: 'number',
    min: -0.8,
    max: 0.8,
    step: 0.01,
    default: 0.05,
    description: 'Elevation, as a fraction of a quarter turn.',
  },
  {
    key: 'orbitSpeed',
    label: 'Orbit speed',
    group: 'Camera',
    type: 'number',
    min: -1,
    max: 1,
    step: 0.01,
    default: 0.04,
    description: 'Turns per minute ×10. Dragging off the glass also turns the view.',
  },
  {
    key: 'fov',
    label: 'FOV',
    group: 'Camera',
    type: 'number',
    min: 15,
    max: 70,
    step: 0.5,
    default: 34,
    unit: '°',
  },
  { key: 'resetView', label: 'Reset view', group: 'Camera', type: 'action' },

  {
    key: 'exposure',
    label: 'Exposure',
    group: 'Look',
    type: 'number',
    min: 0.1,
    max: 4,
    step: 0.01,
    default: 1.05,
  },
  {
    key: 'bloom',
    label: 'Bloom',
    group: 'Look',
    type: 'number',
    min: 0,
    max: 3,
    step: 0.01,
    default: 0.5,
  },
  {
    key: 'bloomThreshold',
    label: 'Bloom threshold',
    group: 'Look',
    type: 'number',
    min: 0,
    max: 2,
    step: 0.01,
    default: 1,
  },
  {
    key: 'reflections',
    label: 'Glass reflections',
    group: 'Look',
    type: 'number',
    min: 0,
    max: 3,
    step: 0.01,
    default: 1,
  },
  {
    key: 'aura',
    label: 'Room glow',
    group: 'Look',
    type: 'number',
    min: 0,
    max: 3,
    step: 0.01,
    default: 1,
    description: 'Light the globe throws into the air around it.',
  },
  {
    key: 'vignette',
    label: 'Vignette',
    group: 'Look',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.6,
  },

  {
    key: 'quality',
    label: 'Detail',
    group: 'Quality',
    type: 'select',
    default: 'medium',
    rebuild: true,
    options: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
    ],
    description: 'Strands, points and branches per filament, and the most filaments lit.',
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
  // Playing touches the glass: the note picks the clock position, the register how far out, held notes keep it there.
  mod('touch-sustain', 'touch', 'sustain', 0.9, 'ease', 0.02, 0.35),
  mod('touch-onset', 'touch', 'onset', 0.5, 'expo'),
  mod('angle-note', 'touchAngle', 'pitchClass', 1, 'linear', 0.04),
  mod('reach-register', 'touchReach', 'register', 0.45, 'ease', 0.1, 0.3),
  // Volume and attacks: a wilder storm and flashes of bloom.
  mod('storm-vol', 'storm', 'volume', 0.45, 'ease', 0.05, 0.6),
  mod('bloom-onset', 'bloom', 'onset', 0.25, 'expo'),
  mod('exp-vol', 'exposure', 'volume', 0.05, 'ease'),
  // Timbre.
  mod('gas-low', 'gasGlow', 'bandLow', 0.2, 'ease', 0.05, 0.4),
  mod('time-grit', 'timeScale', 'grit', 0.15, 'ease', 0.1, 0.5),
]

export const plasmaGlobe: SceneDefinition = {
  id: 'plasma-globe',
  name: 'Plasma Globe',
  description: 'Lightning in a glass globe that gathers to wherever the note you play touches it.',
  credit: {
    author: 'Adam Chernick',
    url: 'https://github.com/acher249/codevember-2026/tree/main/21-bolt',
    license: 'MIT',
    note: 'Codevember 2026, day 21 "Bolt". Ported from React Three Fiber to a plain three.js scene and made audio reactive.',
  },
  params,
  modulations,
  load: () => import('./scene'),
}
