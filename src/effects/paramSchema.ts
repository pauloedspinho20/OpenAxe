import type { EffectKind } from './Effect'
import type { BlockKind } from '../engine/blocks/Block'
import { MIXER_INPUT_COUNT } from '../engine/blocks/MixerBlock'

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
}

interface SelectField {
  key: string
  label: string
  control: 'select'
  options: Array<{ value: string; label: string }>
  defaultValue: string
  group?: string
}

export type ParamFieldSchema = KnobField | SelectField

const dB = (value: number) => `${value.toFixed(0)}dB`
const ms = (value: number) => `${Math.round(value * 1000)}ms`
const percent = (value: number) => `${Math.round(value * 100)}%`
const hz = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(1)}kHz` : `${Math.round(value)}Hz`
const ratio = (value: number) => `${value.toFixed(1)}:1`
const plain = (value: number) => value.toFixed(2)

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
      defaultValue: 1,
      formatValue: plain,
      group,
    },
  ]
}

/**
 * Declarative per-effect-kind field list, driving one generic renderer
 * (EffectParamsPanel) instead of bespoke UI per effect. Ranges/defaults
 * mirror each effect class's own constructor/setter defaults.
 */
export const EFFECT_PARAM_SCHEMAS: Record<EffectKind, ParamFieldSchema[]> = {
  'noise-gate': [
    {
      key: 'threshold',
      label: 'Threshold',
      control: 'knob',
      min: -100,
      max: 0,
      step: 1,
      defaultValue: -50,
      formatValue: dB,
    },
    {
      key: 'attack',
      label: 'Attack',
      control: 'knob',
      min: 0.0001,
      max: 0.05,
      step: 0.001,
      defaultValue: 0.003,
      formatValue: ms,
    },
    {
      key: 'release',
      label: 'Release',
      control: 'knob',
      min: 0.01,
      max: 1,
      step: 0.01,
      defaultValue: 0.15,
      formatValue: ms,
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
      defaultValue: -24,
      formatValue: dB,
    },
    {
      key: 'knee',
      label: 'Knee',
      control: 'knob',
      min: 0,
      max: 40,
      step: 1,
      defaultValue: 6,
      formatValue: dB,
    },
    {
      key: 'ratio',
      label: 'Ratio',
      control: 'knob',
      min: 1,
      max: 20,
      step: 0.5,
      defaultValue: 3,
      formatValue: ratio,
    },
    {
      key: 'attack',
      label: 'Attack',
      control: 'knob',
      min: 0,
      max: 1,
      step: 0.001,
      defaultValue: 0.01,
      formatValue: ms,
    },
    {
      key: 'release',
      label: 'Release',
      control: 'knob',
      min: 0.01,
      max: 1,
      step: 0.01,
      defaultValue: 0.2,
      formatValue: ms,
    },
  ],
  eq: [
    ...eqBand(0, [40, 500], 100),
    ...eqBand(1, [200, 2000], 500),
    ...eqBand(2, [500, 5000], 2000),
    ...eqBand(3, [2000, 12000], 6000),
  ],
  drive: [
    {
      key: 'type',
      label: 'Type',
      control: 'select',
      defaultValue: 'overdrive',
      options: [
        { value: 'overdrive', label: 'Overdrive' },
        { value: 'distortion', label: 'Distortion' },
        { value: 'fuzz', label: 'Fuzz' },
      ],
    },
    {
      key: 'drive',
      label: 'Drive',
      control: 'knob',
      min: 0,
      max: 1,
      step: 0.01,
      defaultValue: 0.5,
      formatValue: percent,
    },
    {
      key: 'tone',
      label: 'Tone',
      control: 'knob',
      min: 1000,
      max: 12000,
      step: 100,
      defaultValue: 8000,
      formatValue: hz,
    },
    {
      key: 'level',
      label: 'Level',
      control: 'knob',
      min: 0,
      max: 1.5,
      step: 0.01,
      defaultValue: 0.7,
      formatValue: percent,
    },
  ],
  chorus: [
    {
      key: 'rate',
      label: 'Rate',
      control: 'knob',
      min: 0.05,
      max: 10,
      step: 0.05,
      defaultValue: 1.2,
      formatValue: hz,
    },
    {
      key: 'depth',
      label: 'Depth',
      control: 'knob',
      min: 0,
      max: 20,
      step: 0.5,
      defaultValue: 4,
      formatValue: ms,
    },
    {
      key: 'feedback',
      label: 'Feedback',
      control: 'knob',
      min: 0,
      max: 0.9,
      step: 0.01,
      defaultValue: 0.15,
      formatValue: percent,
    },
  ],
  flanger: [
    {
      key: 'rate',
      label: 'Rate',
      control: 'knob',
      min: 0.02,
      max: 5,
      step: 0.02,
      defaultValue: 0.25,
      formatValue: hz,
    },
    {
      key: 'depth',
      label: 'Depth',
      control: 'knob',
      min: 0,
      max: 10,
      step: 0.2,
      defaultValue: 2,
      formatValue: ms,
    },
    {
      key: 'feedback',
      label: 'Feedback',
      control: 'knob',
      min: 0,
      max: 0.95,
      step: 0.01,
      defaultValue: 0.6,
      formatValue: percent,
    },
  ],
  phaser: [
    {
      key: 'rate',
      label: 'Rate',
      control: 'knob',
      min: 0.05,
      max: 5,
      step: 0.05,
      defaultValue: 0.4,
      formatValue: hz,
    },
    {
      key: 'depth',
      label: 'Depth',
      control: 'knob',
      min: 0,
      max: 900,
      step: 10,
      defaultValue: 900,
      formatValue: hz,
    },
    {
      key: 'feedback',
      label: 'Feedback',
      control: 'knob',
      min: 0,
      max: 0.95,
      step: 0.01,
      defaultValue: 0.5,
      formatValue: percent,
    },
  ],
  tremolo: [
    {
      key: 'rate',
      label: 'Rate',
      control: 'knob',
      min: 0.5,
      max: 20,
      step: 0.1,
      defaultValue: 5,
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
  ],
  delay: [
    {
      key: 'time',
      label: 'Time',
      control: 'knob',
      min: 0.01,
      max: 2,
      step: 0.01,
      defaultValue: 0.35,
      formatValue: ms,
    },
    {
      key: 'feedback',
      label: 'Feedback',
      control: 'knob',
      min: 0,
      max: 0.95,
      step: 0.01,
      defaultValue: 0.35,
      formatValue: percent,
    },
    {
      key: 'tone',
      label: 'Tone',
      control: 'knob',
      min: 500,
      max: 15000,
      step: 100,
      defaultValue: 12000,
      formatValue: hz,
    },
  ],
  'ping-pong-delay': [
    {
      key: 'time',
      label: 'Time',
      control: 'knob',
      min: 0.01,
      max: 2,
      step: 0.01,
      defaultValue: 0.3,
      formatValue: ms,
    },
    {
      key: 'feedback',
      label: 'Feedback',
      control: 'knob',
      min: 0,
      max: 0.95,
      step: 0.01,
      defaultValue: 0.35,
      formatValue: percent,
    },
  ],
  reverb: [
    {
      key: 'roomSize',
      label: 'Size',
      control: 'knob',
      min: 0,
      max: 0.97,
      step: 0.01,
      defaultValue: 0.84,
      formatValue: percent,
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
  ],
}

const TONE_STACK_BANDS = ['bass', 'mid', 'treble', 'presence'] as const

/**
 * Schema entries for the 4 new grid block kinds beyond the 11 effects
 * (Amp has none - model loading isn't a continuous "param", and its only
 * one, slim size, gets a dedicated select like it already did on the old
 * ChannelStrip rather than going through the generic knob panel).
 */
export const BLOCK_PARAM_SCHEMAS: Partial<Record<BlockKind, ParamFieldSchema[]>> = {
  'tone-stack': TONE_STACK_BANDS.map((key) => ({
    key,
    label: key[0]!.toUpperCase() + key.slice(1),
    control: 'knob',
    min: -12,
    max: 12,
    step: 0.1,
    defaultValue: 0,
    formatValue: (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}dB`,
  })),
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
}

/** Looks up the field schema for any grid block kind - the 11 effect kinds plus the 4 new ones. */
export function getParamSchema(kind: BlockKind): ParamFieldSchema[] {
  if (kind in EFFECT_PARAM_SCHEMAS) return EFFECT_PARAM_SCHEMAS[kind as EffectKind]
  return BLOCK_PARAM_SCHEMAS[kind] ?? []
}
