/**
 * The FX-only starter pack definitions. We don't bundle any third-party
 * .nam/IR files (see factoryPresets.ts's licensing note), so these are
 * purely built-in effect chains. The first-run factory dialog
 * (factory/factorySetup.ts) places them into the preset bank as the offline
 * fallback; the curated Tone3000 pack is the online alternative.
 */
import {
  buildFactoryPreset,
  chorus,
  compressor,
  eq,
  reverb,
  tapeDelay,
} from '../presets/factoryPresets'
import type { Preset } from '../presets/types'

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
