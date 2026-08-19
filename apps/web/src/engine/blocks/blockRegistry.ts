import { createEffect } from '../../effects/effectRegistry'
import type { EffectKind } from '../../effects/Effect'
import type { Block, BlockKind, EffectParams } from './Block'
import { AmpBlock, type NamModelBlockKind } from './AmpBlock'
import { CabBlock } from './CabBlock'
import { MixerBlock } from './MixerBlock'
import { SplitterBlock } from './SplitterBlock'

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

/**
 * Builds any grid block from its serialized `kind` (+ optional saved
 * params) - one factory the graph engine and preset restore both call into,
 * one level up from effectRegistry's `createEffect` (which this delegates
 * to for the 10 effect kinds).
 */
export async function createBlock(
  context: AudioContext,
  kind: BlockKind,
  params?: EffectParams,
): Promise<Block> {
  const block = await buildBlock(context, kind, params)
  if (params) block.setParams(params)
  return block
}

async function buildBlock(
  context: AudioContext,
  kind: BlockKind,
  params: EffectParams | undefined,
): Promise<Block> {
  switch (kind) {
    case 'cab':
      return CabBlock.create(context)
    case 'mixer':
      return new MixerBlock(context)
    case 'splitter':
      return new SplitterBlock(context)
    default:
      if (NAM_MODEL_KINDS.has(kind)) return AmpBlock.create(context, kind as NamModelBlockKind)
      if (EFFECT_KINDS.has(kind)) return createEffect(context, kind as EffectKind, params)
      throw new Error(`Unknown block kind: ${kind}`)
  }
}
