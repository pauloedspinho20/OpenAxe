import type { Modulation, SceneDefinition, SceneParam } from '../../types'

/**
 * "Neural Brain" by sabosugi (CodePen): a procedural brain drawn from
 * thousands of glowing fibres traced over a folded signed-distance surface
 * (cerebrum, temporal lobes, cerebellum, stem), sulcus outlines, a core of
 * deeper fibres, twinkling dots and dust, and impulses racing along paths
 * from clusters on the surface and from deep inside. Ported from GLSL
 * `ShaderMaterial`s to TSL so it runs on WebGPU and the WebGL2 fallback; the
 * CPU generator is kept as written and runs in a worker.
 *
 * Audio: the neurons only fire with sound. Each attack or new note fires a
 * burst of impulse clusters (louder = more clusters, brighter), and the dots
 * flash while you play; in silence the brain just glows and turns. Held notes
 * speed the impulses, vibrato makes them flicker, the note turns the colours,
 * the register tilts the view, and brightness drives the bloom. (The pen fires
 * clusters on a timer instead.)
 */
const geometry = (
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  description?: string,
): SceneParam => ({
  key,
  label,
  group: 'Geometry',
  type: 'number',
  min,
  max,
  step,
  default: value,
  rebuild: true,
  ...(description ? { description } : {}),
})

const num = (
  key: string,
  label: string,
  group: string,
  min: number,
  max: number,
  step: number,
  value: number,
  description?: string,
): SceneParam => ({
  key,
  label,
  group,
  type: 'number',
  min,
  max,
  step,
  default: value,
  ...(description ? { description } : {}),
})

const color = (key: string, label: string, value: string): SceneParam => ({
  key,
  label,
  group: 'Colour',
  type: 'color',
  default: value,
})

