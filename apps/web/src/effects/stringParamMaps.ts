/**
 * Shared web-string → core-numeric map for the enum/select params that exist
 * on the Phase-2 effects (issue #268) and tremolo. Both block facades
 * (RigBlock, NativeBlock) must send identical numbers for the same UI string,
 * so this is one module keyed by kind instead of two hand-rolled copies that
 * can drift apart. Returns `undefined` when the key isn't an enum select this
 * module owns (the caller then skips the param rather than pushing a silent 0
 * the core would misread as "first enum value").
 */
import type { BlockKind } from '../engine/blocks/Block'

const STEREO_MAP: Record<string, number> = { mono: 0, stereo: 1 }
const FILTER_TYPE_MAP: Record<string, number> = { wah: 0, envelope: 1, ladder: 2 }
const FREEZE_MAP: Record<string, number> = { off: 0, on: 1 }
const SPEED_MAP: Record<string, number> = { stop: 0, chorale: 1, tremolo: 2 }
const SHAPE_MAP: Record<string, number> = { sine: 0, triangle: 1, square: 2 }
// Delay's ping-pong routing (#314) - orthogonal to its `model` character.
const STEREO_MODE_MAP: Record<string, number> = { stereo: 0, 'ping-pong': 1 }
// Phaser's Script switch (#317) - the EVH pedal's Script/Block voices.
const SCRIPT_MAP: Record<string, number> = { script: 1, block: 0 }
const CHARACTER_MAP: Record<string, number> = { clean: 0, opto: 1, fet: 2, varimu: 3 }

// `mode` is shared by three kinds with different enums, so it keys off kind.
const MODE_MAP: Record<string, Record<string, number>> = {
  tremolo: { normal: 0, harmonic: 1 },
  filter: { pedal: 0, env: 1, lfo: 2 },
  'pitch-shifter': { detune: 0, whammy: 1 },
}

/** Map a UI string value to the core's numeric enum, or undefined if not one. */
export function mapStringParam(kind: BlockKind, key: string, value: string): number | undefined {
  switch (key) {
    case 'stereo':
      return STEREO_MAP[value]
    case 'type':
      return FILTER_TYPE_MAP[value]
    case 'freeze':
      return FREEZE_MAP[value]
    case 'speed':
      return SPEED_MAP[value]
    case 'shape':
      return SHAPE_MAP[value]
    case 'stereo_mode':
      return STEREO_MODE_MAP[value]
    case 'script':
      return SCRIPT_MAP[value]
    case 'character':
      return CHARACTER_MAP[value]
    case 'mode':
      return MODE_MAP[kind]?.[value]
    default:
      return undefined
  }
}
