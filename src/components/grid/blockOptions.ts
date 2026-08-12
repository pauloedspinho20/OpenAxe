import type { BlockKind } from '../../engine/blocks/Block'

export interface BlockOption {
  kind: BlockKind
  label: string
  group: 'Core' | 'Effects'
}

/** Canonical list of every placeable block kind - the single source AddBlockMenu, BlockPalette, and BlockCard's labels all read from. */
export const BLOCK_OPTIONS: BlockOption[] = [
  { kind: 'amp', label: 'Amp', group: 'Core' },
  { kind: 'cab', label: 'Cab', group: 'Core' },
  { kind: 'tone-stack', label: 'Tone Stack', group: 'Core' },
  { kind: 'mixer', label: 'Mixer', group: 'Core' },
  { kind: 'noise-gate', label: 'Noise Gate', group: 'Effects' },
  { kind: 'compressor', label: 'Compressor', group: 'Effects' },
  { kind: 'eq', label: 'EQ', group: 'Effects' },
  { kind: 'drive', label: 'Drive', group: 'Effects' },
  { kind: 'chorus', label: 'Chorus', group: 'Effects' },
  { kind: 'flanger', label: 'Flanger', group: 'Effects' },
  { kind: 'phaser', label: 'Phaser', group: 'Effects' },
  { kind: 'tremolo', label: 'Tremolo', group: 'Effects' },
  { kind: 'delay', label: 'Delay', group: 'Effects' },
  { kind: 'ping-pong-delay', label: 'Ping-Pong Delay', group: 'Effects' },
  { kind: 'reverb', label: 'Reverb', group: 'Effects' },
]

export const BLOCK_KIND_LABELS: Record<BlockKind, string> = Object.fromEntries(
  BLOCK_OPTIONS.map((o) => [o.kind, o.label]),
) as Record<BlockKind, string>
