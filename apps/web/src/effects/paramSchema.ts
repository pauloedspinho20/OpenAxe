import type { EffectKind } from './Effect'
import type { EffectParams } from './Effect'
import type { BlockKind } from '../engine/blocks/Block'
import { MIXER_INPUT_COUNT } from '../engine/blocks/MixerBlock'
import { SPLITTER_OUTPUT_COUNT } from '../engine/blocks/SplitterBlock'
import { PARAM_RANGES } from './generatedParamRanges'

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

type SymbolRange = { min: number; max: number }
/** reverb is excluded - see the comment above EFFECT_PARAM_SCHEMAS.reverb for why its knobs
 * can't be sourced from the generated per-symbol range map the way every other kind's can. */
type RangeKind = Exclude<keyof typeof PARAM_RANGES, 'reverb'>

/**
 * A knob's min/max, sourced from the core's own param table (issue #72)
 * instead of hand-duplicated here - packages/core/param_schema.json is the
 * source of truth, generated into generatedParamRanges.ts by
 * scripts/gen-param-schema.mjs. Everything else about a field (step,
 * defaultValue, formatValue, group, visible) is a UI presentation choice
 * with no core-side equivalent and stays hand-written below.
 */
function range(kind: RangeKind, symbol: string): SymbolRange {
  const forKind = PARAM_RANGES[kind] as Record<string, SymbolRange>
  const found = forKind[symbol]
  if (!found) throw new Error(`paramSchema: no generated range for ${kind}.${symbol}`)
  return found
}

const dB = (value: number) => `${value.toFixed(0)}dB`
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

