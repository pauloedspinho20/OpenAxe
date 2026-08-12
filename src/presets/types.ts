import type { Effect, EffectKind, EffectParams } from '../effects/Effect'

export interface EffectPresetData {
  kind: EffectKind
  bypass: boolean
  mix: number
  params: EffectParams
}

export interface ChainPresetData {
  /** References into the local asset cache (see assetCache.ts) - null if no model/IR is loaded. */
  modelId: string | null
  modelName: string | null
  irId: string | null
  irName: string | null
  irMix: number
  level: number
  pan: number
  mute: boolean
  solo: boolean
  preFx: EffectPresetData[]
  postFx: EffectPresetData[]
}

export interface Preset {
  id: string
  name: string
  tags: string[]
  favorite: boolean
  createdAt: number
  updatedAt: number
  chainA: ChainPresetData
  chainB: ChainPresetData
  masterLevel: number
  linked: boolean
}

/**
 * The narrow slice of AmpCabChain that capture/apply need. Declared
 * separately (rather than importing AmpCabChain directly) so tests can pass
 * a plain mock instead of standing up a real AudioContext + wasm engine -
 * same reasoning as bindDualChainRig's DualChainRigControls.
 */
export interface PresetAmpChain {
  getLoadedModel(): { id: string; name: string } | null
  getLoadedIr(): { id: string; name: string } | null
  getIrMix(): number
  loadModel(json: string, slimSize?: number, info?: { id: string; name: string }): Promise<unknown>
  unloadModel(): Promise<void>
  loadIR(audioBuffer: AudioBuffer, mix?: number, info?: { id: string; name: string }): void
  clearIR(): void
}

/** The narrow slice of EffectsChain that capture/apply need. */
export interface PresetEffectsChain {
  list(): readonly Effect[]
  insert(effect: Effect, index?: number): void
  remove(effect: Effect): void
}

/** The narrow slice of DualChainRig that capture/apply need. */
export interface PresetRig {
  amp(chain: 'A' | 'B'): PresetAmpChain
  preFx(chain: 'A' | 'B'): PresetEffectsChain
  postFx(chain: 'A' | 'B'): PresetEffectsChain
}
