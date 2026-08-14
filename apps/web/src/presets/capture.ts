import type { UseBoundStore, StoreApi } from 'zustand'
import type { GraphState, BlockInstance } from '../state/graphStore'
import type { Preset, PresetBlockData, PresetRig } from './types'

function captureBlock(rig: PresetRig, stored: BlockInstance): PresetBlockData {
  const block = rig.getBlock(stored.id)
  const model = block?.getLoadedModel?.() ?? null
  const ir = block?.getLoadedIr?.() ?? null
  return {
    id: stored.id,
    kind: stored.kind,
    row: stored.row,
    col: stored.col,
    ...(stored.bypass !== undefined && { bypass: stored.bypass }),
    params: block?.getParams() ?? stored.params,
    modelId: model?.id ?? null,
    modelName: model?.name ?? null,
    irId: ir?.id ?? null,
    irName: ir?.name ?? null,
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
  store: UseBoundStore<StoreApi<GraphState>>,
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
    blocks: state.blocks.map((b) => captureBlock(rig, b)),
    edges: state.edges.map((e) => ({ id: e.id, from: e.from, to: e.to })),
    masterLevel: state.masterLevel,
    masterMuted: state.masterMuted,
  }
}
