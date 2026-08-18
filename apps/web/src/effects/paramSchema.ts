import type { EffectKind } from './Effect'
import type { EffectParams } from './Effect'
import type { BlockKind } from '../engine/blocks/Block'
import { MIXER_INPUT_COUNT } from '../engine/blocks/MixerBlock'
import { SPLITTER_OUTPUT_COUNT } from '../engine/blocks/SplitterBlock'

interface KnobField {
  key: string
  label: string
  control: 'knob'
  min: number
  max: number
  step: number
  defaultValue: number
  formatValue: (value: number) => string
  /** Visually clusters fields (e.g. EQ's 4 bands) - purely a rendering hint. */
  group?: string
  /** If set, the field is only rendered when this returns true for the current values. */
  visible?: (values: EffectParams) => boolean
}

interface SelectField {
  key: string
  label: string
  control: 'select'
  options: Array<{ value: string; label: string }>
  defaultValue: string
  group?: string
  /** If set, the field is only rendered when this returns true for the current values. */
  visible?: (values: EffectParams) => boolean
  /**
   * Model/character-style selector (Reverb's Algorithm, Delay's Model,
   * Tremolo's Shape, Compressor's Character, ...). Rendered in its own row
   * above the knob cluster instead of mixed into it, so the "which model is
   * this?" choice reads first.
   */
  primary?: boolean
}

export type ParamFieldSchema = KnobField | SelectField

