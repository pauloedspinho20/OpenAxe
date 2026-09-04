import type { UseBoundStore, StoreApi } from 'zustand'
import type { GraphState } from '../state/graphStore'
import { getCachedAsset } from '../engine/assetCache'
import { cacheModelText, getPreloadedModelText } from '../engine/modelPreloader'
import { NAM_MODEL_KINDS } from '../engine/blocks/blockRegistry'
import type { Preset, PresetBlockData, PresetBlock, PresetRig, StageCapableRig } from './types'

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

/**
 * Model text for a switch: the preloader's resident copy first (no IndexedDB
 * read, no re-decode), the asset cache on a miss (remembered for next time).
 * Null when the asset isn't cached anywhere - the caller reports it missing.
 */
async function modelTextFor(modelId: string): Promise<string | null> {
  const preloaded = getPreloadedModelText(modelId)
  if (preloaded !== null) return preloaded
  const blob = await getCachedAsset(modelId)
  if (!blob) return null
  try {
    const text = await blob.text()
    cacheModelText(modelId, text)
    return text
  } catch {
    return null
  }
}

async function applyBlockAsset(
  context: AudioContext,
  data: PresetBlockData,
  block: PresetBlock,
  missingAssets: MissingAsset[],
): Promise<void> {
  if (NAM_MODEL_KINDS.has(data.kind)) {
    if (data.modelId) {
      const json = await modelTextFor(data.modelId)
      if (json) {
        try {
          await block.loadModel?.(json, undefined, {
            id: data.modelId,
            name: data.modelName ?? data.modelId,
          })
        } catch {
          // A corrupt/unsupported model shouldn't abort the whole preset.
          missingAssets.push({
            blockId: data.id,
            kind: 'model',
            id: data.modelId,
            name: data.modelName ?? data.modelId,
          })
        }
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
        try {
          const audioBuffer = await context.decodeAudioData(await blob.arrayBuffer())
          const irMix = typeof data.params.irMix === 'number' ? data.params.irMix : 1
          block.loadIR?.(audioBuffer, irMix, { id: data.irId, name: data.irName ?? data.irId })
        } catch {
          // A corrupt/unsupported IR shouldn't abort the whole preset.
          missingAssets.push({
            blockId: data.id,
            kind: 'ir',
            id: data.irId,
            name: data.irName ?? data.irId,
          })
        }
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
 * Restore a preset onto a live rig + store (issue #367).
 *
 * The preferred path builds the preset on the worklet's staged graph and
 * crossfades it live - no teardown silence, no audio-thread parse stall, no
 * reconnect click. Anything that goes wrong there (including a WASM that
 * predates staged switching) falls back to the legacy teardown-and-rebuild,
 * so a failed stage never leaves the rig half-built: the staged graph is
 * discarded and the live rig is untouched.
 */
export async function applyPreset(
  context: AudioContext,
  preset: Preset,
  rig: PresetRig,
  store: UseBoundStore<StoreApi<GraphState>>,
): Promise<ApplyPresetResult> {
  if (isStageCapable(rig)) {
    try {
      return await applyPresetStaged(context, preset, rig, store)
    } catch (err) {
      console.warn('[presets] staged apply failed, falling back to rebuild:', err)
    }
  }
  return applyPresetLegacy(context, preset, rig, store)
}

function isStageCapable(rig: PresetRig): rig is StageCapableRig {
  const candidate = rig as Partial<StageCapableRig>
  return typeof candidate.beginStage === 'function' && typeof candidate.adoptStage === 'function'
}

async function applyPresetStaged(
  context: AudioContext,
  preset: Preset,
  rig: StageCapableRig,
  store: UseBoundStore<StoreApi<GraphState>>,
): Promise<ApplyPresetResult> {
  const staged = await rig.beginStage()
  try {
    for (const data of preset.blocks) {
      await staged.addBlock(data.kind, data.row, data.col, data.id)
    }

    const missingAssets: MissingAsset[] = []
    for (const data of preset.blocks) {
      const block = staged.getBlock(data.id)
      if (!block) continue
      block.setParams(data.params)
      if (data.bypass !== undefined) block.setBypass?.(data.bypass)
      await applyBlockAsset(context, data, block, missingAssets)
    }

    // Awaited against the core (unlike the live rig's fire-and-forget
    // connect): a rejection is known before the commit.
    for (const edge of preset.edges) {
      const result = await staged.connectAndWait(edge.from, edge.to, edge.id)
      if (!result.ok) {
        console.warn(`[presets] staged edge ${edge.id} rejected by the core: ${result.reason}`)
      }
    }

    // Retries while a previous switch is still draining; throws past that.
    await staged.commit()
    rig.adoptStage(staged)
    syncStore(store, preset)
    return { missingAssets }
  } catch (err) {
    await staged.discard()
    throw err
  }
}

function syncStore(store: UseBoundStore<StoreApi<GraphState>>, preset: Preset): void {
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
}

/**
 * Legacy path: builds the graph directly against the live rig (clearing
 * whatever was there first) rather than going through graphStore's diffing,
 * since asset loading needs the live block references anyway - then syncs the
 * store to match so future reconciles from bindGraphRig are no-ops. Model/IR
 * loading is best-effort against the local asset cache (see MissingAsset);
 * restoring the actual bytes from Tone3000 when they aren't cached is the
 * Tone3000 Integration epic's job.
 */
async function applyPresetLegacy(
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

  syncStore(store, preset)

  return { missingAssets }
}
