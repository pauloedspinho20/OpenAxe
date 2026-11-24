/**
 * The audio features every visual scene can react to. Each is a number in
 * 0..1 so any feature can drive any param through the same modulation maths
 * (see ../modulation.ts); a few raw descriptors (Hz, MIDI note, dB) ride
 * along for scenes or meters that want them.
 */

export type FeatureGroup = 'volume' | 'pitch' | 'timbre'

export interface FeatureInfo {
  readonly id: FeatureId
  readonly label: string
  readonly group: FeatureGroup
  readonly description: string
  /** Wraps around at 1 (a colour wheel): smoothed along the shortest arc, never swept back through 0.5. */
  readonly cyclic?: boolean
  /** Short-lived impulse rather than a level: rises instantly, decays. */
  readonly impulse?: boolean
}

export const FEATURE_IDS = [
  'volume',
  'sustain',
  'activity',
  'onset',
  'pitchClass',
  'register',
  'vibrato',
  'bend',
  'noteChange',
  'brightness',
  'grit',
  'bandLow',
  'bandLowMid',
  'bandHighMid',
  'bandHigh',
] as const

export type FeatureId = (typeof FEATURE_IDS)[number]

export const FEATURES: readonly FeatureInfo[] = [
  {
    id: 'volume',
    label: 'Volume',
    group: 'volume',
    description: 'Loudness, auto-ranged to how loud you have been playing lately.',
  },
  {
    id: 'sustain',
    label: 'Sustain',
    group: 'volume',
    description: 'Slow loudness envelope: high while notes ring, low on short stabs.',
  },
  {
    id: 'activity',
    label: 'Activity',
    group: 'volume',
    description: '1 while playing, easing to 0 a second or two after you stop.',
  },
  {
    id: 'onset',
    label: 'Attack',
    group: 'timbre',
    description: 'Impulse on every pick attack, strum or chug (spectral flux).',
    impulse: true,
  },
  {
    id: 'pitchClass',
    label: 'Note',
    group: 'pitch',
    description: 'The detected note on a 12-step wheel (C = 0). Same note, same value, any octave.',
    cyclic: true,
  },
  {
    id: 'register',
    label: 'Register',
    group: 'pitch',
    description: 'How high you are playing: low E2 = 0, C6 = 1.',
  },
  {
    id: 'vibrato',
    label: 'Vibrato',
    group: 'pitch',
    description: 'Depth of fast pitch wobble (finger vibrato, whammy shimmer).',
  },
  {
    id: 'bend',
    label: 'Bend',
    group: 'pitch',
    description: 'How far the pitch has been bent from the note you started on (a whole step = 1).',
  },
  {
    id: 'noteChange',
    label: 'Note change',
    group: 'pitch',
    description: 'Impulse when a new note starts, even on legato playing without picking.',
    impulse: true,
  },
  {
    id: 'brightness',
    label: 'Brightness',
    group: 'timbre',
    description: 'Spectral centroid: tone knob, bridge vs neck pickup, clean vs lead.',
  },
  {
    id: 'grit',
    label: 'Grit',
    group: 'timbre',
    description: 'Spectral flatness: distortion fizz and noise vs a pure clean tone.',
  },
  { id: 'bandLow', label: 'Lows', group: 'timbre', description: '40-250 Hz energy, auto-ranged.' },
  {
    id: 'bandLowMid',
    label: 'Low mids',
    group: 'timbre',
    description: '250 Hz-1 kHz energy (the guitar body), auto-ranged.',
  },
  {
    id: 'bandHighMid',
    label: 'High mids',
    group: 'timbre',
    description: '1-4 kHz energy (bite, presence), auto-ranged.',
  },
  {
    id: 'bandHigh',
    label: 'Highs',
    group: 'timbre',
    description: '4-12 kHz energy (pick noise, fizz, air), auto-ranged.',
  },
]

export const FEATURE_BY_ID: Readonly<Record<FeatureId, FeatureInfo>> = Object.fromEntries(
  FEATURES.map((f) => [f.id, f]),
) as Record<FeatureId, FeatureInfo>

export interface AudioFeatures extends Record<FeatureId, number> {
  /** Detected fundamental in Hz, 0 when there is no confident pitch. */
  hz: number
  /** Current note as a MIDI number, -1 when silent/unpitched. */
  note: number
  /** Deviation from the nearest semitone, -50..50. */
  cents: number
  /** Loudness of the analysed signal in dBFS. */
  levelDb: number
  /** Spectral centroid in Hz. */
  centroidHz: number
}

export function emptyFeatures(): AudioFeatures {
  const f = Object.fromEntries(FEATURE_IDS.map((id) => [id, 0])) as Record<FeatureId, number>
  return { ...f, register: 0.4, hz: 0, note: -1, cents: 0, levelDb: -120, centroidHz: 0 }
}
