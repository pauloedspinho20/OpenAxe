import type { BlockKind } from './Block'

export const EFFECT_KINDS = new Set<BlockKind>([
  'noise-gate',
  'compressor',
  'eq',
  'chorus',
  'flanger',
  'phaser',
  'tremolo',
  'delay',
  'ping-pong-delay',
  'reverb',
])

/** Every gear kind that's a NAM model capture rather than an IR - see CabBlock/AmpBlock's doc comments. */
export const NAM_MODEL_KINDS = new Set<BlockKind>(['amp', 'amp-cab', 'pedal', 'outboard', 'space'])
