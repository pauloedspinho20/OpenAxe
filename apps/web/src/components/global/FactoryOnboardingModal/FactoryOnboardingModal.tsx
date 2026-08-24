import { useEffect, useState } from 'react'
import { Dialog, HardwareButton, OutlineButton } from '@openaxe/ui'
import {
  allFactoryGear,
  cacheFactoryGear,
  loadFactoryManifest,
} from '../../../tone3000/factoryGear'
import styles from './FactoryOnboardingModal.module.css'

export interface FactoryOnboardingModalProps {
  open: boolean
  onDismiss: () => void
}

export function FactoryOnboardingModal({ open, onDismiss }: FactoryOnboardingModalProps) {
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [total, setTotal] = useState<number | null>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    void loadFactoryManifest()
      .then(() => setTotal(allFactoryGear().length))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [open])

  const handleDownloadAll = async () => {
    const entries = allFactoryGear()
    if (entries.length === 0) return
    setDownloading(true)
    setError(null)
    setProgress({ done: 0, total: entries.length })
    let done = 0
    const results = await Promise.allSettled(
      entries.map(async (entry) => {
        try {
          await cacheFactoryGear(entry)
        } finally {
          done += 1
          setProgress({ done, total: entries.length })
        }
      }),
    )
    const failed = results.filter((r) => r.status === 'rejected').length
    if (failed > 0)
      setError(
        `${failed} factory asset(s) failed to download. You can retry or browse the Factory tab later.`,
      )
    setDownloading(false)
    // Auto-dismiss after successful bulk download so the prompt doesn't reappear.
    if (failed === 0) onDismiss()
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !downloading) onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onDismiss, downloading])

  if (!open) return null

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!downloading) onDismiss()
      }}
      title="Factory pack available"
      width="min(520px, 90vw)"
      zIndex={120}
    >
      <div className={styles.body}>
        {loading ? (
          <p className={styles.hint}>Loading factory pack…</p>
        ) : total === 0 ? (
          <>
            <p className={styles.text}>
              No factory models are curated yet. Place an Amp, Pedal or Cab block and use its
              Factory tab once models are available — or browse Tone3000.
            </p>
            <div className={styles.footer}>
              <HardwareButton label="Got it" onClick={onDismiss} />
            </div>
          </>
        ) : (
          <>
            <p className={styles.text}>
              A curated factory pack of amp, pedal and cab captures is available for offline use —
              no Tone3000 account needed. Download once and every block&apos;s Factory tab can load
              them instantly, even offline.
            </p>
            {progress && (
              <p className={styles.hint}>
                Downloading… {progress.done}/{progress.total}
              </p>
            )}
            {error && <p className={styles.error}>{error}</p>}
            <div className={styles.footer}>
              <HardwareButton
                label={
                  downloading && progress
                    ? `Downloading… ${progress.done}/${progress.total}`
                    : `Download all (${total})`
                }
                disabled={downloading}
                onClick={() => void handleDownloadAll()}
              />
              <OutlineButton disabled={downloading} onClick={onDismiss}>
                Not now
              </OutlineButton>
            </div>
            <p className={styles.hint} style={{ marginTop: 8 }}>
              You can always download or remove factory models later from any block&apos;s Factory
              tab. Each model can be swapped from the block inspector.
            </p>
          </>
        )}
      </div>
    </Dialog>
  )
}
