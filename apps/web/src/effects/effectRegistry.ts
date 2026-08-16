import type { Effect, EffectKind, EffectParams } from './Effect'
import { NoiseGate } from './NoiseGate'
import { Compressor } from './Compressor'
import { ParametricEQ } from './ParametricEQ'
import { Chorus } from './Chorus'
import { Flanger } from './Flanger'
import { Phaser } from './Phaser'
import { Tremolo } from './Tremolo'
import { Delay } from './Delay'
import { PingPongDelay } from './PingPongDelay'
import { DragonflyReverb } from './DragonflyReverb'
import { Drive } from './Drive'

/**
 * Builds an effect from its serialized `kind` (+ optional saved params),
 * for restoring a preset without the caller needing a big switch statement
 * of its own. Every WASM-backed effect kind (NoiseGate, Compressor, EQ,
 * Chorus, ...) has an async constructor that fetches and instantiates the
 * packages/core module, hence this function being async across the board.
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
  _params: EffectParams | undefined,
): Promise<Effect> {
  switch (kind) {
    case 'noise-gate':
      return NoiseGate.create(context)
    case 'compressor':
      return Compressor.create(context)
    case 'eq':
      return ParametricEQ.create(context)
    case 'chorus':
      return Chorus.create(context)
    case 'flanger':
      return Flanger.create(context)
    case 'phaser':
      return Phaser.create(context)
    case 'tremolo':
      return Tremolo.create(context)
    case 'delay':
      return Delay.create(context)
    case 'ping-pong-delay':
      return PingPongDelay.create(context)
    case 'reverb':
      return DragonflyReverb.create(context)
    case 'drive':
      return Drive.create(context)
  }
}