function eqBand(index: number, freqDefault: number): KnobField[] {
  const group = `Band ${index + 1}`
  return [
    {
      key: `band${index}_frequency`,
      label: 'Freq',
      control: 'knob',
      ...range('eq', `band${index}_frequency`),
      step: 10,
      defaultValue: freqDefault,
      formatValue: hz,
      group,
    },
    {
      key: `band${index}_gain`,
      label: 'Gain',
      control: 'knob',
      ...range('eq', `band${index}_gain`),
      step: 0.5,
      defaultValue: 0,
      formatValue: dB,
      group,
    },
    {
      key: `band${index}_q`,
      label: 'Q',
      control: 'knob',
      ...range('eq', `band${index}_q`),
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
      ...range('noise-gate', 'threshold'),
      step: 1,
      defaultValue: -40,
      formatValue: dB,
    },
    {
      key: 'hysteresis',
      label: 'Hysteresis',
      control: 'knob',
      ...range('noise-gate', 'hysteresis'),
      step: 0.5,
      defaultValue: 4,
      formatValue: dB,
    },
    {
      key: 'attack',
      label: 'Attack',
      control: 'knob',
      ...range('noise-gate', 'attack'),
      step: 0.5,
      defaultValue: 0.5,
      formatValue: msRaw,
    },
    {
      key: 'hold',
      label: 'Hold',
      control: 'knob',
      ...range('noise-gate', 'hold'),
      step: 5,
      defaultValue: 50,
      formatValue: msRaw,
    },
    {
      key: 'release',
      label: 'Release',
      control: 'knob',
      ...range('noise-gate', 'release'),
      step: 10,
      defaultValue: 100,
      formatValue: msRaw,
    },
    {
      key: 'range',
      label: 'Range',
      control: 'knob',
      ...range('noise-gate', 'range'),
      step: 1,
      defaultValue: -80,
      formatValue: dB,
    },
    {
      key: 'mix',
      label: 'Mix',
      control: 'knob',
      min: 0,
      max: 1,
      step: 0.01,
      defaultValue: 0.4,
      formatValue: percent,
    },
  ],
  compressor: [
    {
      key: 'threshold',
      label: 'Threshold',
      control: 'knob',
      ...range('compressor', 'threshold'),
      step: 1,
      defaultValue: -18,
      formatValue: dB,
    },
    {
      key: 'ratio',
      label: 'Ratio',
      control: 'knob',
      ...range('compressor', 'ratio'),
      step: 0.5,
      defaultValue: 4,
      formatValue: ratio,
    },
    {
      key: 'attack',
      label: 'Attack',
      control: 'knob',
      ...range('compressor', 'attack'),
      step: 1,
      defaultValue: 5,
      formatValue: msRaw,
    },
    {
      key: 'release',
      label: 'Release',
      control: 'knob',
      ...range('compressor', 'release'),
      step: 10,
      defaultValue: 100,
      formatValue: msRaw,
    },
    {
      key: 'knee',
      label: 'Knee',
      control: 'knob',
      ...range('compressor', 'knee'),
      step: 1,
      defaultValue: 0,
      formatValue: dB,
    },
    {
      key: 'makeup_gain',
      label: 'Makeup',
      control: 'knob',
      ...range('compressor', 'makeup_gain'),
      step: 0.5,
      defaultValue: 0,
      formatValue: dB,
    },
    {
      // character is a select in the UI, but a plain numeric param core-side
      // (0..3) - see range('compressor', 'character') if a range is ever
      // needed here; the option value strings are 100% UI-invented, nothing
      // in param_schema.json enumerates them.
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
      ...range('compressor', 'mix'),
      step: 0.01,
      defaultValue: 1,
      formatValue: percent,
    },
  ],
  eq: [
    ...eqBand(0, 100),
    ...eqBand(1, 500),
    ...eqBand(2, 2000),
    ...eqBand(3, 6000),
    {
      key: 'mix',
      label: 'Mix',
      control: 'knob',
      min: 0,
      max: 1,
      step: 0.01,
      defaultValue: 0.4,
      formatValue: percent,
    },
  ],
  chorus: [
    {
      key: 'rate',
      label: 'Rate',
      control: 'knob',
      ...range('chorus', 'rate'),
      step: 0.05,
      defaultValue: 0.2,
      formatValue: hz,
    },
    {
      key: 'depth',
      label: 'Depth',
      control: 'knob',
      ...range('chorus', 'depth'),
      step: 0.1,
      defaultValue: 0.8,
      formatValue: msRaw,
    },
    {
      key: 'delay',
      label: 'Delay',
      control: 'knob',
      ...range('chorus', 'delay'),
      step: 0.5,
      defaultValue: 5.5,
      formatValue: msRaw,
    },
    {
      key: 'feedback',
      label: 'Feedback',
      control: 'knob',
      ...range('chorus', 'feedback'),
      step: 0.01,
      defaultValue: 0.15,
      formatValue: percent,
    },
    {
      key: 'mix',
      label: 'Mix',
      control: 'knob',
      min: 0,
      max: 1,
      step: 0.01,
      defaultValue: 0.4,
      formatValue: percent,
    },
  ],
  flanger: [
    {
      key: 'rate',
      label: 'Rate',
      control: 'knob',
      ...range('flanger', 'rate'),
      step: 0.05,
      defaultValue: 0.2,
      formatValue: hz,
    },
    {
      key: 'depth',
      label: 'Depth',
      control: 'knob',
      ...range('flanger', 'depth'),
      step: 0.1,
      defaultValue: 0.4,
      formatValue: msRaw,
    },
    {
      key: 'delay',
      label: 'Delay',
      control: 'knob',
      ...range('flanger', 'delay'),
      step: 0.05,
      defaultValue: 0.3,
      formatValue: msRaw,
    },
    {
      key: 'feedback',
      label: 'Feedback',
      control: 'knob',
      ...range('flanger', 'feedback'),
      step: 0.01,
      defaultValue: 0.25,
      formatValue: percent,
    },
    {
      key: 'mix',
      label: 'Mix',
      control: 'knob',
      min: 0,
      max: 1,
      step: 0.01,
      defaultValue: 0.4,
      formatValue: percent,
    },
  ],
  phaser: [
    {
      key: 'rate',
      label: 'Rate',
      control: 'knob',
      ...range('phaser', 'rate'),
      step: 0.05,
      defaultValue: 0.2,
      formatValue: hz,
    },
    {
      key: 'depth',
      label: 'Depth',
      control: 'knob',
      ...range('phaser', 'depth'),
      step: 0.01,
      defaultValue: 0.6,
      formatValue: percent,
    },
    {
      key: 'feedback',
      label: 'Feedback',
      control: 'knob',
      ...range('phaser', 'feedback'),
      step: 0.01,
      defaultValue: 0.35,
      formatValue: percent,
    },
    {
      key: 'stages',
      label: 'Stages',
      control: 'knob',
      ...range('phaser', 'stages'),
      step: 1,
      defaultValue: 4,
      formatValue: plain,
    },
    {
      key: 'mix',
      label: 'Mix',
      control: 'knob',
      min: 0,
      max: 1,
      step: 0.01,
      defaultValue: 0.4,
      formatValue: percent,
    },
  ],
  tremolo: [
    {
      key: 'rate',
      label: 'Rate',
      control: 'knob',
      ...range('tremolo', 'rate'),
      step: 0.1,
      defaultValue: 4,
      formatValue: hz,
    },
    {
      key: 'depth',
      label: 'Depth',
      control: 'knob',
      ...range('tremolo', 'depth'),
      step: 0.01,
      defaultValue: 0.5,
      formatValue: percent,
    },
    {
      // shape is a select in the UI, backed by a plain numeric param
      // core-side (0..2, see range('tremolo', 'shape')) - the option value
      // strings are 100% UI-invented, same situation as compressor.character.
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
    {
      key: 'stereo',
      label: 'Stereo',
      control: 'select',
      options: [
        { value: 'mono', label: 'Mono' },
        { value: 'stereo', label: 'Stereo' },
      ],
      defaultValue: 'stereo',
    },
    {
      key: 'mode',
      label: 'Mode',
      control: 'select',
      options: [
        { value: 'normal', label: 'Normal' },
        { value: 'harmonic', label: 'Harmonic' },
      ],
      defaultValue: 'normal',
    },
    {
      key: 'mix',
      label: 'Mix',
      control: 'knob',
      min: 0,
      max: 1,
      step: 0.01,
      defaultValue: 0.4,
      formatValue: percent,
    },
  ],
  'ring-mod': [
    {
      key: 'frequency',
      label: 'Frequency',
      control: 'knob',
      ...range('ring-mod', 'frequency'),
      step: 5,
      defaultValue: 400,
      formatValue: hz,
    },
    {
      key: 'drive',
      label: 'Drive',
      control: 'knob',
      ...range('ring-mod', 'drive'),
      step: 0.01,
      defaultValue: 0.3,
      formatValue: percent,
    },
    {
      key: 'mix',
      label: 'Mix',
      control: 'knob',
      min: 0,
      max: 1,
      step: 0.01,
      defaultValue: 0.5,
      formatValue: percent,
    },
  ],
  filter: [
    {
      key: 'type',
      label: 'Type',
      control: 'select',
      options: [
        { value: 'wah', label: 'Wah' },
        { value: 'envelope', label: 'Envelope' },
        { value: 'ladder', label: 'Ladder' },
      ],
      defaultValue: 'wah',
      primary: true,
    },
    {
      key: 'frequency',
      label: 'Frequency',
      control: 'knob',
      ...range('filter', 'frequency'),
      step: 10,
      defaultValue: 800,
      formatValue: hz,
    },
    {
      key: 'q',
      label: 'Q',
      control: 'knob',
      ...range('filter', 'q'),
      step: 0.1,
      defaultValue: 2,
      formatValue: plain,
    },
    {
      key: 'drive',
      label: 'Drive',
      control: 'knob',
      ...range('filter', 'drive'),
      step: 0.01,
      defaultValue: 0,
      formatValue: percent,
    },
    {
      key: 'sensitivity',
      label: 'Sensitivity',
      control: 'knob',
      ...range('filter', 'sensitivity'),
      step: 0.01,
      defaultValue: 0.5,
      formatValue: percent,
    },
    {
      key: 'mode',
      label: 'Drive Mode',
      control: 'select',
      options: [
        { value: 'pedal', label: 'Pedal' },
        { value: 'env', label: 'Env' },
        { value: 'lfo', label: 'LFO' },
      ],
      defaultValue: 'pedal',
    },
    {
      key: 'lfo_rate',
      label: 'LFO Rate',
      control: 'knob',
      ...range('filter', 'lfo_rate'),
      step: 0.1,
      defaultValue: 1,
      formatValue: hz,
    },
    {
      key: 'mix',
      label: 'Mix',
      control: 'knob',
      min: 0,
      max: 1,
      step: 0.01,
      defaultValue: 0.5,
      formatValue: percent,
    },
  ],
  'pitch-shifter': [
    {
      key: 'mode',
      label: 'Mode',
      control: 'select',
      options: [
        { value: 'detune', label: 'Detune' },
        { value: 'whammy', label: 'Whammy' },
      ],
      defaultValue: 'whammy',
      primary: true,
    },
    {
      key: 'pitch',
      label: 'Pitch',
      control: 'knob',
      ...range('pitch-shifter', 'pitch'),
      step: 1,
      defaultValue: 0,
      formatValue: plain,
    },
    {
      key: 'detune_cents',
      label: 'Detune',
      control: 'knob',
      ...range('pitch-shifter', 'detune_cents'),
      step: 1,
      defaultValue: 5,
      formatValue: plain,
    },
    {
      key: 'mix',
      label: 'Mix',
      control: 'knob',
      min: 0,
      max: 1,
      step: 0.01,
      defaultValue: 0.5,
      formatValue: percent,
    },
  ],
  'granular-delay': [
    {
      key: 'time',
      label: 'Time',
      control: 'knob',
      ...range('granular-delay', 'time'),
      step: 10,
      defaultValue: 400,
      formatValue: msRaw,
    },
    {
      key: 'grain_size',
      label: 'Grain Size',
      control: 'knob',
      ...range('granular-delay', 'grain_size'),
      step: 5,
      defaultValue: 80,
      formatValue: msRaw,
    },
    {
      key: 'density',
      label: 'Density',
      control: 'knob',
      ...range('granular-delay', 'density'),
      step: 1,
      defaultValue: 8,
      formatValue: hz,
    },
    {
      key: 'pitch',
      label: 'Pitch',
      control: 'knob',
      ...range('granular-delay', 'pitch'),
      step: 1,
      defaultValue: 0,
      formatValue: plain,
    },
    {
      key: 'jitter',
      label: 'Jitter',
      control: 'knob',
      ...range('granular-delay', 'jitter'),
      step: 0.01,
      defaultValue: 0.2,
      formatValue: percent,
    },
    {
      key: 'feedback',
      label: 'Feedback',
      control: 'knob',
      ...range('granular-delay', 'feedback'),
      step: 0.01,
      defaultValue: 0.3,
      formatValue: percent,
    },
    {
      key: 'spread',
      label: 'Spread',
      control: 'knob',
      ...range('granular-delay', 'spread'),
      step: 0.01,
      defaultValue: 0.5,
      formatValue: percent,
    },
    {
      key: 'character',
      label: 'Character',
      control: 'knob',
      ...range('granular-delay', 'character'),
      step: 0.01,
      defaultValue: 0,
      formatValue: percent,
    },
    {
      key: 'freeze',
      label: 'Freeze',
      control: 'select',
      options: [
        { value: 'off', label: 'Off' },
        { value: 'on', label: 'On' },
      ],
      defaultValue: 'off',
    },
    {
      key: 'mix',
      label: 'Mix',
      control: 'knob',
      min: 0,
      max: 1,
      step: 0.01,
      defaultValue: 0.3,
      formatValue: percent,
    },
  ],
  rotary: [
    {
      key: 'speed',
      label: 'Speed',
      control: 'select',
      options: [
        { value: 'stop', label: 'Stop' },
        { value: 'chorale', label: 'Chorale' },
        { value: 'tremolo', label: 'Tremolo' },
      ],
      defaultValue: 'chorale',
      primary: true,
    },
    {
      key: 'drive',
      label: 'Drive',
      control: 'knob',
      ...range('rotary', 'drive'),
      step: 0.01,
      defaultValue: 0.2,
      formatValue: percent,
    },
    {
      key: 'horn_level',
      label: 'Horn',
      control: 'knob',
      ...range('rotary', 'horn_level'),
      step: 0.01,
      defaultValue: 0.7,
      formatValue: percent,
    },
    {
      key: 'drum_level',
      label: 'Drum',
      control: 'knob',
      ...range('rotary', 'drum_level'),
      step: 0.01,
      defaultValue: 0.7,
      formatValue: percent,
    },
    {
      key: 'mic_distance',
      label: 'Mic',
      control: 'knob',
      ...range('rotary', 'mic_distance'),
      step: 0.01,
      defaultValue: 0.3,
      formatValue: percent,
    },
    {
      key: 'crossover',
      label: 'Crossover',
      control: 'knob',
      ...range('rotary', 'crossover'),
      step: 10,
      defaultValue: 800,
      formatValue: hz,
    },
    {
      key: 'mix',
      label: 'Mix',
      control: 'knob',
      min: 0,
      max: 1,
      step: 0.01,
      defaultValue: 0.5,
      formatValue: percent,
    },
  ],
  // 3 character models: Digital (clean), Analog (BBD-style filtering +
  // saturation), Tape (Analog + wow/flutter pitch modulation).
  delay: [
    {
      // model is a select in the UI, backed by a plain numeric param
      // core-side (0..2, see range('delay', 'model')) - same situation as
      // compressor.character/tremolo.shape.
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
      ...range('delay', 'time'),
      step: 5,
      defaultValue: 300,
      formatValue: msRaw,
    },
    {
      key: 'feedback',
      label: 'Feedback',
      control: 'knob',
      ...range('delay', 'feedback'),
      step: 0.01,
      defaultValue: 0.4,
      formatValue: percent,
    },
    {
      key: 'tone',
      label: 'Tone',
      control: 'knob',
      ...range('delay', 'tone'),
      step: 50,
      defaultValue: 6000,
      formatValue: hz,
    },
    {
      key: 'wow_depth',
      label: 'Wow Depth',
      control: 'knob',
      ...range('delay', 'wow_depth'),
      step: 0.1,
      defaultValue: 1.5,
      formatValue: msRaw,
      visible: (v) => v.model === 'tape',
    },
    {
      key: 'wow_rate',
      label: 'Wow Rate',
      control: 'knob',
      ...range('delay', 'wow_rate'),
      step: 0.05,
      defaultValue: 0.5,
      formatValue: hz,
      visible: (v) => v.model === 'tape',
    },
    {
      key: 'mix',
      label: 'Mix',
      control: 'knob',
      min: 0,
      max: 1,
      step: 0.01,
      defaultValue: 0.1,
      formatValue: percent,
    },
    {
      key: 'level',
      label: 'Level',
      control: 'knob',
      min: 0,
      max: 1.5,
      step: 0.01,
      defaultValue: 1,
      formatValue: percent,
    },
  ],
  'ping-pong-delay': [
    {
      key: 'time',
      label: 'Time',
      control: 'knob',
      ...range('ping-pong-delay', 'time'),
      step: 5,
      defaultValue: 250,
      formatValue: msRaw,
    },
    {
      key: 'feedback',
      label: 'Feedback',
      control: 'knob',
      ...range('ping-pong-delay', 'feedback'),
      step: 0.01,
      defaultValue: 0.5,
      formatValue: percent,
    },
    {
      key: 'tone',
      label: 'Tone',
      control: 'knob',
      ...range('ping-pong-delay', 'tone'),
      step: 50,
      defaultValue: 6000,
      formatValue: hz,
    },
    {
      key: 'width',
      label: 'Width',
      control: 'knob',
      min: 0,
      max: 1,
      step: 0.01,
      defaultValue: 1,
      formatValue: percent,
    },
    {
      key: 'mix',
      label: 'Mix',
      control: 'knob',
      min: 0,
      max: 1,
      step: 0.01,
      defaultValue: 0.1,
      formatValue: percent,
    },
    {
      key: 'level',
      label: 'Level',
      control: 'knob',
      min: 0,
      max: 1.5,
      step: 0.01,
      defaultValue: 1,
      formatValue: percent,
    },
  ],
  // Four Dragonfly Reverb algorithms (packages/core): Hall, Room, Plate,
  // Early Reflections. Each algorithm exposes a different subset of the
  // 7 user-facing knobs — roomSize/damping (Freeverb-compatible) and width
  // are universal; predelay/spin/wander/earlySend vary by algorithm. Per-
  // field `visible` predicates hide knobs the current algorithm doesn't
  // support (the C++ side harmlessly ignores out-of-range indices).
  //
  // Not sourced from generatedParamRanges.ts, unlike every other kind above:
  // roomSize/damping are UI-only abstractions (no 1:1 core symbol at all -
  // computed via per-algorithm formulas into decay/high_cut), and the
  // remaining knobs' core symbols aren't consistent across the 4 algorithm
  // variants for "the same" UI concept (Hall's `delay` vs. Room's
  // `predelay` both back this one `predelay` knob) - see
  // packages/core/param_schema.json's reverb.comment and reverb.derived.
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
    ...range('amp', 'bass'),
    step: 0.5,
    defaultValue: 0,
    formatValue: dB,
    group: 'EQ',
  },
  {
    key: 'mid',
    label: 'Mid',
    control: 'knob',
    ...range('amp', 'mid'),
    step: 0.5,
    defaultValue: 0,
    formatValue: dB,
    group: 'EQ',
  },
  {
    key: 'treble',
    label: 'Treble',
    control: 'knob',
    ...range('amp', 'treble'),
    step: 0.5,
    defaultValue: 0,
    formatValue: dB,
    group: 'EQ',
  },
  {
    key: 'presence',
    label: 'Presence',
    control: 'knob',
    ...range('amp', 'presence'),
    step: 0.5,
    defaultValue: 0,
    formatValue: dB,
    group: 'EQ',
  },
]

