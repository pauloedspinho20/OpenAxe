import { Tone3000Library } from './library'
import type { Tone3000ToneSnapshot, Tone3000ModelSnapshot } from './library'
import type { Tone, Tone3000Model, Tone3000Slot } from './types'

export interface BulkDownloadResult {
  ok: number
  skipped: number
  failed: number
  errors: string[]
}

export interface BulkDownloadProgress {
  current: number
  total: number
  modelId: number
  modelName: string
  status: 'downloading' | 'done' | 'skipped' | 'failed'
}

export interface BulkDownloadOptions {
  tone: Tone | Tone3000ToneSnapshot
  models: Tone3000Model[]
  slot: Tone3000Slot
  onProgress?: (progress: BulkDownloadProgress) => void
}

const RATE_LIMIT_DELAY_MS = 610

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildToneSnapshot(tone: Tone | Tone3000ToneSnapshot): Tone3000ToneSnapshot {
  if (
    (tone as Tone3000ToneSnapshot).makes !== undefined &&
    Array.isArray((tone as Tone3000ToneSnapshot).makes) &&
    typeof (tone as Tone3000ToneSnapshot).makes[0] === 'string'
  ) {
    return tone as Tone3000ToneSnapshot
  }
  const t = tone as Tone
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    gear: t.gear,
    format: t.format,
    license: t.license,
    images: t.images ?? null,
    sizes: t.sizes ?? [],
    makes: (t.makes ?? []).map((m) => m.name),
    tags: (t.tags ?? []).map((t2) => t2.name),
    downloads_count: t.downloads_count,
    favorites_count: t.favorites_count,
    models_count: t.models_count,
    user: t.user,
    created_at: t.created_at ?? null,
    url: t.url,
  }
}

function buildModelSnapshot(model: Tone3000Model): Tone3000ModelSnapshot {
  return {
    id: model.id,
    name: model.name,
    size: model.size,
    architecture_version: model.architecture_version,
  }
}

/**
 * Sequentially downloads every model file of a tone, skipping already cached ones.
 * Respects Tone3000's 100 req/min rate limit with a 610ms delay between downloads.
 * Returns { ok, skipped, failed } plus per-model error messages.
 */
export async function bulkDownloadToneModels(
  options: BulkDownloadOptions,
): Promise<BulkDownloadResult> {
  const { tone, models, slot, onProgress } = options
  let ok = 0
  let skipped = 0
  let failed = 0
  const errors: string[] = []
  const toneSnapshot = buildToneSnapshot(tone)

  for (let i = 0; i < models.length; i++) {
    const model = models[i]!
    const id = `tone3000:${slot}:${model.id}`
    const progressBase = {
      current: i + 1,
      total: models.length,
      modelId: model.id,
      modelName: model.name,
    }

    const alreadyCached = await Tone3000Library.has(id)
    if (alreadyCached) {
      skipped++
      onProgress?.({ ...progressBase, status: 'skipped' })
      continue
    }

    onProgress?.({ ...progressBase, status: 'downloading' })

    try {
      await Tone3000Library.importAsset({
        id,
        kind: slot,
        name: model.name,
        creator: tone.user.username,
        sourceUrl: tone.url,
        toneTitle: tone.title,
        imageUrl: tone.images?.[0] ?? null,
        modelUrl: model.model_url,
        tone: toneSnapshot,
        model: buildModelSnapshot(model),
      })
      ok++
      onProgress?.({ ...progressBase, status: 'done' })
    } catch (err) {
      failed++
      const message = err instanceof Error ? err.message : String(err)
      errors.push(`${model.name}: ${message}`)
      onProgress?.({ ...progressBase, status: 'failed' })
    }

    if (i < models.length - 1) {
      await delay(RATE_LIMIT_DELAY_MS)
    }
  }

  return { ok, skipped, failed, errors }
}
