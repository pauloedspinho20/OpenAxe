// GENERATED FILE - do not edit by hand.
// Produced by scripts/gen-param-schema.mjs --target=effects from packages/core/effects.config.json.
//
// The palette and the block registry read these instead of hardcoding which
// kinds exist. COMPILED_BLOCK_KINDS is asserted against the running core at
// startup (see RigWorkletNode) so a stale prebuilt WASM cannot silently
// disagree with this file.
import type { BlockKind } from '../engine/blocks/Block'

/** Kinds whose DSP is in this build. The core refuses to construct any other. */
export const COMPILED_BLOCK_KINDS: ReadonlySet<BlockKind> = new Set<BlockKind>([
  'noise-gate',
  'compressor',
  'eq',
  'chorus',
  'flanger',
  'phaser',
  'tremolo',
  'delay',
  'reverb',
  'rotary',
  'amp',
  'amp-cab',
  'pedal',
  'outboard',
  'space',
  'cab',
  'mixer',
  'send-1',
  'return-1',
  'send-2',
  'return-2',
])

/** Kinds the block palette offers. Always a subset of COMPILED_BLOCK_KINDS. */
export const PALETTE_BLOCK_KINDS: ReadonlySet<BlockKind> = new Set<BlockKind>([
  'noise-gate',
  'compressor',
  'eq',
  'chorus',
  'flanger',
  'phaser',
  'tremolo',
  'delay',
  'reverb',
  'rotary',
  'amp',
  'amp-cab',
  'pedal',
  'space',
  'cab',
  'mixer',
  'send-1',
  'return-1',
  'send-2',
  'return-2',
])
