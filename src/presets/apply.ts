import type { UseBoundStore, StoreApi } from 'zustand'
import type { GraphState } from '../state/graphStore'
import { getCachedAsset } from '../engine/assetCache'
import { NAM_MODEL_KINDS } from '../engine/blocks/blockRegistry'
import type { Preset, PresetBlockData, PresetBlock, PresetRig } from './types'

export interface MissingAsset {
  blockId: string
  kind: 'model' | 'ir'
  id: string
  name: string
}

export interface ApplyPresetResult {
  /**
   * Model/IR references the preset needs but aren't in the local asset
   * cache - e.g. a preset shared by someone else, referencing a Tone3000
   * asset never downloaded on this device. Everything else in the preset
   * (params, wiring) still gets applied; the affected block just keeps no
   * model/IR loaded.
   */
  missingAssets: MissingAsset[]
}

async function applyBlockAsset(
  context: AudioContext,
  data: PresetBlockData,
  block: PresetBlock,
  missingAssets: MissingAsset[],
): Promise<void> {
  if (NAM_MODEL_KINDS.has(data.kind)) {
    if (data.modelId) {
      const blob = await getCachedAsset(data.modelId)
      if (blob) {
        const json = await blob.text()
        await block.loadModel?.(json, undefined, {
          id: data.modelId,
          name: data.modelName ?? data.modelId,
        })
      } else {
        missingAssets.push({
          blockId: data.id,
          kind: 'model',
          id: data.modelId,
          name: data.modelName ?? data.modelId,
        })
      }
    } else {
      await block.unloadModel?.()
    }
    return
  }

  if (data.kind === 'cab') {
    if (data.irId) {
      const blob = await getCachedAsset(data.irId)
      if (blob) {
        const audioBuffer = await context.decodeAudioData(await blob.arrayBuffer())
        const irMix = typeof data.params.irMix === 'number' ? data.params.irMix : 1
        block.loadIR?.(audioBuffer, irMix, { id: data.irId, name: data.irName ?? data.irId })
      } else {
        missingAssets.push({
          blockId: data.id,
          kind: 'ir',
          id: data.irId,
          name: data.irName ?? data.irId,
        })
      }
    } else {
      block.clearIR?.()
    }
  }
}

/**
 * Restore a preset onto a live rig + store. Builds the graph directly
 * against the rig (clearing whatever was there first) rather than going
 * through graphStore's diffing, since asset loading needs the live block
 * references anyway - then syncs the store to match so future reconciles
 * from bindGraphRig are no-ops. Model/IR loading is best-effort against the
 * local asset cache (see MissingAsset); restoring the actual bytes from
 * Tone3000 when they aren't cached is the Tone3000 Integration epic's job.
 */
export async function applyPreset(
  context: AudioContext,
  preset: Preset,
  rig: PresetRig,
  store: UseBoundStore<StoreApi<GraphState>>,
): Promise<ApplyPresetResult> {
  for (const id of [...rig.listBlockIds()]) {
    await rig.removeBlock(id)
  }
  for (const data of preset.blocks) {
    await rig.addBlock(data.kind, data.row, data.col, data.id)
  }

  const missingAssets: MissingAsset[] = []
  for (const data of preset.blocks) {
    const block = rig.getBlock(data.id)
    if (!block) continue
    block.setParams(data.params)
    if (data.bypass !== undefined) block.setBypass?.(data.bypass)
    await applyBlockAsset(context, data, block, missingAssets)
  }

  for (const edge of preset.edges) {
    rig.connect(edge.from, edge.to, edge.id)
  }

  store.getState().loadGraph(
    preset.blocks.map((b) => ({
      id: b.id,
      kind: b.kind,
      row: b.row,
      col: b.col,
      ...(b.bypass !== undefined && { bypass: b.bypass }),
      params: b.params,
    })),
    preset.edges.map((e) => ({ id: e.id, from: e.from, to: e.to })),
    preset.masterLevel,
    preset.masterMuted,
  )

  return { missingAssets }
}
