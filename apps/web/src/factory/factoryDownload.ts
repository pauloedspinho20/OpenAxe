/**
 * Downloads the curated factory pack: for every model in FACTORY_PACK, fetch
 * the tone + its model files via the authenticated Tone3000 client, download
 * (or skip, if already cached) the chosen variant into the local library with
 * attribution, then build + place the pack's presets into the preset bank and
 * wire scene 0. Runs strictly on a user-initiated "Download factory pack"
 * click in the first-run dialog - never silently.
 */
import { apiGetTone, apiListModels } from '../tone3000/client'
import { Tone3000Library } from '../tone3000/library'
import type { Tone, Tone3000Model } from '../tone3000/types'
import { createEmptyPresetBank, loadPresetBank, savePresetBank } from '../presets/presetBankStore'
import { PRESET_SLOT_COUNT } from '../presets/presetBank'
import { savePreset } from '../presets/presetStore'
import { createEmptyBank, loadSceneBank, saveSceneBank } from '../scenes/sceneBankStore'
import { DEFAULT_SCENE_NAME } from '../scenes/factoryScenes'
import { SLOTS_PER_SCENE } from '../scenes/types'
import {
  buildPackPreset,
  FACTORY_PACK,
  type FactoryPack,
  type FactoryPackModel,
  type ResolvedPackModel,
} from './factoryPack'

export interface FactoryDownloadProgress {
  done: number
  total: number
  name: string
}

export interface FactoryDownloadSummary {
  downloaded: number
  skipped: number
  failed: { name: string; error: string }[]
  placedPresets: number
}

interface ResolvedModel extends ResolvedPackModel {
  ref: FactoryPackModel
  model: Tone3000Model
  tone: Tone
}

async function resolvePackModel(ref: FactoryPackModel): Promise<ResolvedModel> {
  const tone = await apiGetTone(ref.toneId)
  // Tone3000's /models endpoint defaults to A1+Custom when `architecture` is omitted (excludes A2).
  // Factory tones are curated as A2, so request A2 explicitly and fall back to legacy for older IR/Custom packs.
  let page = await apiListModels(ref.toneId, { pageSize: 50, architecture: 2 })
  if (page.data.length === 0) {
    page = await apiListModels(ref.toneId, { pageSize: 50 })
  }
  const model = ref.modelId ? page.data.find((m) => m.id === ref.modelId) : page.data[0]
  if (!model) throw new Error(`No model file found for tone "${tone.title}" (id ${ref.toneId})`)
  return {
    ref,
    assetId: `tone3000:${ref.slot}:${model.id}`,
    name: model.name,
    model,
    tone,
  }
}

async function importResolved(resolved: ResolvedModel): Promise<void> {
  const { model, tone, ref } = resolved
  await Tone3000Library.importAsset({
    id: resolved.assetId,
    kind: ref.slot,
    name: model.name,
    modelUrl: model.model_url,
    creator: tone.user.username,
    sourceUrl: tone.url,
    toneTitle: tone.title,
    imageUrl: tone.images?.[0] ?? null,
    tone: {
      id: tone.id,
      title: tone.title,
      description: tone.description,
      gear: tone.gear,
      format: tone.format,
      license: tone.license,
      images: tone.images ?? null,
      sizes: tone.sizes ?? [],
      makes: (tone.makes ?? []).map((m) => m.name),
      tags: (tone.tags ?? []).map((t) => t.name),
      downloads_count: tone.downloads_count,
      favorites_count: tone.favorites_count,
      models_count: tone.models_count,
      user: tone.user,
      created_at: tone.created_at ?? null,
      url: tone.url,
    },
    model: {
      id: model.id,
      name: model.name,
      size: model.size,
      architecture_version: model.architecture_version,
    },
  })
}

/** Build + place the pack's presets into the bank and wire scene 0. Returns how many landed. */
async function seedFactoryPack(
  pack: FactoryPack,
  resolved: ReadonlyMap<number, ResolvedPackModel>,
): Promise<number> {
  const presetBank = (await loadPresetBank()) ?? createEmptyPresetBank()
  let wrotePresetBank = false
  let placed = 0

  for (const def of pack.presets) {
    const preset = buildPackPreset(def, resolved)
    if (!preset) continue
    await savePreset(preset)
    if (def.bankSlot >= 0 && def.bankSlot < PRESET_SLOT_COUNT) {
      presetBank.slots[def.bankSlot] = preset.id
      wrotePresetBank = true
      placed += 1
    }
  }
  if (wrotePresetBank) await savePresetBank(presetBank)

  const sceneBank = (await loadSceneBank()) ?? createEmptyBank()
  const sceneZero = sceneBank.scenes[0]!
  pack.scene0Slots.forEach((bankSlot, i) => {
    if (i < SLOTS_PER_SCENE && sceneZero.slots[i] == null) sceneZero.slots[i] = bankSlot
  })
  if (sceneZero.name === '') sceneZero.name = DEFAULT_SCENE_NAME
  await saveSceneBank(sceneBank)

  return placed
}

/** Downloads the whole curated pack, then seeds presets. Never throws for individual model failures. */
export async function downloadFactoryPack(
  onProgress?: (progress: FactoryDownloadProgress) => void,
  pack: FactoryPack = FACTORY_PACK,
): Promise<FactoryDownloadSummary> {
  const summary: FactoryDownloadSummary = {
    downloaded: 0,
    skipped: 0,
    failed: [],
    placedPresets: 0,
  }
  const resolved = new Map<number, ResolvedPackModel>()
  const total = pack.models.length
  let done = 0

  for (let i = 0; i < pack.models.length; i++) {
    const ref = pack.models[i]!
    onProgress?.({ done, total, name: ref.name })
    try {
      const model = await resolvePackModel(ref)
      if (await Tone3000Library.has(model.assetId)) {
        summary.skipped += 1
      } else {
        await importResolved(model)
        summary.downloaded += 1
      }
      resolved.set(i, { assetId: model.assetId, name: model.name })
    } catch (err) {
      summary.failed.push({
        name: ref.name,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    done += 1
    onProgress?.({ done, total, name: ref.name })
  }

  summary.placedPresets = await seedFactoryPack(pack, resolved)
  return summary
}
