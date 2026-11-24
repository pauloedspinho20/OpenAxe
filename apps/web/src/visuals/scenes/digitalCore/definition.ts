import type { Modulation, SceneDefinition, SceneParam } from '../../types'

/**
 * "Digital Core" by Sabo Sugi - a data-centre core of glass voxels, amber
 * glow blocks shifting along a cube frame like bits in a shift register,
 * scrolling binary code, light lines and sparks, inside a room of LED
 * panels. Ported from GLSL (WebGLRenderer + EffectComposer) to TSL so it
 * runs on WebGPU with a WebGL2 fallback, and made audio reactive.
 *
 * Extra params on top of the original GUI: camera kick and shake (impulses
 * for attacks / vibrato), core flash, and a palette hue shift.
 */
const num = (
  key: string,
  label: string,
  group: string,
  min: number,
  max: number,
  step: number,
  def: number,
  extra: Partial<Omit<SceneParam & { type: 'number' }, 'type'>> = {},
): SceneParam => ({ key, label, group, type: 'number', min, max, step, default: def, ...extra })

const color = (key: string, label: string, def: string): SceneParam => ({
  key,
  label,
  group: 'Colour',
  type: 'color',
  default: def,
})

const params: readonly SceneParam[] = [
  num('distance', 'Distance', 'Camera', 3.5, 7.5, 0.05, 5.4),
  num('fov', 'FOV', 'Camera', 25, 80, 1, 50, { unit: '°' }),
  num('orbitSpeed', 'Orbit speed', 'Camera', 0, 3, 0.01, 0.65),
  num('tumble', 'Tumble', 'Camera', 0, 1.5, 0.01, 0.9),
  num('roll', 'Roll', 'Camera', 0, 1.5, 0.01, 0.6),
  num('drift', 'Drift', 'Camera', 0, 1.5, 0.01, 0.5),
  num('cameraKick', 'Camera kick', 'Camera', 0, 3, 0.01, 0, {
    description: 'Push along the orbit plus a short dolly-in; route an impulse (Attack) here.',
  }),
  num('shake', 'Shake', 'Camera', 0, 1, 0.01, 0, {
    description: 'Fast camera wobble; route Vibrato here.',
  }),

  num('timeScale', 'Time scale', 'Animation', 0, 3, 0.01, 1),
  num('corePulse', 'Core pulse', 'Animation', 0, 1.5, 0.01, 0.55),
  num('flicker', 'Flicker', 'Animation', 0, 1, 0.01, 0.6),
  num('blockSpeed', 'Block speed', 'Animation', 0, 3, 0.01, 1, {
    description: 'Speed of the shift-register hops of the amber blocks.',
  }),
  num('blockBreath', 'Block breath', 'Animation', 0, 1.5, 0.01, 0.4),
  num('codeSpeed', 'Code speed', 'Animation', 0, 4, 0.01, 1),
  num('lineFlow', 'Line flow', 'Animation', 0, 4, 0.01, 1),
  num('particleDrift', 'Particle drift', 'Animation', 0, 4, 0.01, 1),

  num('seed', 'Seed', 'Geometry', 1, 999, 1, 11, { rebuild: true }),
  num('coreDensity', 'Core density', 'Geometry', 0.2, 2, 0.01, 1, { rebuild: true }),
  num('roomDepth', 'Room depth', 'Geometry', 0.2, 1.4, 0.01, 1, { rebuild: true }),
  num('blockDetail', 'Block detail', 'Geometry', 0, 1.15, 0.01, 1, { rebuild: true }),
  num('lineCount', 'Lines', 'Geometry', 0, 3000, 10, 220, { rebuild: true }),
  num('particleCount', 'Particles', 'Geometry', 0, 8000, 50, 2600, { rebuild: true }),

  num('panelBrightness', 'Panel brightness', 'Material', 0, 3, 0.01, 1),
  num('glassIntensity', 'Glass intensity', 'Material', 0, 3, 0.01, 1),
  num('edgeGlow', 'Edge glow', 'Material', 0, 3, 0.01, 1),
  num('coreGlow', 'Core glow', 'Material', 0, 4, 0.01, 1),
  num('innerGlow', 'Inner glow', 'Material', 0, 3, 0.01, 1),
  num('flash', 'Core flash', 'Material', 0, 3, 0.01, 0, {
    description: 'Extra light from the amber blocks; route an impulse (Attack) here.',
  }),
  num('codeBrightness', 'Code brightness', 'Material', 0, 3, 0.01, 1),
  num('codeColumns', 'Code columns', 'Material', 2, 12, 1, 8),
  num('lineIntensity', 'Line intensity', 'Material', 0, 3, 0.01, 1),
  num('particleIntensity', 'Particle intensity', 'Material', 0, 3, 0.01, 1),
  num('dotSize', 'Dot size', 'Material', 0.15, 0.95, 0.01, 0.6),
  num('haze', 'Haze', 'Material', 0, 3, 0.01, 1),
  num('fog', 'Fog', 'Material', 0, 0.25, 0.005, 0.055),

  num('coreLight', 'Core light', 'Lighting', 0, 3, 0.01, 1),
  num('reflections', 'Reflections', 'Lighting', 0, 3, 0.01, 1),

  color('background', 'Background', '#010409'),
  color('panel', 'Panel', '#1f78b8'),
  color('glass', 'Glass', '#3c94d6'),
  color('highlight', 'Highlight', '#a8e8ff'),
  color('core', 'Core', '#ff8526'),
  color('coreHot', 'Core hot', '#ffe2b8'),
  color('hazeColor', 'Haze', '#164f80'),
  color('envLight', 'Env light', '#cfe4ff'),
  num('hueShift', 'Hue shift', 'Colour', 0, 1, 0.001, 0, {
    wrap: true,
    description: 'Rotates the whole palette around the colour wheel.',
  }),

  {
    key: 'depthOfField',
    label: 'Depth of field',
    group: 'Post',
    type: 'boolean',
    default: true,
  },
  num('aperture', 'Aperture', 'Post', 0, 2.5, 0.01, 1),
  num('focusOffset', 'Focus offset', 'Post', -2.5, 2.5, 0.01, 0),
  num('focusRange', 'Focus range', 'Post', 0, 0.6, 0.01, 0.22),
  num('nearBlur', 'Near blur', 'Post', 0, 50, 0.5, 24),
  num('farBlur', 'Far blur', 'Post', 0, 30, 0.5, 2.5),
  num('bloomStrength', 'Bloom strength', 'Post', 0, 3, 0.01, 0.9),
  num('bloomRadius', 'Bloom radius', 'Post', 0, 1, 0.01, 0.5),
  num('bloomThreshold', 'Bloom threshold', 'Post', 0, 1.5, 0.01, 0.8),
  num('lightShafts', 'Light shafts', 'Post', 0, 2, 0.01, 0.8),
  num('motionBlur', 'Motion blur', 'Post', 0, 0.9, 0.01, 0.45),
  num('tealOrange', 'Teal orange grade', 'Post', 0, 1, 0.01, 1),
  num('contrast', 'Contrast', 'Post', 0, 1, 0.01, 0.3),
  num('chromatic', 'Chromatic aberration', 'Post', 0, 3, 0.01, 1),
  num('vignette', 'Vignette', 'Post', 0, 1, 0.01, 0.75),
  num('grain', 'Grain', 'Post', 0, 0.15, 0.001, 0.03),
  num('exposure', 'Exposure', 'Post', 0.2, 3, 0.01, 1),
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
  // Volume: the core breathes light with the playing.
  mod('glow-vol', 'coreGlow', 'volume', 0.15, 'ease'),
  mod('inner-vol', 'innerGlow', 'volume', 0.12, 'ease'),
  mod('bloom-vol', 'bloomStrength', 'volume', 0.12),
  mod('time-vol', 'timeScale', 'volume', 0.1),
  // Attacks: flash, bloom spike, code burst, camera kick.
  mod('flash-onset', 'flash', 'onset', 0.35, 'expo'),
  mod('bloom-onset', 'bloomStrength', 'onset', 0.15, 'expo'),
  mod('code-onset', 'codeSpeed', 'onset', 0.5),
  mod('kick-onset', 'cameraKick', 'onset', 0.25, 'expo'),
  // New notes advance the shift register.
  mod('block-note', 'blockSpeed', 'noteChange', 0.6),
  // Pitch: note -> palette, register -> camera distance, expression -> shake/shafts.
  mod('hue-note', 'hueShift', 'pitchClass', 1, 'linear', 0.05),
  mod('dist-register', 'distance', 'register', 0.15, 'ease', 0.3, 0.5),
  mod('shake-vibrato', 'shake', 'vibrato', 0.8),
  mod('shafts-bend', 'lightShafts', 'bend', 0.3, 'ease'),
  // Timbre: bands and tone colour.
  mod('breath-low', 'blockBreath', 'bandLow', 0.4, 'ease'),
  mod('pulse-low', 'corePulse', 'bandLow', 0.3),
  mod('glass-lowmid', 'glassIntensity', 'bandLowMid', 0.15),
  mod('edge-himid', 'edgeGlow', 'bandHighMid', 0.15),
  mod('particles-high', 'particleIntensity', 'bandHigh', 0.25),
  mod('lines-bright', 'lineIntensity', 'brightness', 0.25, 'ease'),
  mod('flicker-grit', 'flicker', 'grit', 0.4),
  mod('chroma-grit', 'chromatic', 'grit', 0.25),
  mod('grain-grit', 'grain', 'grit', 0.2),
  // Sustained notes: thicker haze and longer smear.
  mod('haze-sustain', 'haze', 'sustain', 0.15),
  mod('smear-sustain', 'motionBlur', 'sustain', 0.2),
]

export const digitalCore: SceneDefinition = {
  id: 'digital-core',
  name: 'Digital Core',
  description:
    'A data core of glass voxels and amber blocks shifting like register bits, inside a room of LED panels.',
  credit: {
    author: 'Sabo Sugi',
    url: 'https://codepen.io/sabosugi/pen/01a1bbba-a139-7eee-a104-e40e6b693b28',
    license: 'CodePen public pen',
    note: 'Ported from GLSL (WebGLRenderer + EffectComposer) to TSL (WebGPU) and made audio reactive.',
  },
  params,
  modulations,
  load: () => import('./scene'),
}
