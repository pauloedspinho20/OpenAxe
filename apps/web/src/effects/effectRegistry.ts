import type { Effect, EffectKind, EffectParams } from './Effect'
import { NoiseGate } from './NoiseGate'
import { Compressor } from './Compressor'
import { ParametricEQ } from './ParametricEQ'
import { Chorus } from './Chorus'
import { Flanger } from './Flanger'
import { Phaser } from './Phaser'
import { Tremolo } from './Tremolo'
import { Delay, type DelayCharacter } from './Delay'
import { PingPongDelay } from './PingPongDelay'
import { DragonflyReverb } from './DragonflyReverb'

/**
 * Builds an effect from its serialized `kind` (+ optional saved params),
 * for restoring a preset without the caller needing a big switch statement
 * of its own. NoiseGate is the only kind with an async constructor, hence
 * this function being async across the board.
 */
export async function createEffect(
  context: AudioContext,
  kind: EffectKind,
  params?: EffectParams,
): Promise<Effect> {
  const effect = await buildEffect(context, kind, params)
  if (params) effect.setParams(params)
  return effect
}

async function buildEffect(
  context: AudioContext,
  kind: EffectKind,
  params: EffectParams | undefined,
): Promise<Effect> {
  switch (kind) {
    case 'noise-gate':
      return NoiseGate.create(context)
    case 'compressor':
      return new Compressor(context)
    case 'eq':
      return new ParametricEQ(context)
    case 'chorus':
      return new Chorus(context)
    case 'flanger':
      return new Flanger(context)
    case 'phaser':
      return new Phaser(context)
    case 'tremolo':
      return new Tremolo(context)
    case 'delay':
      return new Delay(context, asDelayCharacter(params?.character))
    case 'ping-pong-delay':
      return new PingPongDelay(context)
    case 'reverb':
      return DragonflyReverb.create(context)
  }
}

function asDelayCharacter(value: unknown): DelayCharacter {
  return value === 'tape' ? 'tape' : 'clean'
}