/**
 * Pre/post trims - shared by every NAM model block kind and Cab (see
 * AmpBlock/CabBlock's own input/output gain stages). NOT sourced from
 * generatedParamRanges.ts: the core's amp.input_level/output_level symbols
 * exist, but mean the loaded capture's dBu calibration (-100..100), a
 * completely different scale/meaning from these UI I/O trim knobs (0..1.5) -
 * see NativeBlock.ts's doc comment. packages/core/param_schema.json has no
 * entry for what these fields actually represent.
 */
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
 *
 * Slim size is intentionally not exposed per-block in the inspector
 * (see BlockInspector): slimmable models always run at full quality
 * (max slim size = 1) and are not per-block adjustable here. The
 * global quality in SettingsDialog remains the single place to trade
 * fidelity for CPU if needed, but per-block Slim knobs are hidden.
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
      // The UI calls this irMix (camelCase); the core symbol is ir_mix -
      // the bridge aliases it, the same way it does slimSize.
      key: 'irMix',
      label: 'IR Mix',
      control: 'knob',
      ...range('cab', 'ir_mix'),
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
        ...range('mixer', `in${i}_level`),
        step: 0.01,
        defaultValue: 1,
        formatValue: percent,
        group,
      },
      {
        key: `in${i}_pan`,
        label: 'Pan',
        control: 'knob',
        ...range('mixer', `in${i}_pan`),
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
    ...range('splitter', `out${i}_level`),
    step: 0.01,
    defaultValue: 1,
    formatValue: percent,
    group: `Out ${i + 1}`,
  })),
}

