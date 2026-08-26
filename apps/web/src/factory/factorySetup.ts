/**
 * First-run factory setup: the boot decision that decides whether the
 * scene/preset stores hydrate normally, seed the offline FX-only starter
 * pack, or leave everything unhydrated so the first-run dialog can present
 * its options (download the curated Tone3000 pack / import a backup / skip).
 *
 * "Fresh browser" is defined as "no scene bank exists yet" - once any bank
 * row is written the app treats itself as having an established session.
 */
import { getPreset, savePreset } from '../presets/presetStore'
import { FACTORY_PRESETS } from '../presets/factoryPresets'
import { createEmptyPresetBank, loadPresetBank, savePresetBank } from '../presets/presetBankStore'
import { DEFAULT_SCENE_NAME, STARTER_PRESETS } from '../scenes/factoryScenes'
import { createEmptyBank, loadSceneBank, saveSceneBank } from '../scenes/sceneBankStore'
import { SLOTS_PER_SCENE } from '../scenes/types'
import { hydratePresetBankStore } from '../state/presetBankStore'
import { hydrateSceneStore } from '../state/sceneStore'

export const FACTORY_SETUP_KEY = 'nam-web-studio:factory-setup-dismissed'

export function getFactorySetupDone(): boolean {
  if (typeof localStorage === 'undefined') return true
  return localStorage.getItem(FACTORY_SETUP_KEY) === '1'
}

export function setFactorySetupDone(): void {
  localStorage.setItem(FACTORY_SETUP_KEY, '1')
}

/** A fresh browser has no scene bank yet - the first-run factory dialog is for those only. */
export async function hasExistingSession(): Promise<boolean> {
  return (await loadSceneBank()) !== null
}

/**
 * Seeds the offline FX-only starter pack: the 8 scene-0 starters plus the 2
 * standalone factory presets; the 8 starters are placed into preset-bank
 * slots 0-7 and scene 0 references them (bank slots 0-7). Idempotent - never
 * overwrites a user-customized preset (by id) and never touches banks that
 * already exist.
 */
export async function installOfflineFactorySetup(): Promise<void> {
  for (const preset of [...STARTER_PRESETS, ...FACTORY_PRESETS]) {
    const existing = await getPreset(preset.id)
    if (!existing) await savePreset(preset)
  }

  let presetBank = await loadPresetBank()
  if (!presetBank) {
    presetBank = createEmptyPresetBank()
    STARTER_PRESETS.forEach((preset, i) => {
      presetBank!.slots[i] = preset.id
    })
    await savePresetBank(presetBank)
  }

  let sceneBank = await loadSceneBank()
  if (!sceneBank) {
    sceneBank = createEmptyBank()
    sceneBank.scenes[0] = {
      index: 0,
      name: DEFAULT_SCENE_NAME,
      slots: Array.from({ length: SLOTS_PER_SCENE }, (_, i) => i),
    }
    sceneBank.activeScene = 0
    sceneBank.activeSlot = 0
    sceneBank.updatedAt = 0
    await saveSceneBank(sceneBank)
  }
}

/**
 * Boot decision for the scene/preset stores (call once on app boot):
 * - existing session -> hydrate the saved banks;
 * - no session but setup already handled -> seed the offline FX starters, hydrate;
 * - brand-new browser, nothing chosen yet -> leave unhydrated ('pending') so the
 *   first-run factory dialog can present its options.
 */
export async function bootstrapFactorySetup(): Promise<'pending' | 'done'> {
  if (await hasExistingSession()) {
    // Preset bank first: SceneBar resolves scene slots through it, so hydrating
    // it before the scene store avoids a frame of "Empty" slot labels.
    await hydratePresetBankStore()
    await hydrateSceneStore()
    return 'done'
  }
  if (getFactorySetupDone()) {
    await installOfflineFactorySetup()
    await hydratePresetBankStore()
    await hydrateSceneStore()
    return 'done'
  }
  return 'pending'
}
