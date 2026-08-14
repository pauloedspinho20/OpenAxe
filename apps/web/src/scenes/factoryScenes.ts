/**
 * Seeds the default scene bank: scene 0 ("Default") gets 8 starter presets,
 * one per slot, so the app boots ready-to-play instead of empty - the user
 * will overwrite these as they build their own scenes. Mirrors
 * factoryPresets.ts's idempotent-seeding pattern exactly.
 */
import { getPreset, savePreset } from '../presets/presetStore'
import {
  buildFactoryPreset,
  chorus,
  compressor,
  eq,
  reverb,
  tapeDelay,
} from '../presets/factoryPresets'
import type { Preset } from '../presets/types'
import { createEmptyBank, loadSceneBank, saveSceneBank } from './sceneBankStore'

export const DEFAULT_SCENE_NAME = 'Default'

/** Deterministic id for scene 0's slot `slot` (0-7) - stable across re-seeds. */
export function starterPresetId(slot: number): string {
  return `scene-starter-${slot + 1}`
}

export const STARTER_PRESETS: readonly Preset[] = [
  buildFactoryPreset(starterPresetId(0), 'Clean', [[compressor(), eq()]]),
  buildFactoryPreset(starterPresetId(1), 'Crunch', [[compressor()]]),
  buildFactoryPreset(starterPresetId(2), 'Lead', [[compressor(), tapeDelay()]]),
  buildFactoryPreset(starterPresetId(3), 'Chorus', [[chorus()]]),
  buildFactoryPreset(starterPresetId(4), 'Ambient', [[chorus(), reverb(0.7)]]),
  buildFactoryPreset(starterPresetId(5), 'Slapback', [[tapeDelay()]]),
  buildFactoryPreset(starterPresetId(6), 'Hall', [[reverb(0.85)]]),
  buildFactoryPreset(starterPresetId(7), 'Bypass', [[]]),
]

/**
 * Idempotent in two independent halves: seeding the starter presets never
 * overwrites a user-customized one (matched by id), and the initial bank is
 * only ever written once - if a bank already exists (even partially
 * customized), it's never touched.
 */
export async function installFactoryScenes(): Promise<void> {
  for (const preset of STARTER_PRESETS) {
    const existing = await getPreset(preset.id)
    if (!existing) await savePreset(preset)
  }

  if (await loadSceneBank()) return

  const bank = createEmptyBank()
  bank.scenes[0] = {
    index: 0,
    name: DEFAULT_SCENE_NAME,
    slots: STARTER_PRESETS.map((p) => p.id),
  }
  bank.activeScene = 0
  bank.activeSlot = 0
  bank.updatedAt = 0
  await saveSceneBank(bank)
}