const params: readonly SceneParam[] = [
  { key: 'autoRotate', label: 'Auto rotate', group: 'Animation', type: 'boolean', default: true },
  num('rotationSpeed', 'Rotation speed', 'Animation', -120, 120, 1, 15, 'Degrees per second.'),
  num('timeScale', 'Time scale', 'Animation', 0, 2, 0.01, 1),
  num(
    'fire',
    'Fire',
    'Impulses',
    0,
    1,
    0.01,
    0,
    'Each quick rise fires a burst of impulses, as strong as the rise. Driven by attacks and new notes.',
  ),
  num(
    'burstSize',
    'Burst size',
    'Impulses',
    0,
    1,
    0.01,
    0.3,
    'Share of the impulse clusters a full-strength burst fires.',
  ),
  { key: 'testFire', label: 'Fire now', group: 'Impulses', type: 'action' },
  num('pulseSpeed', 'Impulse speed', 'Impulses', 0.5, 12, 0.1, 5),
  num('pulseTrail', 'Impulse trail', 'Impulses', 0.05, 1.5, 0.01, 0.75),
  num('pulseFlicker', 'Impulse flicker', 'Impulses', 0, 1, 0.01, 0.5),
  num(
    'dotPulse',
    'Dot flash',
    'Animation',
    0,
    1,
    0.01,
    0,
    'How hard the dots swell and flare. Driven by playing; 0 keeps them steady.',
  ),
  num('dotPulseSpeed', 'Dot pulse speed', 'Animation', 0.05, 3, 0.01, 0.6),

  geometry('seed', 'Seed', 1, 999, 1, 7),
  geometry('fiberCount', 'Fibre count', 2000, 20000, 100, 8000),
  geometry('fiberLength', 'Fibre length', 20, 140, 1, 40),
  geometry('waviness', 'Waviness', 0, 1.5, 0.01, 0.25),
  geometry('gyriDepth', 'Gyri depth', 0, 0.2, 0.001, 0.11),
  geometry('gyriScale', 'Gyri scale', 2, 9, 0.05, 5.4),
  geometry('foldFollow', 'Fold following', 0, 4, 0.05, 2.4),
  geometry('sulcusLines', 'Sulcus lines', 0, 4000, 50, 2600),
  geometry('shell', 'Shell thickness', 0, 0.15, 0.005, 0.09),
  geometry('pulseClusters', 'Impulse clusters', 6, 48, 1, 26),
  geometry(
    'fiberDensity',
    'Fibre density',
    0.25,
    1.5,
    0.05,
    1,
    'Scales every fibre and dot count; lower it on slow machines.',
  ),
  {
    key: 'randomize',
    label: 'Random brain',
    group: 'Geometry',
    type: 'action',
    description: 'Grows a brain from a random seed (until the seed changes).',
  },

  num('fiberWidth', 'Fibre width', 'Material', 0.5, 8, 0.1, 3.3),
  num('fiberOpacity', 'Fibre opacity', 'Material', 0, 1.5, 0.01, 0.06),
  num('vesselBoost', 'Vessel boost', 'Material', 0.5, 4, 0.05, 1.8),
  num('dotSize', 'Dot size', 'Material', 2, 30, 0.5, 5),
  num('dotOpacity', 'Dot opacity', 'Material', 0, 2, 0.01, 0.9),
  num('dustOpacity', 'Inner dust', 'Material', 0, 2, 0.01, 0.35),
  num('pulseWidth', 'Impulse width', 'Material', 1, 15, 0.1, 9),
  num('pulseIntensity', 'Impulse intensity', 'Material', 0, 6, 0.05, 3.2),

  color('background', 'Background', '#000000'),
  color('fiberDeep', 'Fibre deep', '#1270d2'),
  color('fiberCyan', 'Fibre cyan', '#1fc0e2'),
  color('highlight', 'Highlight', '#d2f4ff'),
  color('far', 'Far side', '#0f5a50'),
  color('dot', 'Dots', '#c8eeff'),
  color('warmDot', 'Warm dots', '#ff9a80'),
  color('pulse', 'Impulse', '#ffc43d'),
  color('pulseTail', 'Impulse tail', '#ff6a1a'),
  color('pulseHot', 'Impulse hot', '#ff86e6'),
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

  num('topLight', 'Top light', 'Lighting', 0, 1.5, 0.01, 0.9),
  num('depthFade', 'Depth fade', 'Lighting', 0, 1, 0.01, 0.75),
  num('relief', 'Gyri relief', 'Lighting', 0, 1, 0.01, 0.8),
  num('sulciShade', 'Sulci shade', 'Lighting', 0, 1, 0.01, 0.7),
  num('rimFlatten', 'Rim softening', 'Lighting', 0, 1, 0.01, 0.85),

  num('fov', 'FOV', 'Camera', 15, 60, 1, 20),
  num('zoom', 'Zoom', 'Camera', 0.5, 2, 0.01, 1),
  num('elevation', 'Elevation', 'Camera', -30, 45, 0.5, 4, 'Degrees.'),
  num('offsetY', 'Offset Y', 'Camera', -0.5, 0.5, 0.01, 0),
  num('dragSensitivity', 'Drag sensitivity', 'Camera', 0.2, 3, 0.05, 1),
  num('inertia', 'Drag inertia', 'Camera', 0, 0.98, 0.01, 0.85),
  { key: 'resetView', label: 'Reset view', group: 'Camera', type: 'action' },

  num('bloom', 'Bloom', 'Look', 0, 3, 0.01, 0.5),
  num('bloomRadius', 'Bloom radius', 'Look', 0, 1, 0.01, 0),
  num('bloomThreshold', 'Bloom threshold', 'Look', 0, 1, 0.01, 0.75),
  num('exposure', 'Exposure', 'Look', 0.2, 3, 0.01, 1),
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
  // Impulses fire only on sound: attacks and new notes fire bursts, louder = bigger.
  mod('fire-onset', 'fire', 'onset', 1, 'expo', 0, 0.15),
  mod('fire-note', 'fire', 'noteChange', 0.7, 'expo', 0, 0.15),
  mod('burst-vol', 'burstSize', 'volume', 0.4, 'ease', 0.02, 0.4),
  mod('impulse-onset', 'pulseIntensity', 'onset', 0.2, 'expo', 0, 0.3),
  // The dots flash while you play.
  mod('dots-vol', 'dotPulse', 'volume', 0.6, 'ease', 0.03, 0.5),
  mod('dots-onset', 'dotPulse', 'onset', 0.4, 'expo', 0, 0.25),
  mod('fibres-low', 'fiberOpacity', 'bandLow', 0.04, 'ease', 0.05, 0.5),
  // Held notes speed the impulses, vibrato makes them flicker.
  mod('speed-sustain', 'pulseSpeed', 'sustain', 0.15, 'ease', 0.1, 0.8),
  mod('flicker-vibrato', 'pulseFlicker', 'vibrato', 0.4, 'ease', 0.05, 0.4),
  // Pitch: the note turns the colours, the register tilts the view.
  mod('hue-note', 'hueShift', 'pitchClass', 0.25, 'linear', 0.3, 0.3),
  mod('tilt-register', 'elevation', 'register', 0.12, 'ease', 0.3, 1),
  // Level and brightness drive the glow.
  mod('bloom-bright', 'bloom', 'brightness', 0.1, 'ease', 0.05, 0.5),
]

export const neuralBrain: SceneDefinition = {
  id: 'neural-brain',
  name: 'Neural Brain',
  description:
    'A brain of glowing fibres whose neurons fire only when you play: every attack sends impulses racing.',
  credit: {
    author: 'sabosugi',
    url: 'https://codepen.io/sabosugi',
    note: 'The "Neural Brain" CodePen. Ported from GLSL to TSL (WebGPU), generator kept and run in a worker, and made audio reactive (impulses fire on sound instead of a timer).',
  },
  params,
  modulations,
  load: () => import('./scene'),
}
