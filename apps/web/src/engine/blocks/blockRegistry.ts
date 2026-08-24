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
  'ring-mod',
  'filter',
  'pitch-shifter',
  'granular-delay',
  'rotary',
])

/** Every gear kind that's a NAM model capture rather than an IR - see CabBlock/AmpBlock's doc comments. */
export const NAM_MODEL_KINDS = new Set<BlockKind>(['amp', 'amp-cab', 'pedal', 'outboard', 'space'])

/**
 * The Send/Return routing relays (issue #274): Send N is input-only and hops
 * implicitly to its paired Return N - output-only - with no cable between
 * them. They have no params, bypass or asset; both relay their single jack
 * straight through. The pairing is strictly 1:1 (at most one of each kind may
 * be placed), enforced at add time.
 */
export const SEND_RETURN_KINDS = new Set<BlockKind>(['send-1', 'return-1', 'send-2', 'return-2'])

/** The other half of a send/return pair, or undefined. */
export function sendReturnPairOf(kind: BlockKind): BlockKind | undefined {
  switch (kind) {
    case 'send-1':
      return 'return-1'
    case 'return-1':
      return 'send-1'
    case 'send-2':
      return 'return-2'
    case 'return-2':
      return 'send-2'
    default:
      return undefined
  }
}
