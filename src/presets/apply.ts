import type { UseBoundStore, StoreApi } from 'zustand'
import type { DualChainState } from '../state/dualChainStore'
import type { ChainId } from '../engine/DualChainRig'
import { getCachedAsset } from '../engine/assetCache'
import { createEffect } from '../effects/effectRegistry'
import type {
  ChainPresetData,
  Preset,
  PresetAmpChain,
  PresetEffectsChain,
  PresetRig,
} from './types'

export interface MissingAsset {
  chain: ChainId
  kind: 'model' | 'ir'
  id: string
  name: string
}

export interface ApplyPresetResult {
  /**
   * Model/IR references the preset needs but aren't in the local asset
   * cache - e.g. a preset shared by someone else, referencing a Tone3000
   * asset never downloaded on this device. Everything else in the preset
   * (levels, pans, FX chain) still gets applied; the affected chain just
   * keeps whatever model/IR it had before.
   */
  missingAssets: MissingAsset[]
}

async function rebuildEffectsChain(
  context: AudioContext,
  chain: PresetEffectsChain,
  dataList: EffectPresetDataList,
): Promise<void> {
  for (const effect of [...chain.list()]) {
    chain.remove(effect)
    await effect.dispose()
  }
  for (const data of dataList) {
    const effect = await createEffect(context, data.kind, data.params)
    effect.setBypass(data.bypass)
    effect.setMix(data.mix)
    chain.insert(effect)
  }
}

type EffectPresetDataList = ChainPresetData['preFx']

async function applyChainAssets(
  context: AudioContext,
  chainId: ChainId,
  data: ChainPresetData,
  amp: PresetAmpChain,
  missingAssets: MissingAsset[],
): Promise<void> {
  if (data.modelId) {
    const blob = await getCachedAsset(data.modelId)
    if (blob) {
      const json = await blob.text()
      await amp.loadModel(json, undefined, {
        id: data.modelId,
        name: data.modelName ?? data.modelId,
      })
    } else {
      missingAssets.push({
        chain: chainId,
        kind: 'model',
        id: data.modelId,
        name: data.modelName ?? data.modelId,
      })
    }
  } else {
    await amp.unloadModel()
  }

  if (data.irId) {
    const blob = await getCachedAsset(data.irId)
    if (blob) {
      const audioBuffer = await context.decodeAudioData(await blob.arrayBuffer())
      amp.loadIR(audioBuffer, data.irMix, { id: data.irId, name: data.irName ?? data.irId })
    } else {
      missingAssets.push({
        chain: chainId,
        kind: 'ir',
        id: data.irId,
        name: data.irName ?? data.irId,
      })
    }
  } else {
    amp.clearIR()
  }
}

async function applyChain(
  context: AudioContext,
  chainId: ChainId,
  data: ChainPresetData,
  rig: PresetRig,
  missingAssets: MissingAsset[],
): Promise<void> {
  await applyChainAssets(context, chainId, data, rig.amp(chainId), missingAssets)
  await rebuildEffectsChain(context, rig.preFx(chainId), data.preFx)
  await rebuildEffectsChain(context, rig.postFx(chainId), data.postFx)
}

/**
 * Restore a preset onto a live rig + store. Model/IR loading is best-effort
 * against the local asset cache (see MissingAsset) - restoring the actual
 * bytes from Tone3000 when they aren't cached is the Tone3000 Integration
 * epic's job, not this function's.
 */
export async function applyPreset(
  context: AudioContext,
  preset: Preset,
  rig: PresetRig,
  store: UseBoundStore<StoreApi<DualChainState>>,
): Promise<ApplyPresetResult> {
  store.setState({
    chainA: {
      level: preset.chainA.level,
      pan: preset.chainA.pan,
      mute: preset.chainA.mute,
      solo: preset.chainA.solo,
    },
    chainB: {
      level: preset.chainB.level,
      pan: preset.chainB.pan,
      mute: preset.chainB.mute,
      solo: preset.chainB.solo,
    },
    masterLevel: preset.masterLevel,
    linked: preset.linked,
  })

  const missingAssets: MissingAsset[] = []
  await applyChain(context, 'A', preset.chainA, rig, missingAssets)
  await applyChain(context, 'B', preset.chainB, rig, missingAssets)
  return { missingAssets }
}
