import { useEffect, useMemo, useState } from 'react'
import type { Tone3000LibraryEntry } from '../../../tone3000/library'
import { Tone3000Library, useTone3000Library } from '../../../tone3000/library'
import { apiListModels } from '../../../tone3000/client'
import { bulkDownloadToneModels } from '../../../tone3000/bulkDownload'
import type { Tone3000Model, Tone3000Slot } from '../../../tone3000/types'
import { Dialog, HardwareButton, OutlineButton } from '@openaxe/ui'
import styles from './NamModelDetails.module.css'

export interface NamModelDetailsProps {
  open: boolean
  onClose: () => void
  kindLabel: string
  loadedName: string | null
  entry: Tone3000LibraryEntry | null
  slot?: Tone3000Slot
  blockId?: string | null
  loadTarget?: {
    loadModel: (json: string, info: { id: string; name: string }) => Promise<unknown>
    loadIR: (buffer: AudioBuffer, info: { id: string; name: string }) => void
  } | null
  audioContext?: AudioContext | null
}

const GEAR_LABELS: Record<string, string> = {
  amp: 'Amp Model',
  'amp-cab': 'Amp+Cab Model',
  pedal: 'Pedal Model',
  outboard: 'Outboard Model',
  space: 'Space Model',
  cab: 'Cab IR',
  experimental: 'Experimental',
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export interface NamModelProps {
  kindLabel: string
  loadedName: string | null
  entry: Tone3000LibraryEntry | null
  onClick?: () => void
}

export function NamModelDetails({
  open,
  onClose,
  kindLabel,
  loadedName,
  entry,
  slot,
  blockId,
  loadTarget,
  audioContext,
}: NamModelDetailsProps) {
  const tone = entry?.tone ?? null
  const model = entry?.model ?? null
  const heroImage = tone?.images?.[0] ?? entry?.imageUrl ?? null
  const title = tone?.title ?? entry?.toneTitle ?? entry?.name ?? loadedName ?? kindLabel
  const uploadedOn = formatDate(tone?.created_at ?? null)
  const resolvedSlot: Tone3000Slot = slot ?? entry?.kind ?? 'model'

  const libraryEntries = useTone3000Library((s) => s.entries)
  const [liveModels, setLiveModels] = useState<Tone3000Model[] | null>(null)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [bulkDownloading, setBulkDownloading] = useState(false)
  const [bulkSummary, setBulkSummary] = useState<string | null>(null)

  const toneId = tone?.id ?? null

  useEffect(() => {
    if (!open || !toneId) {
      setLiveModels(null)
      setModelsError(null)
      return
    }
    let cancelled = false
    setModelsLoading(true)
    setModelsError(null)
    void (async () => {
      try {
        let res = await apiListModels(toneId, { pageSize: 50, architecture: 2 })
        if (res.data.length === 0) {
          res = await apiListModels(toneId, { pageSize: 50 })
        }
        if (cancelled) return
        setLiveModels(res.data)
      } catch (err: unknown) {
        if (cancelled) return
        setModelsError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setModelsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, toneId])

  const displayModels: Tone3000Model[] | null = useMemo(() => {
    if (liveModels) return liveModels
    if (tone && model) {
      return [
        {
          id: model.id,
          name: model.name,
          size: model.size,
          architecture_version: model.architecture_version,
          model_url: '',
          created_at: '',
          updated_at: '',
          user_id: tone.user.id,
          tone_id: tone.id,
        },
      ]
    }
    return null
  }, [liveModels, tone, model])

  const isCached = (modelId: number) => {
    const id = `tone3000:${resolvedSlot}:${modelId}`
    return libraryEntries.some((e) => e.id === id)
  }

  const handleDownloadOne = async (m: Tone3000Model) => {
    if (!tone) return
    const id = `tone3000:${resolvedSlot}:${m.id}`
    setDownloadingId(String(m.id))
    try {
      await Tone3000Library.importAsset({
        id,
        kind: resolvedSlot,
        name: m.name,
        creator: tone.user.username,
        sourceUrl: tone.url,
        toneTitle: tone.title,
        imageUrl: tone.images?.[0] ?? null,
        modelUrl: m.model_url,
        tone: {
          id: tone.id,
          title: tone.title,
          description: tone.description,
          gear: tone.gear,
          format: tone.format,
          license: tone.license,
          images: tone.images ?? null,
          sizes: tone.sizes ?? [],
          makes: tone.makes ?? [],
          tags: tone.tags ?? [],
          downloads_count: tone.downloads_count,
          favorites_count: tone.favorites_count,
          models_count: tone.models_count,
          user: tone.user,
          created_at: tone.created_at ?? null,
          url: tone.url,
        },
        model: {
          id: m.id,
          name: m.name,
          size: m.size,
          architecture_version: m.architecture_version,
        },
      })
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : String(err))
    } finally {
      setDownloadingId(null)
    }
  }

  const handleDownloadMissing = async () => {
    if (!tone || !displayModels) return
    const missing = displayModels.filter((m) => !isCached(m.id) && m.model_url)
    if (missing.length === 0) return
    setBulkDownloading(true)
    setBulkSummary(null)
    try {
      const result = await bulkDownloadToneModels({ tone, models: missing, slot: resolvedSlot })
      setBulkSummary(`${result.ok} downloaded, ${result.skipped} skipped, ${result.failed} failed`)
      if (result.failed > 0 && result.errors.length > 0) setModelsError(result.errors.join('; '))
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : String(err))
    } finally {
      setBulkDownloading(false)
    }
  }

  const handleLoad = async (m: Tone3000Model) => {
    if (!blockId || !loadTarget) return
    const id = `tone3000:${resolvedSlot}:${m.id}`
    const blob = await Tone3000Library.getBlob(id)
    if (!blob) return
    if (resolvedSlot === 'model') {
      await loadTarget.loadModel(await blob.text(), { id, name: m.name })
    } else {
      if (!audioContext) return
      const buf = await audioContext.decodeAudioData(await blob.arrayBuffer())
      loadTarget.loadIR(buf, { id, name: m.name })
    }
    await Tone3000Library.notifyLoaded()
    onClose()
  }

  const missingCount = displayModels ? displayModels.filter((m) => !isCached(m.id)).length : 0
  const VARIANT_LIMIT = 6
  const [showAllVariants, setShowAllVariants] = useState(false)

  useEffect(() => {
    setShowAllVariants(false)
  }, [toneId])

  const visibleModels = useMemo(() => {
    if (!displayModels) return null
    return showAllVariants ? displayModels : displayModels.slice(0, VARIANT_LIMIT)
  }, [displayModels, showAllVariants])

  return (
    <Dialog open={open} onClose={onClose} title="Model Details">
      <div className={styles.hero}>
        {heroImage && <img src={heroImage} alt="" className={styles.heroImage} loading="lazy" />}

        {displayModels && displayModels.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={`label ${styles.sectionLabel}`}>
                Tone Variants ({displayModels.length})
              </span>
              {missingCount > 0 && (
                <OutlineButton
                  disabled={bulkDownloading}
                  onClick={() => void handleDownloadMissing()}
                >
                  {bulkDownloading ? 'Downloading…' : `Download all (${missingCount})`}
                </OutlineButton>
              )}
            </div>
            {bulkSummary && <p className={`label ${styles.bulkSummary}`}>{bulkSummary}</p>}
            {modelsLoading && <p className={styles.note}>Loading variants…</p>}
            {modelsError && <p className={styles.error}>{modelsError}</p>}
            <ul className={styles.variantList}>
              {visibleModels!.map((m) => {
                const cached = isCached(m.id)
                return (
                  <li key={m.id} className={styles.variantRow}>
                    <span className={styles.modelName}>
                      {m.name}
                      <span className={`label ${styles.modelMeta}`}>
                        {m.size} · A{m.architecture_version} ·{' '}
                      </span>
                    </span>
                    <span className={styles.variantActions}>
                      {!cached ? (
                        <HardwareButton
                          label={downloadingId === String(m.id) ? 'Downloading…' : 'Download'}
                          disabled={downloadingId === String(m.id) || !m.model_url}
                          onClick={() => void handleDownloadOne(m)}
                        ></HardwareButton>
                      ) : (
                        <HardwareButton
                          label="Load"
                          disabled={!blockId || !loadTarget}
                          onClick={() => void handleLoad(m)}
                        ></HardwareButton>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
            {displayModels.length > VARIANT_LIMIT && (
              <OutlineButton
                onClick={() => setShowAllVariants((v) => !v)}
                aria-expanded={showAllVariants}
              >
                {showAllVariants ? 'Show less' : `Show all (${displayModels.length})`}
              </OutlineButton>
            )}
          </div>
        )}
      </div>

      <div>
        <div className={styles.toneTitle}>{title}</div>
        <div className={styles.badgeRow}>
          <span className={styles.badge}>
            {tone ? (GEAR_LABELS[tone.gear] ?? kindLabel) : kindLabel}
          </span>
          {tone?.format && <span className={styles.badge}>{tone.format.toUpperCase()}</span>}
          {model && (
            <span className={styles.badge}>
              {model.size} · A{model.architecture_version}
            </span>
          )}
        </div>
      </div>

      {entry && (
        <div className={styles.creatorRow}>
          {tone?.user?.avatar_url && (
            <img src={tone.user.avatar_url} alt="" className={styles.avatar} />
          )}
          <span className={styles.creatorName}>Captured by {entry.creator}</span>
          {uploadedOn && <span className={`label ${styles.uploadDate}`}>· {uploadedOn}</span>}
        </div>
      )}

      {tone && (
        <div className={styles.metrics}>
          <div className={styles.metric}>
            <span className={styles.metricValue}>{tone.downloads_count ?? 0}</span>
            <span className={`label ${styles.metricLabel}`}>Downloads</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricValue}>{tone.favorites_count ?? 0}</span>
            <span className={`label ${styles.metricLabel}`}>Likes</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricValue}>{tone.models_count ?? 0}</span>
            <span className={`label ${styles.metricLabel}`}>Models</span>
          </div>
        </div>
      )}

      {tone?.description && <p className={styles.description}>{tone.description}</p>}

      {!displayModels && model && (
        <div className={styles.section}>
          <span className={`label ${styles.sectionLabel}`}>This Block's Model</span>
          <div className={styles.modelRow}>
            <span className={styles.modelName}>{model.name}</span>
            <span className={`label ${styles.modelMeta}`}>
              {model.size} · Architecture {model.architecture_version}
            </span>
          </div>
        </div>
      )}

      {tone && (tone.sizes?.length ?? 0) > 0 && (
        <div className={styles.section}>
          <span className={`label ${styles.sectionLabel}`}>Available Sizes</span>
          <div className={styles.chips}>
            {tone.sizes.map((size) => (
              <span key={size} className={styles.chip}>
                {size}
              </span>
            ))}
          </div>
        </div>
      )}

      {tone && (tone.makes?.length ?? 0) > 0 && (
        <div className={styles.section}>
          <span className={`label ${styles.sectionLabel}`}>Gear</span>
          <div className={styles.chips}>
            {tone.makes.map((make) => (
              <span key={make} className={styles.chip}>
                {make}
              </span>
            ))}
          </div>
        </div>
      )}

      {tone && (tone.tags?.length ?? 0) > 0 && (
        <div className={styles.section}>
          <span className={`label ${styles.sectionLabel}`}>Tags</span>
          <div className={styles.chips}>
            {tone.tags.map((tag) => (
              <span key={tag} className={styles.chip}>
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {tone?.license && (
        <div className={styles.section}>
          <span className={`label ${styles.sectionLabel}`}>License</span>
          <p className={styles.licenseText}>{tone.license}</p>
        </div>
      )}

      {!entry && (
        <p className={styles.note}>
          Loaded from a local file - no Tone3000 data is available for it.
        </p>
      )}
      {entry && !tone && (
        <p className={styles.note}>
          Full details weren't cached for this import - re-import the model from the Tone3000
          catalog to see everything.
        </p>
      )}

      {entry?.sourceUrl && (
        <div className={styles.footer}>
          <a href={entry.sourceUrl} target="_blank" rel="noreferrer" className={styles.link}>
            View on Tone3000 →
          </a>
        </div>
      )}
    </Dialog>
  )
}
