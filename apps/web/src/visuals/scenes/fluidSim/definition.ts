import type { Modulation, SceneDefinition, SceneParam } from '../../types'

/**
 * "Fluid Simulation" - a real-time Navier-Stokes fluid (advection, vorticity
 * confinement, pressure projection) with dye. Ported from Pavel Dobryakov's
 * WebGL-Fluid-Simulation to TSL (WebGPU, WebGL2 fallback). Notes and
 * attacks inject coloured splats; you can also drag on the canvas to stir it.
 *
 * `simResolution` and `dyeResolution` size the render targets, so they are
 * `rebuild` params.
 */
export const SIM_RESOLUTIONS = [32, 64, 128, 256] as const
export const DYE_RESOLUTIONS = [256, 512, 1024] as const

const params: readonly SceneParam[] = [
  {
    key: 'simResolution',
    label: 'Simulation resolution',
    group: 'Quality',
    type: 'select',
    default: '128',
    rebuild: true,
    options: SIM_RESOLUTIONS.map((r) => ({ value: String(r), label: String(r) })),
  },
  {
    key: 'dyeResolution',
    label: 'Dye resolution',
    group: 'Quality',
    type: 'select',
    default: '512',
    rebuild: true,
    options: DYE_RESOLUTIONS.map((r) => ({ value: String(r), label: String(r) })),
  },
  {
    key: 'pressureIterations',
    label: 'Pressure iterations',
    group: 'Quality',
    type: 'number',
    min: 1,
    max: 50,
    step: 1,
    default: 20,
    description: 'More is more incompressible, and slower.',
  },

  {
    key: 'densityDissipation',
    label: 'Density dissipation',
    group: 'Fluid',
    type: 'number',
    min: 0,
    max: 4,
    step: 0.01,
    default: 1,
    description: 'How quickly the dye fades.',
  },
  {
    key: 'velocityDissipation',
    label: 'Velocity dissipation',
    group: 'Fluid',
    type: 'number',
    min: 0,
    max: 4,
    step: 0.01,
    default: 0.2,
  },
  {
    key: 'pressure',
    label: 'Pressure',
    group: 'Fluid',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.8,
  },
  {
    key: 'curl',
    label: 'Vorticity',
    group: 'Fluid',
    type: 'number',
    min: 0,
    max: 50,
    step: 0.1,
    default: 30,
    description: 'Swirliness: how much small eddies are kept alive.',
  },
  {
    key: 'timeScale',
    label: 'Time scale',
    group: 'Fluid',
    type: 'number',
    min: 0,
    max: 3,
    step: 0.01,
    default: 1,
  },
  { key: 'paused', label: 'Paused', group: 'Fluid', type: 'boolean', default: false },

  {
    key: 'splatRadius',
    label: 'Splat radius',
    group: 'Splats',
    type: 'number',
    min: 0.02,
    max: 1,
    step: 0.005,
    default: 0.25,
  },
  {
    key: 'splatForce',
    label: 'Splat force',
    group: 'Splats',
    type: 'number',
    min: 0,
    max: 20000,
    step: 10,
    default: 6000,
  },
  {
    key: 'onsetSplats',
    label: 'Strokes per input',
    group: 'Splats',
    type: 'number',
    min: 0,
    max: 64,
    step: 1,
    default: 5,
    description:
      'How many strokes (splats) each picked note or strum paints. 0 turns the burst off.',
  },
  {
    key: 'emitRate',
    label: 'Continuous splats',
    group: 'Splats',
    type: 'number',
    min: 0,
    max: 12,
    step: 0.05,
    default: 0,
    description: 'Splats per second while you play; route Volume here.',
  },
  {
    key: 'brushCount',
    label: 'Audio brushes',
    group: 'Brush',
    type: 'number',
    min: 0,
    max: 8,
    step: 1,
    default: 2,
    description:
      'Brushes that sweep through the fluid like a dragged mouse while you play. 0 turns them off.',
  },
  {
    key: 'brushIntensity',
    label: 'Brush intensity',
    group: 'Brush',
    type: 'number',
    min: 0,
    max: 3,
    step: 0.01,
    default: 1,
    description: 'Dye and push of the strokes. Always scales with how hard you play.',
  },
  {
    key: 'brushSpeed',
    label: 'Brush speed',
    group: 'Brush',
    type: 'number',
    min: 0,
    max: 2,
    step: 0.01,
    default: 0.5,
    description: 'Screens per second at full volume.',
  },
  {
    key: 'brushWander',
    label: 'Brush wander',
    group: 'Brush',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.5,
    description: 'How sharply the strokes curve. 0 is straight lines.',
  },
  { key: 'splatNow', label: 'Splat now', group: 'Splats', type: 'action' },
  { key: 'clearFluid', label: 'Clear', group: 'Splats', type: 'action' },

  {
    key: 'colorMode',
    label: 'Colour mode',
    group: 'Colour',
    type: 'select',
    default: 'rainbow',
    options: [
      { value: 'rainbow', label: 'Rainbow' },
      { value: 'palette', label: 'Two colours' },
    ],
  },
  { key: 'colorA', label: 'Primary', group: 'Colour', type: 'color', default: '#ff2e93' },
  { key: 'colorB', label: 'Secondary', group: 'Colour', type: 'color', default: '#2ee6ff' },
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
    key: 'hueSpread',
    label: 'Hue spread',
    group: 'Colour',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    default: 1,
    description: 'How far each splat’s hue strays from the shift.',
  },
  {
    key: 'colorSpeed',
    label: 'Colour cycle speed',
    group: 'Colour',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.005,
    default: 0.02,
  },
  {
    key: 'backgroundColor',
    label: 'Background',
    group: 'Colour',
    type: 'color',
    default: '#000000',
  },

  { key: 'shading', label: 'Shading', group: 'Lighting', type: 'boolean', default: true },
  {
    key: 'brightness',
    label: 'Brightness',
    group: 'Lighting',
    type: 'number',
    min: 0.2,
    max: 3,
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
  // Level: sustained playing keeps dye flowing in.
  mod('emit-volume', 'emitRate', 'volume', 0.35, 'ease', 0.02, 0.2),
  mod('bright-volume', 'brightness', 'volume', 0.15, 'ease'),
  // Bass swells the splats; treble sharpens the swirl.
  mod('radius-low', 'splatRadius', 'bandLow', 0.1, 'ease', 0.02, 0.25),
  mod('curl-high', 'curl', 'bandHigh', 0.3, 'ease'),
  // Attacks shove the fluid harder; grit makes it turbulent.
  mod('force-onset', 'splatForce', 'onset', 0.25, 'expo'),
  mod('curl-grit', 'curl', 'grit', 0.2, 'ease'),
  // Sustain slows the fade so held notes bloom.
  mod('fade-sustain', 'densityDissipation', 'sustain', -0.25, 'ease', 0.05, 0.5),
  // Pitch: note -> hue.
  mod('brush-sustain', 'brushIntensity', 'sustain', 0.5, 'ease', 0.1, 0.4),
  mod('hue-note', 'hueShift', 'pitchClass', 1, 'linear', 0.05),
]

export const fluidSim: SceneDefinition = {
  id: 'fluid-sim',
  name: 'Fluid Simulation',
  description:
    'Coloured ink swirling through a real-time fluid, stirred by your playing and your mouse.',
  credit: {
    author: 'Pavel Dobryakov',
    url: 'https://github.com/PavelDoGreat/WebGL-Fluid-Simulation',
    license: 'MIT',
    note: 'Ported from the original WebGL shaders to TSL (WebGPU, WebGL2 fallback) and made audio reactive. Bloom and sunrays are left out.',
  },
  params,
  modulations,
  load: () => import('./scene'),
}