/** Raw Dragonfly reverb params for an algorithm variant, from generated ranges (issue #263 expert mode). */
export function getReverbRawSchemas(algorithm: string): ParamFieldSchema[] {
  const variant = (
    PARAM_RANGES.reverb as Record<string, Record<string, { min: number; max: number }>>
  )[algorithm]
  if (!variant) return []
  const fields: ParamFieldSchema[] = []
  for (const [symbol, range] of Object.entries(variant)) {
    // Map symbol to label/unit formatting: use symbol as label (capitalize) and infer formatter from range span.
    const label = symbol
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
    const span = range.max - range.min
    let step = 1
    let format = plain
    if (symbol.includes('cut') || symbol.includes('xo') || symbol.includes('freq')) {
      step = span > 1000 ? 10 : 1
      format = hz
    } else if (symbol.includes('decay')) {
      step = 0.1
      format = plain
    } else if (symbol.includes('delay') || symbol.includes('predelay')) {
      step = 1
      format = msRaw
    } else if (range.max <= 1 && range.min >= 0) {
      step = 0.01
      format = percent
    } else if (span <= 10) {
      step = 0.1
      format = plain
    }
    // Default to midpoint of range; actual core default will be seeded via block creation,
    // but this provides a sensible initial knob position until user touches it.
    const mid = (range.min + range.max) / 2
    fields.push({
      key: symbol,
      label,
      control: 'knob',
      min: range.min,
      max: range.max,
      step,
      defaultValue: Number.isFinite(mid) ? Math.round(mid * 100) / 100 : range.min,
      formatValue: format,
    })
  }
  return fields
}

/** Looks up the field schema for any grid block kind - the 11 effect kinds plus the 4 new ones. */
export function getParamSchema(kind: BlockKind): ParamFieldSchema[] {
  if (kind in EFFECT_PARAM_SCHEMAS) return EFFECT_PARAM_SCHEMAS[kind as EffectKind]
  return BLOCK_PARAM_SCHEMAS[kind] ?? []
}
