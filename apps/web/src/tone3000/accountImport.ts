/**
 * Bulk import of the authenticated user's account tones into the local
 * Tone3000Library. Scoped to one of the Tone3000 "my tones" endpoints
 * — downloaded history, favorited, or created, or the union of all
 * three ("all") — so the FactorySetupDialog, SettingsDialog and catalog
 * Library tab can share one service instead of duplicating pagination +
 * slot inference.
 *
 * For each Tone the service lists its models and delegates to
 * bulkDownloadToneModels (which already handles has() skipping and the
 * 610ms rate-limit delay between model downloads). Listing the tone
 * pages and model pages also counts toward the 100 req/min quota, so
 * this file deliberately paginates tone lists (100 per page, max
 * allowed) and fetches model lists in bulk (pageSize 100) rather than
 * one-by-one where avoidable.
 */
import {
  apiListCreatedTones,
  apiListDownloadedTones,
  apiListFavoritedTones,
  apiListModels,
} from './client'
import { bulkDownloadToneModels } from './bulkDownload'
import type { ListUserTonesParams, Tone } from './types'

export type AccountImportScope = 'downloaded' | 'favorited' | 'created' | 'all'

export interface AccountImportProgress {
  currentTone: number
  totalTones: number
  toneId: number
  toneTitle: string
  status: 'fetching_models' | 'downloading' | 'done' | 'skipped' | 'failed'
}

export interface AccountImportResult {
  tones: number
  ok: number
  skipped: number
  failed: number
  errors: string[]
}

export interface AccountImportOptions {
  scope: AccountImportScope
  onProgress?: (progress: AccountImportProgress) => void
}

function inferSlot(tone: Tone): 'model' | 'ir' {
  return tone.format === 'ir' || tone.gear === 'cab' ? 'ir' : 'model'
}

type ListFn = (params: ListUserTonesParams) => Promise<{ data: Tone[]; total_pages: number }>

function listFnForScope(scope: Exclude<AccountImportScope, 'all'>): ListFn {
  switch (scope) {
    case 'downloaded':
      return apiListDownloadedTones as ListFn
    case 'favorited':
      return apiListFavoritedTones as ListFn
    case 'created':
      return apiListCreatedTones as ListFn
  }
}

async function collectAllTones(scope: AccountImportScope): Promise<Tone[]> {
  if (scope !== 'all') {
    const list = listFnForScope(scope)
    const all: Tone[] = []
    let page = 1
    let totalPages = 1
    do {
      const res = await list({ page, pageSize: 100 })
      all.push(...res.data)
      totalPages = res.total_pages || 1
      page++
    } while (page <= totalPages)
    return all
  }
  // "all" — union of downloaded + favorited + created, deduped by tone id
  const scopes: Exclude<AccountImportScope, 'all'>[] = ['downloaded', 'favorited', 'created']
  const seen = new Map<number, Tone>()
  for (const s of scopes) {
    const list = listFnForScope(s)
    let page = 1
    let totalPages = 1
    do {
      const res = await list({ page, pageSize: 100 })
      for (const tone of res.data) {
        if (!seen.has(tone.id)) seen.set(tone.id, tone)
      }
      totalPages = res.total_pages || 1
      page++
    } while (page <= totalPages)
  }
  return [...seen.values()]
}

/**
 * Imports every model file for every Tone in the user's account scope
 * into the local Tone3000Library/assetCache.
 *
 * - Paginates the tone list (page_size 100 = max).
 * - For each tone, lists models (page_size 100, paginates if >100) and
 *   bulk-downloads them via bulkDownloadToneModels (has()-aware, 610ms
 *   throttled).
 * - Aggregates ok/skipped/failed across all tones and surfaces per-tone
 *   errors as "Tone Title: model error".
 */
export async function importAccountTones(
  options: AccountImportOptions,
): Promise<AccountImportResult> {
  const { scope, onProgress } = options

  // 1. Collect tones for the selected scope (paginated, deduped for "all")
  const allTones = await collectAllTones(scope)

  const totalTones = allTones.length

  let ok = 0
  let skipped = 0
  let failed = 0
  const errors: string[] = []

  if (totalTones === 0) {
    return { tones: 0, ok, skipped, failed, errors }
  }

  // 2. For each tone, list models (paginated) and bulk-download
  for (let i = 0; i < allTones.length; i++) {
    const tone = allTones[i]!
    const slot = inferSlot(tone)
    onProgress?.({
      currentTone: i + 1,
      totalTones,
      toneId: tone.id,
      toneTitle: tone.title,
      status: 'fetching_models',
    })

    try {
      // Paginate models for this tone (pageSize 100)
      const models: import('./types').Tone3000Model[] = []
      let mPage = 1
      let mTotalPages = 1
      do {
        const mRes = await apiListModels(tone.id, { page: mPage, pageSize: 100 })
        models.push(...mRes.data)
        mTotalPages = mRes.total_pages || 1
        mPage++
      } while (mPage <= mTotalPages)

      if (models.length === 0) {
        onProgress?.({
          currentTone: i + 1,
          totalTones,
          toneId: tone.id,
          toneTitle: tone.title,
          status: 'skipped',
        })
        continue
      }

      onProgress?.({
        currentTone: i + 1,
        totalTones,
        toneId: tone.id,
        toneTitle: tone.title,
        status: 'downloading',
      })

      const result = await bulkDownloadToneModels({ tone, models, slot })
      ok += result.ok
      skipped += result.skipped
      failed += result.failed
      for (const e of result.errors) errors.push(`${tone.title}: ${e}`)

      onProgress?.({
        currentTone: i + 1,
        totalTones,
        toneId: tone.id,
        toneTitle: tone.title,
        status: result.failed > 0 ? 'failed' : 'done',
      })
    } catch (err) {
      failed += 1
      const message = err instanceof Error ? err.message : String(err)
      errors.push(`${tone.title}: ${message}`)
      onProgress?.({
        currentTone: i + 1,
        totalTones,
        toneId: tone.id,
        toneTitle: tone.title,
        status: 'failed',
      })
    }
  }

  return { tones: totalTones, ok, skipped, failed, errors }
}
