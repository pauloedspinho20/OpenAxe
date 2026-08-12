import type { UseBoundStore, StoreApi } from 'zustand'
import type { DualChainState } from '../state/dualChainStore'
import type { ChainId } from '../engine/DualChainRig'
import type {
  ChainPresetData,
  EffectPresetData,
  Preset,
  PresetEffectsChain,
  PresetRig,
} from './types'

function captureEffectsChain(chain: PresetEffectsChain): EffectPresetData[] {
  return chain.list().map((effect) => ({
    kind: effect.kind,
    bypass: effect.isBypassed(),
    mix: effect.getMix(),
    params: effect.getParams(),
  }))
}

function captureChain(chainId: ChainId, rig: PresetRig, state: DualChainState): ChainPresetData {
  const amp = rig.amp(chainId)
  const strip = chainId === 'A' ? state.chainA : state.chainB
  const model = amp.getLoadedModel()
  const ir = amp.getLoadedIr()

  return {
    modelId: model?.id ?? null,
    modelName: model?.name ?? null,
    irId: ir?.id ?? null,
    irName: ir?.name ?? null,
    irMix: amp.getIrMix(),
    level: strip.level,
    pan: strip.pan,
    mute: strip.mute,
    solo: strip.solo,
    preFx: captureEffectsChain(rig.preFx(chainId)),
    postFx: captureEffectsChain(rig.postFx(chainId)),
  }
}

export interface CapturePresetMeta {
  tags?: string[]
  favorite?: boolean
  /** Preserve the original creation time when re-saving an existing preset; omit for a new one. */
  createdAt?: number
}

/** Snapshot the rig's and store's current state into a Preset, ready to save. */
export function capturePreset(
  id: string,
  name: string,
  rig: PresetRig,
  store: UseBoundStore<StoreApi<DualChainState>>,
  meta: CapturePresetMeta = {},
): Preset {
  const state = store.getState()
  const now = Date.now()
  return {
    id,
    name,
    tags: meta.tags ?? [],
    favorite: meta.favorite ?? false,
    createdAt: meta.createdAt ?? now,
    updatedAt: now,
    chainA: captureChain('A', rig, state),
    chainB: captureChain('B', rig, state),
    masterLevel: state.masterLevel,
    linked: state.linked,
  }
}
