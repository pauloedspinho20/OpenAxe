import type { EffectKind } from './Effect'
import type { EffectParams } from './Effect'
import type { BlockKind } from '../engine/blocks/Block'
import { MIXER_INPUT_COUNT } from '../engine/blocks/MixerBlock'
import { PARAM_RANGES } from './generatedParamRanges'
import type { BlockInstance, EdgeInstance } from '../state/graphStore'
import { BLOCK_KIND_LABELS } from '../components/grid/blockOptions'
import { sendReturnPairOf } from '../engine/blocks/blockRegistry'

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
  /** Human-readable help shown in knob tooltip and Effect Details dialog. */
  description?: string
  /** If set, the knob renders disabled - used by the Mixer for inputs with no block connected (issue #428). */
  disabled?: boolean
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
  /** Human-readable help shown in select tooltip and Effect Details dialog. */
  description?: string
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
/**
 * A linear I/O trim gain (0..1.5) rendered as dB: 1 → "0.0dB" (unity),
 * 1.5 → "+3.5dB", 0.5 → "−6.0dB", 0 → "−∞dB". Positive boosts carry an
 * explicit "+" so boost vs. cut reads at a glance; the minus is the same
 * U+2212 the meter peak readouts use.
 */
const trimDb = (value: number) => {
  if (value <= 0) return '−∞dB'
  const db = 20 * Math.log10(value)
  if (db === 0) return '0.0dB'
  const sign = db > 0 ? '+' : ''
  return `${sign}${db.toFixed(1).replace('-', '−')}dB`
}
const percent = (value: number) => `${Math.round(value * 100)}%`
const hz = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(1)}kHz` : `${Math.round(value)}Hz`
const ratio = (value: number) => `${value.toFixed(1)}:1`
const plain = (value: number) => value.toFixed(2)
// The reverb's width/predelay/spin/wander/earlySend params (see
// getReverbRawSchemas below) are already in their display unit, unlike `ms`/
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
      label: `Freq ${index + 1}`,
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
      description: 'Level where the effect starts acting. Lower catches more signal.',
    },
    {
      key: 'hysteresis',
      label: 'Hysteresis',
      control: 'knob',
      ...range('noise-gate', 'hysteresis'),
      step: 0.5,
      defaultValue: 4,
      formatValue: dB,
      description: 'Gap between open/close thresholds. Prevents chattering.',
    },
    {
      key: 'attack',
      label: 'Attack',
      control: 'knob',
      ...range('noise-gate', 'attack'),
      step: 0.5,
      defaultValue: 0.5,
      formatValue: msRaw,
      description: 'How fast the effect engages after crossing threshold.',
    },
    {
      key: 'hold',
      label: 'Hold',
      control: 'knob',
      ...range('noise-gate', 'hold'),
      step: 5,
      defaultValue: 50,
      formatValue: msRaw,
      description: 'Time the gate stays open after signal drops.',
    },
    {
      key: 'release',
      label: 'Release',
      control: 'knob',
      ...range('noise-gate', 'release'),
      step: 10,
      defaultValue: 100,
      formatValue: msRaw,
      description: 'Time to fade back to idle after hold. Longer = smoother.',
    },
    {
      key: 'range',
      label: 'Range',
      control: 'knob',
      ...range('noise-gate', 'range'),
      step: 1,
      defaultValue: -80,
      formatValue: dB,
      description: 'Gain reduction when closed. -100 dB = silent.',
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
      description: 'Dry/wet blend. 0 = dry, 1 = fully wet.',
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
      description: 'Level where the effect starts acting. Lower catches more signal.',
    },
    {
      key: 'ratio',
      label: 'Ratio',
      control: 'knob',
      ...range('compressor', 'ratio'),
      step: 0.5,
      defaultValue: 4,
      formatValue: ratio,
      description: 'Compression ratio above threshold. 4:1 is moderate, higher is stronger.',
    },
    {
      key: 'attack',
      label: 'Attack',
      control: 'knob',
      ...range('compressor', 'attack'),
      step: 1,
      defaultValue: 5,
      formatValue: msRaw,
      description: 'How fast the effect engages after crossing threshold.',
    },
    {
      key: 'release',
      label: 'Release',
      control: 'knob',
      ...range('compressor', 'release'),
      step: 10,
      defaultValue: 100,
      formatValue: msRaw,
      description:
        'Time for gain reduction to recover once the signal falls back. Longer = smoother.',
    },
    {
      key: 'knee',
      label: 'Knee',
      control: 'knob',
      ...range('compressor', 'knee'),
      step: 1,
      defaultValue: 0,
      formatValue: dB,
      description: 'Softness at threshold. 0 = hard, higher = gentler onset.',
    },
    {
      key: 'makeup_gain',
      label: 'Makeup',
      control: 'knob',
      ...range('compressor', 'makeup_gain'),
      step: 0.5,
      defaultValue: 0,
      formatValue: dB,
      description: 'Output gain to make up for level lost to compression.',
    },

    {
      key: 'mix',
      label: 'Mix',
      control: 'knob',
      ...range('compressor', 'mix'),
      step: 0.01,
      defaultValue: 1,
      formatValue: percent,
      description: 'Dry/wet blend. 0 = dry, 1 = fully wet.',
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
    },
  ],
  eq: [
    ...eqBand(0, 100),
    ...eqBand(1, 500),
    ...eqBand(2, 2000),
    ...eqBand(3, 6000),
    {
      key: 'low_cut',
      label: 'Low Cut',
      control: 'knob',
      ...range('eq', 'low_cut'),
      step: 5,
      defaultValue: 20,
      formatValue: hz,
      group: 'Cuts',
      description: 'High-pass filter after the bands. Trims boom without spending a band.',
    },
    {
      key: 'high_cut',
      label: 'High Cut',
      control: 'knob',
      ...range('eq', 'high_cut'),
      step: 50,
      defaultValue: 20000,
      formatValue: hz,
      group: 'Cuts',
      description: 'Low-pass filter after the bands. Trims fizz without spending a band.',
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
      description: 'Dry/wet blend. 0 = dry, 1 = fully wet.',
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
      description: 'LFO rate. Controls speed of modulation.',
    },
    {
      key: 'depth',
      label: 'Depth',
      control: 'knob',
      ...range('chorus', 'depth'),
      step: 0.1,
      defaultValue: 0.8,
      formatValue: msRaw,
      description: 'Modulation depth. Deeper = more pitch movement.',
    },
    {
      key: 'delay',
      label: 'Delay',
      control: 'knob',
      ...range('chorus', 'delay'),
      step: 0.5,
      defaultValue: 5.5,
      formatValue: msRaw,
      description: 'Base delay time. Sets centre of the sweep.',
    },
    {
      key: 'feedback',
      label: 'Feedback',
      control: 'knob',
      ...range('chorus', 'feedback'),
      step: 0.01,
      defaultValue: 0.15,
      formatValue: percent,
      description: 'Regeneration around the effect. Adds thickness or resonance.',
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
      description: 'Dry/wet blend. 0 = dry, 1 = fully wet.',
    },
    {
      // Named values, not '0'/'1': stringParamMaps.ts already owns
      // `stereo` -> { mono: 0, stereo: 1 } for tremolo, so both block facades
      // send the same number and web/desktop can't drift.
      key: 'stereo',
      label: 'Image',
      control: 'select',
      options: [
        { value: 'stereo', label: 'Stereo' },
        { value: 'mono', label: 'Mono' },
      ],
      defaultValue: 'stereo',
      description:
        'Stereo offsets the two channels\u2019 LFOs by a quarter cycle for width. Mono sweeps them together, which survives a later mono sum instead of partly cancelling.',
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
      description: 'LFO rate. Controls speed of modulation.',
    },
    {
      key: 'depth',
      label: 'Depth',
      control: 'knob',
      ...range('flanger', 'depth'),
      step: 0.1,
      defaultValue: 0.4,
      formatValue: msRaw,
      description: 'Modulation depth. Deeper = more pitch movement.',
    },
    {
      key: 'delay',
      label: 'Delay',
      control: 'knob',
      ...range('flanger', 'delay'),
      step: 0.05,
      defaultValue: 0.3,
      formatValue: msRaw,
      description: 'Base delay time. Sets centre of the sweep.',
    },
    {
      key: 'feedback',
      label: 'Feedback',
      control: 'knob',
      ...range('flanger', 'feedback'),
      step: 0.01,
      defaultValue: 0.25,
      formatValue: percent,
      description: 'Regeneration around the effect. Adds thickness or resonance.',
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
      description: 'Dry/wet blend. 0 = dry, 1 = fully wet.',
    },
  ],
  phaser: [
    {
      key: 'rate',
      label: 'Speed',
      control: 'knob',
      ...range('phaser', 'rate'),
      step: 0.05,
      defaultValue: 0.5,
      formatValue: hz,
      description:
        'The pedal\u2019s Speed knob. Slow for the EVH swirl, fast for Leslie-like warble.',
    },
    {
      key: 'script',
      label: 'Voice',
      control: 'select',
      options: [
        { value: 'script', label: 'Script' },
        { value: 'block', label: 'Block' },
      ],
      defaultValue: 'script',
      description:
        'The EVH pedal\u2019s Script switch. Script is the vintage voice - light regeneration, soft chewy sweep. Block is hotter feedback for sharper, more resonant peaks.',
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
      description: 'Dry/wet blend. 0 = dry, 1 = fully wet.',
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
      description: 'LFO rate. Controls speed of modulation.',
    },
    {
      key: 'depth',
      label: 'Depth',
      control: 'knob',
      ...range('tremolo', 'depth'),
      step: 0.01,
      defaultValue: 0.5,
      formatValue: percent,
      description: 'Amplitude modulation depth. Deeper = stronger volume pulse.',
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
    },
    {
      key: 'stereo',
      label: 'Mode',
      control: 'select',
      options: [
        { value: 'mono', label: 'Mono' },
        { value: 'stereo', label: 'Stereo' },
      ],
      defaultValue: 'stereo',
      description: 'Stereo mode. Mono = same both sides, Stereo = antiphase width.',
    },
    {
      key: 'mode',
      label: 'Type',
      control: 'select',
      options: [
        { value: 'normal', label: 'Normal' },
        { value: 'harmonic', label: 'Harmonic' },
      ],
      defaultValue: 'normal',
      description: 'Mode selector for this block.',
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
      description: 'Dry/wet blend. 0 = dry, 1 = fully wet.',
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
      description: 'Centre frequency. Sets where the effect is focused.',
    },
    {
      key: 'drive',
      label: 'Drive',
      control: 'knob',
      ...range('ring-mod', 'drive'),
      step: 0.01,
      defaultValue: 0.3,
      formatValue: percent,
      description: 'Saturation/drive. Adds grit before or inside the effect.',
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
      description: 'Dry/wet blend. 0 = dry, 1 = fully wet.',
    },
  ],
  filter: [
    {
      key: 'frequency',
      label: 'Frequency',
      control: 'knob',
      ...range('filter', 'frequency'),
      step: 10,
      defaultValue: 800,
      formatValue: hz,
      description: 'Centre frequency. Sets where the effect is focused.',
    },
    {
      key: 'q',
      label: 'Q',
      control: 'knob',
      ...range('filter', 'q'),
      step: 0.1,
      defaultValue: 2,
      formatValue: plain,
      description: 'Resonance/Q. Higher = narrower, more ringing.',
    },
    {
      key: 'drive',
      label: 'Drive',
      control: 'knob',
      ...range('filter', 'drive'),
      step: 0.01,
      defaultValue: 0,
      formatValue: percent,
      description: 'Saturation/drive. Adds grit before or inside the effect.',
    },
    {
      key: 'sensitivity',
      label: 'Sensitivity',
      control: 'knob',
      ...range('filter', 'sensitivity'),
      step: 0.01,
      defaultValue: 0.5,
      formatValue: percent,
      description: 'Sensitivity to picking dynamics. Higher = more reactive.',
    },

    {
      key: 'lfo_rate',
      label: 'LFO Rate',
      control: 'knob',
      ...range('filter', 'lfo_rate'),
      step: 0.1,
      defaultValue: 1,
      formatValue: hz,
      description: 'LFO rate for modulation.',
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
      description: 'Dry/wet blend. 0 = dry, 1 = fully wet.',
    },
    {
      key: 'mode',
      label: 'Mode',
      control: 'select',
      options: [
        { value: 'pedal', label: 'Pedal' },
        { value: 'env', label: 'Env' },
        { value: 'lfo', label: 'LFO' },
      ],
      defaultValue: 'pedal',
      description: 'Mode selector for this block.',
    },
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
      description: 'Filter type: Wah=bandpass sweep, Envelope=follower, Ladder=4-pole resonant.',
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
      description: 'Mode selector for this block.',
    },
    {
      key: 'pitch',
      label: 'Pitch',
      control: 'knob',
      ...range('pitch-shifter', 'pitch'),
      step: 1,
      defaultValue: 0,
      formatValue: plain,
      description: 'Pitch shift in semitones.',
    },
    {
      key: 'detune_cents',
      label: 'Detune',
      control: 'knob',
      ...range('pitch-shifter', 'detune_cents'),
      step: 1,
      defaultValue: 5,
      formatValue: plain,
      description: 'Fine detune in cents for doubling/chorus width.',
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
      description: 'Dry/wet blend. 0 = dry, 1 = fully wet.',
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
      description: 'Base time/delay. Sets repeat/spacing.',
    },
    {
      key: 'grain_size',
      label: 'Grain Size',
      control: 'knob',
      ...range('granular-delay', 'grain_size'),
      step: 5,
      defaultValue: 80,
      formatValue: msRaw,
      description: 'Grain window length. Small = grainy, large = smooth.',
    },
    {
      key: 'density',
      label: 'Density',
      control: 'knob',
      ...range('granular-delay', 'density'),
      step: 1,
      defaultValue: 8,
      formatValue: hz,
      description: 'Grains per second. Higher = denser cloud.',
    },
    {
      key: 'pitch',
      label: 'Pitch',
      control: 'knob',
      ...range('granular-delay', 'pitch'),
      step: 1,
      defaultValue: 0,
      formatValue: plain,
      description: 'Pitch shift in semitones.',
    },
    {
      key: 'jitter',
      label: 'Jitter',
      control: 'knob',
      ...range('granular-delay', 'jitter'),
      step: 0.01,
      defaultValue: 0.2,
      formatValue: percent,
      description: 'Random scatter between grains. 0 = tight, 1 = loose.',
    },
    {
      key: 'feedback',
      label: 'Feedback',
      control: 'knob',
      ...range('granular-delay', 'feedback'),
      step: 0.01,
      defaultValue: 0.3,
      formatValue: percent,
      description: 'Regeneration around the effect. Adds thickness or resonance.',
    },
    {
      key: 'spread',
      label: 'Spread',
      control: 'knob',
      ...range('granular-delay', 'spread'),
      step: 0.01,
      defaultValue: 0.5,
      formatValue: percent,
      description: 'Stereo spread of grains/repeats.',
    },
    {
      key: 'character',
      label: 'Character',
      control: 'knob',
      ...range('granular-delay', 'character'),
      step: 0.01,
      defaultValue: 0,
      formatValue: percent,
      description: 'Tone/character model. Changes saturation and response.',
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
      description: 'Freeze when On: loops current buffer infinitely.',
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
      description: 'Dry/wet blend. 0 = dry, 1 = fully wet.',
    },
  ],
  rotary: [
    {
      key: 'drive',
      label: 'Drive',
      control: 'knob',
      ...range('rotary', 'drive'),
      step: 0.01,
      defaultValue: 0.2,
      formatValue: percent,
      description: 'Saturation/drive. Adds grit before or inside the effect.',
    },
    {
      key: 'horn_level',
      label: 'Horn',
      control: 'knob',
      ...range('rotary', 'horn_level'),
      step: 0.01,
      defaultValue: 0.7,
      formatValue: percent,
      description: 'Horn (high rotor) level. Balances shimmer.',
    },
    {
      key: 'drum_level',
      label: 'Drum',
      control: 'knob',
      ...range('rotary', 'drum_level'),
      step: 0.01,
      defaultValue: 0.7,
      formatValue: percent,
      description: 'Drum (low rotor) level. More = more throb.',
    },
    {
      key: 'mic_distance',
      label: 'Mic',
      control: 'knob',
      ...range('rotary', 'mic_distance'),
      step: 0.01,
      defaultValue: 0.3,
      formatValue: percent,
      description: 'Virtual mic distance. Close = bright/wide, far = darker/narrower.',
    },
    {
      key: 'crossover',
      label: 'Crossover',
      control: 'knob',
      ...range('rotary', 'crossover'),
      step: 10,
      defaultValue: 800,
      formatValue: hz,
      description: 'Crossover frequency splitting high vs low rotors.',
    },
    {
      key: 'velocity',
      label: 'Velocity',
      control: 'knob',
      ...range('rotary', 'velocity'),
      step: 0.01,
      defaultValue: 0.5,
      formatValue: percent,
      description:
        'Fine trim on the selected speed: 50% is the mode\u2019s canonical rate, 0% half, 100% double. Stop stays stopped.',
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
      description: 'Dry/wet blend. 0 = dry, 1 = fully wet.',
    },
    {
      key: 'speed',
      label: 'Type',
      control: 'select',
      options: [
        { value: 'stop', label: 'Stop' },
        { value: 'chorale', label: 'Chorale' },
        { value: 'tremolo', label: 'Tremolo' },
      ],
      defaultValue: 'chorale',
      description:
        'Speed selector, like a type: Stop=braked, Chorale=slow, Tremolo=fast, with ramped acceleration.',
    },
  ],
  // 3 character models: Digital (clean), Analog (BBD-style filtering +
  // saturation), Tape (Analog + wow/flutter pitch modulation).
  delay: [
    {
      key: 'time',
      label: 'Time',
      control: 'knob',
      ...range('delay', 'time'),
      step: 5,
      defaultValue: 300,
      formatValue: msRaw,
      description: 'Base time/delay. Sets repeat/spacing.',
    },
    {
      key: 'feedback',
      label: 'Feedback',
      control: 'knob',
      ...range('delay', 'feedback'),
      step: 0.01,
      defaultValue: 0.4,
      formatValue: percent,
      description: 'Regeneration around the effect. Adds thickness or resonance.',
    },
    {
      key: 'tone',
      label: 'Tone',
      control: 'knob',
      ...range('delay', 'tone'),
      step: 50,
      defaultValue: 6000,
      formatValue: hz,
      description: 'Low-pass tone on repeats. Lower = darker decay.',
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
      description: 'Tape wow depth (Tape model). Adds pitch wobble.',
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
      description: 'Tape wow rate. Speed of wobble.',
    },

    {
      key: 'width',
      label: 'Width',
      control: 'knob',
      ...range('delay', 'width'),
      step: 0.01,
      defaultValue: 1,
      formatValue: percent,
      visible: (v) => v.stereo_mode === 'ping-pong',
      description: 'Stereo width. Only meaningful in Ping-Pong mode.',
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
      description: 'Dry/wet blend. 0 = dry, 1 = fully wet.',
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
      description: 'Output level trim after the effect.',
    },

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
    },
    {
      // stereo_mode is a select in the UI over a plain numeric core param
      // (0 = Stereo, 1 = Ping-Pong), like model above. It is deliberately
      // independent of model, so any character can ping-pong (#314).
      key: 'stereo_mode',
      label: 'Mode',
      control: 'select',
      options: [
        { value: 'stereo', label: 'Stereo' },
        { value: 'ping-pong', label: 'Ping-Pong' },
      ],
      defaultValue: 'stereo',
    },
  ],
  // Four permissive reverb algorithms (packages/core, issue #372): Hall, Room, Plate,
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
      key: 'roomSize',
      label: 'Size',
      control: 'knob',
      min: 0,
      max: 0.97,
      step: 0.01,
      defaultValue: 0.84,
      formatValue: percent,
      visible: (v) => v.reverbAlgorithm !== 'early-reflections',
      description: 'Virtual room size. Larger = longer decay (per-algorithm).',
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
      description: 'High-frequency damping. Higher = darker, less ring.',
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
      description: 'Stereo width of the reverb field. 100% = as recorded, higher = wider.',
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
      description: 'Pre-delay before reverb onset. Separates dry from wet.',
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
      visible: (v) =>
        v.reverbAlgorithm === 'hall' ||
        v.reverbAlgorithm === 'room' ||
        v.reverbAlgorithm === 'spring',
      description: 'Spin modulation in late field. More = animated diffusion.',
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
      visible: (v) =>
        v.reverbAlgorithm === 'hall' ||
        v.reverbAlgorithm === 'room' ||
        v.reverbAlgorithm === 'spring',
      description: 'Wander time modulation. More = lusher movement.',
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
      description: 'Send from early reflections into late field. Controls build-up.',
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
      description: 'Dry signal preserved. 0 lets engine handle blend.',
    },
    {
      key: 'reverbAlgorithm',
      label: 'Algorithm',
      control: 'select',
      options: [
        { value: 'hall', label: 'Hall' },
        { value: 'room', label: 'Room' },
        { value: 'plate', label: 'Plate' },
        { value: 'early-reflections', label: 'Early Reflections' },
        { value: 'spring', label: 'Spring' },
      ],
      defaultValue: 'hall',
      description:
        'Reverb character: Hall=large diffuse, Room=tighter, Plate=dense, Early=reflections only, Spring=boingy tank.',
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
    description: 'Low shelf after NAM. ±12 dB.',
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
    description: 'Mid peak after NAM.',
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
    description: 'High shelf after NAM.',
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
    description: 'Presence after NAM. High-mid sheen.',
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
    formatValue: trimDb,
    group: 'I/O',
    description: 'Block input trim into model/effect.',
  },
  {
    key: 'output_level',
    label: 'Output',
    control: 'knob',
    min: 0,
    max: 1.5,
    step: 0.01,
    defaultValue: 1,
    formatValue: trimDb,
    group: 'I/O',
    description: 'Block output trim to next block.',
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
    {
      // Post-IR high-pass (lowCut -> low_cut) and low-pass (highCut ->
      // high_cut) shaping the wet signal before the dry blend (issue #373).
      key: 'lowCut',
      label: 'Low Cut',
      control: 'knob',
      ...range('cab', 'low_cut'),
      step: 5,
      defaultValue: 20,
      formatValue: hz,
      description: 'High-pass on the IR output. Trims boom and handling noise.',
    },
    {
      key: 'highCut',
      label: 'High Cut',
      control: 'knob',
      ...range('cab', 'high_cut'),
      step: 50,
      defaultValue: 20000,
      formatValue: hz,
      description: 'Low-pass on the IR output. Trims fizz and harsh highs.',
    },
    ...IN_OUT_LEVEL_FIELDS,
  ],
  mixer: Array.from({ length: MIXER_INPUT_COUNT }, (_, i) => {
    const group = `In ${i + 1}`
    const fields: KnobField[] = [
      {
        key: `in${i}_level`,
        description: 'Mixer input level.',
        label: `Level ${i + 1}`,
        control: 'knob',
        ...range('mixer', `in${i}_level`),
        step: 0.01,
        defaultValue: 1,
        formatValue: percent,
        group,
      },
      {
        key: `in${i}_pan`,
        description: 'Mixer input pan.',
        label: `Pan ${i + 1}`,
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
}

/** Raw reverb params for an algorithm variant, from generated ranges (issue #263 expert mode). */
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

/**
 * The Mixer's per-input knobs, resolved against the live graph (issue #428).
 *
 * A mixer input with a connected source block is labelled by that block
 * (`Delay Volume` / `Delay Pan`) instead of the static `Level N` / `Pan N`.
 * Send/Return relays label by the pair (`Send 1`), not their `return-*` kind.
 * Inputs with no cable stay on their numbered labels and render disabled. An
 * input fed by the IN rail keeps its numbered label but stays enabled.
 */
export function getMixerParamSchema(
  blockId: string,
  blocks: BlockInstance[],
  edges: EdgeInstance[],
): ParamFieldSchema[] {
  const base = getParamSchema('mixer') as KnobField[]
  return base.map((field) => {
    const match = /^in(\d+)_(level|pan)$/.exec(field.key)
    if (!match) return field
    const port = Number(match[1])
    const edge = edges.find((e) => e.to.blockId === blockId && e.to.port === port)
    if (!edge) return { ...field, disabled: true }
    const source = blocks.find((b) => b.id === edge.from.blockId)
    if (!source) return { ...field, disabled: false }
    const labelKind = sendReturnPairOf(source.kind) ?? source.kind
    const sourceLabel = BLOCK_KIND_LABELS[labelKind]
    const noun = match[2] === 'level' ? 'Volume' : 'Pan'
    return { ...field, label: `${sourceLabel} ${noun}`, disabled: false }
  })
}
