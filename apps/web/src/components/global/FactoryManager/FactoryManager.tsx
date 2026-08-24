import { useEffect, useState } from 'react'
import { Dialog, HardwareButton, OutlineButton } from '@openaxe/ui'
import { deleteCachedAsset, getCachedAsset } from '../../../engine/assetCache'
import {
  allFactoryGear,
  cacheFactoryGear,
  loadFactoryManifest,
} from '../../../tone3000/factoryGear'
import type { FactoryGearEntry } from '../../../tone3000/factoryGear'
import styles from './FactoryManager.module.css'

export interface FactoryManagerProps {
  open: boolean
  onClose: () => void
}

const GEAR_LABELS: Record<string, string> = {
  amp: 'Amp',
  'amp-cab': 'Amp+Cab',
  pedal: 'Pedal',
  cab: 'Cab',
}

export function FactoryManager({ open, onClose }: FactoryManagerProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [entries, setEntries] = useState<FactoryGearEntry[]>([])
  const [cachedIds, setCachedIds] = useState<Set<string>>(new Set())
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [bulkDownloading, setBulkDownloading] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null)

  const refresh = async () => {
    const all = allFactoryGear()
    setEntries(all)
    const cached = new Set<string>()
    await Promise.all(
      all.map(async (e) => {
        const blob = await getCachedAsset(e.id)
        if (blob) cached.add(e.id)
      }),
    )
    setCachedIds(cached)
  }

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    void loadFactoryManifest()
      .then(() => refresh())
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !bulkDownloading && !downloadingId) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, bulkDownloading, downloadingId])

  const handleDownload = async (entry: FactoryGearEntry) => {
    setDownloadingId(entry.id)
    setError(null)
    try {
      await cacheFactoryGear(entry)
      setCachedIds((prev) => new Set(prev).add(entry.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDownloadingId(null)
    }
  }

  const handleRemove = async (entry: FactoryGearEntry) => {
    await deleteCachedAsset(entry.id)
    setCachedIds((prev) => {
      const next = new Set(prev)
      next.delete(entry.id)
      return next
    })
  }

  const handleDownloadAll = async () => {
    if (entries.length === 0) return
    setBulkDownloading(true)
    setError(null)
    setBulkProgress({ done: 0, total: entries.length })
    let done = 0
    const results = await Promise.allSettled(
      entries.map(async (entry) => {
        try {
          await cacheFactoryGear(entry)
        } finally {
          done += 1
          setBulkProgress({ done, total: entries.length })
        }
      }),
    )
    const failed = results.filter((r) => r.status === 'rejected').length
    if (failed > 0) setError(`${failed} factory asset(s) failed to download.`)
    await refresh()
    setBulkDownloading(false)
    setBulkProgress(null)
  }

  if (!open) return null

  const cachedCount = cachedIds.size
  const total = entries.length

  return (
    <Dialog open={open} onClose={onClose} title="Factory pack" width="min(640px, 96vw)" zIndex={40}>
      <div className={styles.body}>
        {loading ? (
          <p className={styles.hint}>Loading factory pack…</p>
        ) : total === 0 ? (
          <p className={styles.hint}>No factory models are curated yet.</p>
        ) : (
          <>
            <div className={styles.summary}>
              <span className={styles.summaryText}>
                {cachedCount}/{total} cached locally
              </span>
              <HardwareButton
                label={
                  bulkDownloading && bulkProgress
                    ? `Downloading… ${bulkProgress.done}/${bulkProgress.total}`
                    : `Download all (${total})`
                }
                disabled={bulkDownloading || !!downloadingId}
                onClick={() => void handleDownloadAll()}
              />
            </div>
            {bulkProgress && (
              <p className={styles.hint}>
                Downloading… {bulkProgress.done}/{bulkProgress.total}
              </p>
            )}
            {error && <p className={styles.error}>{error}</p>}
            <ul className={styles.list}>
              {entries.map((entry) => {
                const cached = cachedIds.has(entry.id)
                const loading = downloadingId === entry.id
                return (
                  <li key={entry.id} className={styles.row}>
                    <div className={styles.info}>
                      <span className={styles.name}>{entry.name}</span>
                      <span className={`label ${styles.meta}`}>
                        {GEAR_LABELS[entry.gear] ?? entry.gear} ·{' '}
                        {entry.slot === 'ir' ? 'IR' : 'NAM'}
                        {cached ? ' · cached' : ''}
                      </span>
                    </div>
                    <div className={styles.actions}>
                      {cached ? (
                        <OutlineButton
                          variant="danger"
                          disabled={bulkDownloading || !!downloadingId}
                          onClick={() => void handleRemove(entry)}
                          aria-label={`Remove ${entry.name}`}
                        >
                          ×
                        </OutlineButton>
                      ) : (
                        <OutlineButton
                          disabled={bulkDownloading || !!downloadingId}
                          onClick={() => void handleDownload(entry)}
                        >
                          {loading ? 'Downloading…' : 'Download'}
                        </OutlineButton>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
            <p className={styles.hint}>
              After downloading, load a model from any block&apos;s inspector → Factory tab. Each
              Amp/Pedal/Amp+Cab/Cab block can swap its factory model independently.
            </p>
          </>
        )}
      </div>
    </Dialog>
  )
}
