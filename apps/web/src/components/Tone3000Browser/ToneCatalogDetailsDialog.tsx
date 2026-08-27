import { useEffect, useMemo, useState } from 'react'
import { Tone3000Library, useTone3000Library } from '../../tone3000/library'
import { apiListModels } from '../../tone3000/client'
import { bulkDownloadToneModels } from '../../tone3000/bulkDownload'
import type { Tone, Tone3000Model, Tone3000Slot } from '../../tone3000/types'
import type { BlockLoadTarget } from '../../tone3000/importService'
import { Dialog, OutlineButton } from '@openaxe/ui'
import styles from '../grid/NamModelDetails/NamModelDetails.module.css'

interface Props {
  open: boolean
  onClose: () => void
  tone: Tone | null
  slot: Tone3000Slot
  target: BlockLoadTarget | null
  context: AudioContext | null
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

export function ToneCatalogDetailsDialog({ open, onClose, tone, slot, target, context }: Props) {
  const libraryEntries = useTone3000Library((s) => s.entries)
  const [liveModels, setLiveModels] = useState<Tone3000Model[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [bulkDownloading, setBulkDownloading] = useState(false)
  const [bulkSummary, setBulkSummary] = useState<string | null>(null)

  const toneId = tone?.id ?? null
  const heroImage = tone?.images?.[0] ?? null
  const uploadedOn = formatDate(tone?.created_at ?? null)

  useEffect(() => {
    if (!open || !toneId) {
      setLiveModels(null)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void apiListModels(toneId, { pageSize: 50 })
      .then((res) => {
        if (cancelled) return
        setLiveModels(res.data)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, toneId])

  const isCached = (modelId: number) => {
    const id = `tone3000:${slot}:${modelId}`
    return libraryEntries.some((e) => e.id === id)
  }

  const handleDownloadOne = async (m: Tone3000Model) => {
    if (!tone) return
    const id = `tone3000:${slot}:${m.id}`
    setDownloadingId(String(m.id))
    try {
      await Tone3000Library.importAsset({
        id,
        kind: slot,
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
          makes: (tone.makes ?? []).map((x) => x.name),
          tags: (tone.tags ?? []).map((x) => x.name),
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
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDownloadingId(null)
    }
  }

  const handleDownloadAll = async () => {
    if (!tone || !liveModels) return
    setBulkDownloading(true)
    setBulkSummary(null)
    try {
      const result = await bulkDownloadToneModels({ tone, models: liveModels, slot })
      setBulkSummary(`${result.ok} downloaded, ${result.skipped} skipped, ${result.failed} failed`)
      if (result.failed > 0 && result.errors.length > 0) setError(result.errors.join('; '))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBulkDownloading(false)
    }
  }

  const handleDownloadMissing = async () => {
    if (!tone || !liveModels) return
    const missing = liveModels.filter((m) => !isCached(m.id) && m.model_url)
    if (missing.length === 0) return
    setBulkDownloading(true)
    setBulkSummary(null)
    try {
      const result = await bulkDownloadToneModels({ tone, models: missing, slot })
      setBulkSummary(`${result.ok} downloaded, ${result.skipped} skipped, ${result.failed} failed`)
      if (result.failed > 0 && result.errors.length > 0) setError(result.errors.join('; '))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBulkDownloading(false)
    }
  }

  const handleLoad = async (m: Tone3000Model) => {
    if (!target || !context) return
    const id = `tone3000:${slot}:${m.id}`
    const blob = await Tone3000Library.getBlob(id)
    if (!blob) return
    if (slot === 'model') {
      await target.loadModel(await blob.text(), { id, name: m.name })
    } else {
      const buf = await context.decodeAudioData(await blob.arrayBuffer())
      target.loadIR(buf, { id, name: m.name })
    }
    await Tone3000Library.notifyLoaded()
    onClose()
  }

  const missingCount = useMemo(
    () => (liveModels ? liveModels.filter((m) => !isCached(m.id)).length : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liveModels, libraryEntries],
  )

  if (!tone) return null

  return (
    <Dialog open={open} onClose={onClose} title="Tone Details" width="min(720px, 96vw)" zIndex={50}>
      {heroImage && <img src={heroImage} alt="" className={styles.hero} loading="lazy" />}

      <div>
        <div className={styles.toneTitle}>{tone.title}</div>
        <div className={styles.badgeRow}>
          <span className={styles.badge}>{GEAR_LABELS[tone.gear] ?? tone.gear}</span>
          <span className={styles.badge}>{tone.format.toUpperCase()}</span>
          <span className={styles.badge}>{tone.models_count} files</span>
        </div>
      </div>

      <div className={styles.creatorRow}>
        {tone.user.avatar_url && (
          <img src={tone.user.avatar_url} alt="" className={styles.avatar} />
        )}
        <span className={styles.creatorName}>Captured by {tone.user.username}</span>
        {uploadedOn && <span className={`label ${styles.uploadDate}`}>· {uploadedOn}</span>}
      </div>

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

      {tone.description && <p className={styles.description}>{tone.description}</p>}

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={`label ${styles.sectionLabel}`}>
            Files ({liveModels?.length ?? tone.models_count})
          </span>
          <span style={{ display: 'flex', gap: 8 }}>
            {liveModels && liveModels.length > 1 && (
              <OutlineButton
                disabled={bulkDownloading || loading}
                onClick={() => void handleDownloadAll()}
              >
                {bulkDownloading ? 'Downloading…' : `Download all (${liveModels.length})`}
              </OutlineButton>
            )}
            {missingCount > 0 && liveModels && (
              <OutlineButton
                disabled={bulkDownloading || loading}
                onClick={() => void handleDownloadMissing()}
              >
                {bulkDownloading ? 'Downloading…' : `Download missing (${missingCount})`}
              </OutlineButton>
            )}
          </span>
        </div>
        {bulkSummary && <p className={`label ${styles.bulkSummary}`}>{bulkSummary}</p>}
        {loading && <p className={styles.note}>Loading files…</p>}
        {error && <p className={styles.error}>{error}</p>}
        <p className={styles.note}>
          Each file is a separate capture of the same rig. Download individually or all at once.
          Downloaded files are cached offline — load any cached file into the active block.
        </p>
        {liveModels && (
          <ul className={styles.variantList}>
            {liveModels.map((m) => {
              const cached = isCached(m.id)
              return (
                <li key={m.id} className={styles.variantRow}>
                  <span className={styles.modelName}>
                    {m.name}
                    <span className={`label ${styles.modelMeta}`}>
                      {m.size} · A{m.architecture_version} · {cached ? 'cached' : 'not downloaded'}
                    </span>
                  </span>
                  <span className={styles.variantActions}>
                    {!cached ? (
                      <OutlineButton
                        disabled={downloadingId === String(m.id) || !m.model_url}
                        onClick={() => void handleDownloadOne(m)}
                      >
                        {downloadingId === String(m.id) ? 'Downloading…' : 'Download'}
                      </OutlineButton>
                    ) : (
                      <OutlineButton
                        disabled={!target || !context}
                        onClick={() => void handleLoad(m)}
                      >
                        Load
                      </OutlineButton>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {tone.sizes?.length > 0 && (
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

      {tone.makes?.length > 0 && (
        <div className={styles.section}>
          <span className={`label ${styles.sectionLabel}`}>Gear</span>
          <div className={styles.chips}>
            {tone.makes.map((make) => (
              <span key={make.name} className={styles.chip}>
                {make.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {tone.tags?.length > 0 && (
        <div className={styles.section}>
          <span className={`label ${styles.sectionLabel}`}>Tags</span>
          <div className={styles.chips}>
            {tone.tags.map((tag) => (
              <span key={tag.name} className={styles.chip}>
                {tag.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {tone.license && (
        <div className={styles.section}>
          <span className={`label ${styles.sectionLabel}`}>License</span>
          <p className={styles.licenseText}>{tone.license}</p>
        </div>
      )}

      <div className={styles.footer}>
        <a href={tone.url} target="_blank" rel="noreferrer" className={styles.link}>
          View on Tone3000 →
        </a>
      </div>
    </Dialog>
  )
}