const dB = (value: number) => `${value.toFixed(0)}dB`
const ms = (value: number) => `${Math.round(value * 1000)}ms`
const percent = (value: number) => `${Math.round(value * 100)}%`
const hz = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(1)}kHz` : `${Math.round(value)}Hz`
const ratio = (value: number) => `${value.toFixed(1)}:1`
const plain = (value: number) => value.toFixed(2)
// Dragonfly Reverb's width/predelay/spin/wander/earlySend params (see
// DragonflyReverb.ts) are already in their display unit, unlike `ms`/
// `percent` above (which convert from seconds/a 0-1 fraction) - these three
// just format the raw value, no conversion.
const msRaw = (value: number) => `${Math.round(value)}ms`
const percentRaw = (value: number) => `${Math.round(value)}%`
const hzPrecise = (value: number) => `${value.toFixed(1)}Hz`

function eqBand(index: number, freqRange: [number, number], freqDefault: number): KnobField[] {
  const group = `Band ${index + 1}`
  return [
    {
      key: `band${index}_frequency`,
      label: 'Freq',
      control: 'knob',
      min: freqRange[0],
      max: freqRange[1],
      step: 10,
      defaultValue: freqDefault,
      formatValue: hz,
      group,
    },
    {
      key: `band${index}_gain`,
      label: 'Gain',
      control: 'knob',
      min: -15,
      max: 15,
      step: 0.5,
      defaultValue: 0,
      formatValue: dB,
      group,
    },
    {
      key: `band${index}_q`,
      label: 'Q',
      control: 'knob',
      min: 0.1,
      max: 10,
      step: 0.1,
      defaultValue: 0.707,
      formatValue: plain,
      group,
    },
  ]
}

/**
 * Declarative per-effect-kind field list, driving one generic renderer
 * (EffectParamsPanel) instead of bespoke UI per effect. Ranges/defaults
 * mirror each effect class's own constructor/setter defaults. Fields only
 * expose each effect's real DSP parameters - the app's shared dry/wet Mix
 * and output Level are deliberately not here (see Effect.ts); effects that
 * ship a native dry/wet or output control (Compressor's Mix, Reverb's Dry)
 * declare that original param in its own place below.
 */
export const EFFECT_PARAM_SCHEMAS: Record<EffectKind, ParamFieldSchema[]> = {
  'noise-gate': [
    {
      key: 'threshold',
      label: 'Threshold',
      control: 'knob',
      min: -80,
      max: 0,
      step: 1,
      defaultValue: -40,
      formatValue: dB,
    },
    {
      key: 'hysteresis',
      label: 'Hysteresis',
      control: 'knob',
      min: 0,
      max: 20,
      step: 0.5,
      defaultValue: 4,
      formatValue: dB,
    },
    {
      key: 'attack',
      label: 'Attack',
      control: 'knob',
      min: 0.01,
      max: 50,
      step: 0.5,
      defaultValue: 0.5,
      formatValue: msRaw,
    },
    {
      key: 'hold',
      label: 'Hold',
      control: 'knob',
      min: 0,
      max: 500,
      step: 5,
      defaultValue: 50,
      formatValue: msRaw,
    },
    {
      key: 'release',
      label: 'Release',
      control: 'knob',
      min: 1,
      max: 1000,
      step: 10,
      defaultValue: 100,
      formatValue: msRaw,
    },
    {
      key: 'range',
      label: 'Range',
      control: 'knob',
      min: -100,
      max: 0,
      step: 1,
      defaultValue: -80,
      formatValue: dB,
    },
  ],
  compressor: [
    {
      key: 'threshold',
      label: 'Threshold',
      control: 'knob',
      min: -60,
      max: 0,
      step: 1,
      defaultValue: -18,
      formatValue: dB,
    },
    {
      key: 'ratio',
      label: 'Ratio',
      control: 'knob',
      min: 1,
      max: 20,
      step: 0.5,
      defaultValue: 4,
      formatValue: ratio,
    },
    {
      key: 'attack',
      label: 'Attack',
      control: 'knob',
      min: 0.1,
      max: 100,
      step: 1,
      defaultValue: 5,
      formatValue: msRaw,
    },
    {
      key: 'release',
      label: 'Release',
      control: 'knob',
      min: 1,
      max: 2000,
      step: 10,
      defaultValue: 100,
      formatValue: msRaw,
    },
    {
      key: 'knee',
      label: 'Knee',
      control: 'knob',
      min: 0,
      max: 20,
      step: 1,
      defaultValue: 0,
      formatValue: dB,
    },
    {
      key: 'makeup_gain',
      label: 'Makeup',
      control: 'knob',
      min: 0,
      max: 24,
      step: 0.5,
      defaultValue: 0,
      formatValue: dB,
    },
    {
      key: 'character',
      label: 'Character',
      control: 'select',
      options: [
        { value: 'clean', label: 'Clean' },
        { value: 'opto', label: 'Opto' },
        { value: 'fet', label: 'FET' },
        { value: 'varimu', label: 'Varimu' },
      ],
      defaultValue: 'clean',
      primary: true,
    },
    {
      key: 'mix',
      label: 'Mix',
      control: 'knob',
      min: 0,
      max: 1,
      step: 0.01,
      defaultValue: 1,
      formatValue: percent,
    },
  ],
  eq: [
    ...eqBand(0, [20, 20000], 100),
    ...eqBand(1, [20, 20000], 500),
    ...eqBand(2, [20, 20000], 2000),
    ...eqBand(3, [20, 20000], 6000),
  ],
  chorus: [
    {
      key: 'rate',
      label: 'Rate',
      control: 'knob',
      min: 0.1,
      max: 10,
      step: 0.05,
      defaultValue: 0.5,
      formatValue: hz,
    },
    {
      key: 'depth',
      label: 'Depth',
      control: 'knob',
      min: 0.2,
      max: 10,
      step: 0.1,
      defaultValue: 5,
      formatValue: ms,
    },
    {
      key: 'delay',
      label: 'Delay',
      control: 'knob',
      min: 5,
      max: 30,
      step: 0.5,
      defaultValue: 8,
      formatValue: msRaw,
    },
    {
      key: 'feedback',
      label: 'Feedback',
      control: 'knob',
      min: 0,
      max: 0.5,
      step: 0.01,
      defaultValue: 0.2,
      formatValue: percent,
    },
  ],
  flanger: [
    {
      key: 'rate',
      label: 'Rate',
      control: 'knob',
      min: 0.1,
      max: 10,
      step: 0.05,
      defaultValue: 0.3,
      formatValue: hz,
    },
    {
      key: 'depth',
      label: 'Depth',
      control: 'knob',
      min: 0.1,
      max: 5,
      step: 0.1,
      defaultValue: 2,
      formatValue: ms,
    },
    {
      key: 'delay',
      label: 'Delay',
      control: 'knob',
      min: 0.1,
      max: 3,
      step: 0.05,
      defaultValue: 1,
      formatValue: msRaw,
    },
    {
      key: 'feedback',
      label: 'Feedback',
      control: 'knob',
      min: 0,
      max: 0.9,
      step: 0.01,
      defaultValue: 0.5,
      formatValue: percent,
    },
  ],
  phaser: [
    {
      key: 'rate',
      label: 'Rate',
      control: 'knob',
      min: 0.1,
      max: 5,
      step: 0.05,
      defaultValue: 0.3,
      formatValue: hz,
    },
    {
      key: 'depth',
      label: 'Depth',
      control: 'knob',
      min: 0.1,
      max: 1,
      step: 0.01,
      defaultValue: 0.7,
      formatValue: percent,
    },
    {
      key: 'feedback',
      label: 'Feedback',
      control: 'knob',
      min: 0,
      max: 0.9,
      step: 0.01,
      defaultValue: 0.5,
      formatValue: percent,
    },
    {
      key: 'stages',
      label: 'Stages',
      control: 'knob',
      min: 2,
      max: 8,
      step: 1,
      defaultValue: 4,
      formatValue: plain,
    },
  ],
  tremolo: [
    {
      key: 'rate',
      label: 'Rate',
      control: 'knob',
      min: 0.1,
      max: 20,
      step: 0.1,
      defaultValue: 4,
      formatValue: hz,
    },
    {
      key: 'depth',
      label: 'Depth',
      control: 'knob',
      min: 0,
      max: 1,
      step: 0.01,
      defaultValue: 0.5,
      formatValue: percent,
    },
    {
      key: 'shape',
      label: 'Shape',
      control: 'select',
      options: [
        { value: 'sine', label: 'Sine' },
        { value: 'triangle', label: 'Triangle' },
        { value: 'square', label: 'Square' },
      ],
      defaultValue: 'sine',
      primary: true,
    },
  ],
  // 3 character models: Digital (clean), Analog (BBD-style filtering +
  // saturation), Tape (Analog + wow/flutter pitch modulation).
  delay: [
    {
      key: 'model',
      label: 'Model',
      control: 'select',
      options: [
        { value: 'digital', label: 'Digital' },
        { value: 'analog', label: 'Analog' },
        { value: 'tape', label: 'Tape' },
      ],
      defaultValue: 'digital',
      primary: true,
    },
    {
      key: 'time',
      label: 'Time',
      control: 'knob',
      min: 10,
      max: 1000,
      step: 5,
      defaultValue: 300,
      formatValue: msRaw,
    },
    {
      key: 'feedback',
      label: 'Feedback',
      control: 'knob',
      min: 0,
      max: 0.9,
      step: 0.01,
      defaultValue: 0.4,
      formatValue: percent,
    },
    {
      key: 'tone',
      label: 'Tone',
      control: 'knob',
      min: 200,
      max: 12000,
      step: 50,
      defaultValue: 6000,
      formatValue: hz,
    },
    {
      key: 'wow_depth',
      label: 'Wow Depth',
      control: 'knob',
      min: 0,
      max: 5,
      step: 0.1,
      defaultValue: 1.5,
      formatValue: msRaw,
      visible: (v) => v.model === 'tape',
    },
    {
      key: 'wow_rate',
      label: 'Wow Rate',
      control: 'knob',
      min: 0.1,
      max: 3,
      step: 0.05,
      defaultValue: 0.5,
      formatValue: hz,
      visible: (v) => v.model === 'tape',
    },
  ],
  'ping-pong-delay': [
    {
      key: 'time',
      label: 'Time',
      control: 'knob',
      min: 50,
      max: 1000,
      step: 5,
      defaultValue: 250,
      formatValue: msRaw,
    },
    {
      key: 'feedback',
      label: 'Feedback',
      control: 'knob',
      min: 0,
      max: 0.9,
      step: 0.01,
      defaultValue: 0.5,
      formatValue: percent,
    },
    {
      key: 'tone',
      label: 'Tone',
      control: 'knob',
      min: 200,
      max: 12000,
      step: 50,
      defaultValue: 6000,
      formatValue: hz,
    },
  ],
  // Four Dragonfly Reverb algorithms (packages/core): Hall, Room, Plate,
  // Early Reflections. Each algorithm exposes a different subset of the
  // 7 user-facing knobs — roomSize/damping (Freeverb-compatible) and width
  // are universal; predelay/spin/wander/earlySend vary by algorithm. Per-
  // field `visible` predicates hide knobs the current algorithm doesn't
  // support (the C++ side harmlessly ignores out-of-range indices).
  reverb: [
    {
      key: 'reverbAlgorithm',
      label: 'Algorithm',
      control: 'select',
      options: [
        { value: 'hall', label: 'Hall' },
        { value: 'room', label: 'Room' },
        { value: 'plate', label: 'Plate' },
        { value: 'early-reflections', label: 'Early Reflections' },
      ],
      defaultValue: 'hall',
      primary: true,
    },
    {
      key: 'roomSize',
      label: 'Size',
      control: 'knob',
      min: 0,
      max: 0.97,
      step: 0.01,
      defaultValue: 0.84,
      formatValue: percent,
      visible: (v) => v.reverbAlgorithm !== 'early-reflections',
    },
    {
      key: 'damping',
      label: 'Damping',
      control: 'knob',
      min: 0,
      max: 1,
      step: 0.01,
      defaultValue: 0.5,
      formatValue: percent,
    },
    {
      key: 'width',
      label: 'Width',
      control: 'knob',
      min: 50,
      max: 150,
      step: 1,
      defaultValue: 100,
      formatValue: percentRaw,
    },
    {
      key: 'predelay',
      label: 'Predelay',
      control: 'knob',
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 20,
      formatValue: msRaw,
      visible: (v) => v.reverbAlgorithm !== 'early-reflections',
    },
    {
      key: 'spin',
      label: 'Spin',
      control: 'knob',
      min: 0,
      max: 10,
      step: 0.1,
      defaultValue: 0.6,
      formatValue: hzPrecise,
      visible: (v) => v.reverbAlgorithm === 'hall' || v.reverbAlgorithm === 'room',
    },
    {
      key: 'wander',
      label: 'Wander',
      control: 'knob',
      min: 0,
      max: 40,
      step: 0.5,
      defaultValue: 8,
      formatValue: msRaw,
      visible: (v) => v.reverbAlgorithm === 'hall' || v.reverbAlgorithm === 'room',
    },
    {
      key: 'earlySend',
      label: 'Early Send',
      control: 'knob',
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 20,
      formatValue: percentRaw,
      visible: (v) => v.reverbAlgorithm === 'hall' || v.reverbAlgorithm === 'room',
    },
    {
      key: 'dryLevel',
      label: 'Dry',
      control: 'knob',
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 0,
      formatValue: percentRaw,
    },
  ],
}

/** Bass/Mid/Treble/Presence tone stack, ±12dB - shared by every NAM model block kind (see AmpBlock). */
const AMP_TONE_STACK: KnobField[] = [
  {
    key: 'bass',
    label: 'Bass',
    control: 'knob',
    min: -12,
    max: 12,
    step: 0.5,
    defaultValue: 0,
    formatValue: dB,
    group: 'EQ',
  },
  {
    key: 'mid',
    label: 'Mid',
    control: 'knob',
    min: -12,
    max: 12,
    step: 0.5,
    defaultValue: 0,
    formatValue: dB,
    group: 'EQ',
  },
  {
    key: 'treble',
    label: 'Treble',
    control: 'knob',
    min: -12,
    max: 12,
    step: 0.5,
    defaultValue: 0,
    formatValue: dB,
    group: 'EQ',
  },
  {
    key: 'presence',
    label: 'Presence',
    control: 'knob',
    min: -12,
    max: 12,
    step: 0.5,
    defaultValue: 0,
    formatValue: dB,
    group: 'EQ',
  },
]

/** Pre/post trims - shared by every NAM model block kind and Cab (see AmpBlock/CabBlock's own input/output gain stages). */
const IN_OUT_LEVEL_FIELDS: KnobField[] = [
  {
    key: 'input_level',
    label: 'Input',
    control: 'knob',
    min: 0,
    max: 1.5,
    step: 0.01,
    defaultValue: 1,
    formatValue: percent,
    group: 'I/O',
  },
  {
    key: 'output_level',
    label: 'Output',
    control: 'knob',
    min: 0,
    max: 1.5,
    step: 0.01,
    defaultValue: 1,
    formatValue: percent,
    group: 'I/O',
  },
]

/**
 * Schema entries for grid block kinds beyond the 10 effects. The 5 NAM
 * model kinds (amp/amp-cab/pedal/outboard/space) each get the same 4-band
 * tone stack - model loading itself isn't a continuous "param" and stays a
 * dedicated action in the inspector, but the tone controls go through the
 * same generic knob panel as everything else.
 */
const AMP_CONTROLS: ParamFieldSchema[] = [...AMP_TONE_STACK, ...IN_OUT_LEVEL_FIELDS]

export const BLOCK_PARAM_SCHEMAS: Partial<Record<BlockKind, ParamFieldSchema[]>> = {
  amp: AMP_CONTROLS,
  'amp-cab': AMP_CONTROLS,
  pedal: AMP_CONTROLS,
  outboard: AMP_CONTROLS,
  space: AMP_CONTROLS,
  cab: [
    {
      key: 'irMix',
      label: 'IR Mix',
      control: 'knob',
      min: 0,
      max: 1,
      step: 0.01,
      defaultValue: 1,
      formatValue: percent,
    },
    ...IN_OUT_LEVEL_FIELDS,
  ],
  mixer: Array.from({ length: MIXER_INPUT_COUNT }, (_, i) => {
    const group = `In ${i + 1}`
    const fields: KnobField[] = [
      {
        key: `in${i}_level`,
        label: 'Level',
        control: 'knob',
        min: 0,
        max: 1.5,
        step: 0.01,
        defaultValue: 1,
        formatValue: percent,
        group,
      },
      {
        key: `in${i}_pan`,
        label: 'Pan',
        control: 'knob',
        min: -1,
        max: 1,
        step: 0.01,
        defaultValue: 0,
        formatValue: plain,
        group,
      },
    ]
    return fields
  }).flat(),
  splitter: Array.from({ length: SPLITTER_OUTPUT_COUNT }, (_, i): KnobField => ({
    key: `out${i}_level`,
    label: 'Level',
    control: 'knob',
    min: 0,
    max: 1.5,
    step: 0.01,
    defaultValue: 1,
    formatValue: percent,
    group: `Out ${i + 1}`,
  })),
}

/** Looks up the field schema for any grid block kind - the 11 effect kinds plus the 4 new ones. */
export function getParamSchema(kind: BlockKind): ParamFieldSchema[] {
  if (kind in EFFECT_PARAM_SCHEMAS) return EFFECT_PARAM_SCHEMAS[kind as EffectKind]
  return BLOCK_PARAM_SCHEMAS[kind] ?? []
}
