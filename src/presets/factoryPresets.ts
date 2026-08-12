/**
 * Bundled starter presets. FX-chain-only (no modelId/irId) - we don't bundle
 * any third-party .nam/IR files (see the effects suite's licensing note for
 * the same reasoning applied to sample audio content instead of code), so a
 * factory pack that recommends specific amp models isn't possible yet. Once
 * Tone3000 integration exists, presets that also reference a specific model
 * become a reasonable addition alongside these.
 */
import { getPreset, savePreset } from './presetStore'
import type { ChainPresetData, EffectPresetData, Preset } from './types'

function drive(overrides: Partial<EffectPresetData['params']> = {}): EffectPresetData {
  return {
    kind: 'drive',
    bypass: false,
    mix: 1,
    params: { type: 'overdrive', drive: 0.4, tone: 8000, level: 0.7, ...overrides },
  }
}

function compressor(): EffectPresetData {
  return {
    kind: 'compressor',
    bypass: false,
    mix: 1,
    params: { threshold: -24, knee: 6, ratio: 3, attack: 0.01, release: 0.2 },
  }
}

function eq(): EffectPresetData {
  return {
    kind: 'eq',
    bypass: false,
    mix: 1,
    params: {
      bandCount: 4,
      band0_frequency: 100,
      band0_gain: 0,
      band0_q: 1,
      band1_frequency: 500,
      band1_gain: 0,
      band1_q: 1,
      band2_frequency: 2000,
      band2_gain: 2,
      band2_q: 1,
      band3_frequency: 6000,
      band3_gain: 1,
      band3_q: 1,
    },
  }
}

function chorus(): EffectPresetData {
  return {
    kind: 'chorus',
    bypass: false,
    mix: 0.5,
    params: { rate: 1.2, depth: 4, feedback: 0.15 },
  }
}

function tapeDelay(): EffectPresetData {
  return {
    kind: 'delay',
    bypass: false,
    mix: 0.35,
    params: { character: 'tape', time: 0.35, feedback: 0.35, tone: 3500 },
  }
}

function reverb(roomSize: number): EffectPresetData {
  return { kind: 'reverb', bypass: false, mix: 0.3, params: { roomSize, damping: 0.5 } }
}

function chain(
  pan: number,
  preFx: EffectPresetData[],
  postFx: EffectPresetData[],
): ChainPresetData {
  return {
    modelId: null,
    modelName: null,
    irId: null,
    irName: null,
    irMix: 1,
    level: 1,
    pan,
    mute: false,
    solo: false,
    preFx,
    postFx,
  }
}

function factoryPreset(
  id: string,
  name: string,
  chainA: ChainPresetData,
  chainB: ChainPresetData,
): Preset {
  return {
    id,
    name,
    tags: ['factory'],
    favorite: false,
    createdAt: 0,
    updatedAt: 0,
    chainA,
    chainB,
    masterLevel: 1,
    linked: true,
  }
}

export const FACTORY_PRESETS: readonly Preset[] = [
  factoryPreset(
    'factory-clean-boost',
    'Clean Boost',
    chain(-1, [compressor()], [eq()]),
    chain(1, [compressor()], [eq()]),
  ),
  factoryPreset(
    'factory-bedroom-overdrive',
    'Bedroom Overdrive',
    chain(-1, [drive()], [tapeDelay()]),
    chain(1, [drive({ drive: 0.3 })], []),
  ),
  factoryPreset(
    'factory-ambient-swell',
    'Ambient Swell',
    chain(-1, [], [chorus(), reverb(0.7)]),
    chain(1, [], [tapeDelay(), reverb(0.7)]),
  ),
]

/**
 * Save every factory preset that isn't already saved (by id) - never
 * overwrites a user's edits to a factory preset they've customized.
 */
export async function installFactoryPresets(): Promise<void> {
  for (const preset of FACTORY_PRESETS) {
    const existing = await getPreset(preset.id)
    if (!existing) await savePreset(preset)
  }
}
