import { useRef, useState } from 'react'
import { Dialog, HardwareButton, OutlineButton } from '@openaxe/ui'
import { useTone3000Auth } from '../../../tone3000/authStore'
import { downloadFactoryPack } from '../../../factory/factoryDownload'
import { FACTORY_PACK } from '../../../factory/factoryPack'
import { installOfflineFactorySetup, setFactorySetupDone } from '../../../factory/factorySetup'
import { importDataBundle, readDataBundleFromFile } from '../../../settings/dataBundle'
import styles from './FactorySetupDialog.module.css'

export interface FactorySetupDialogProps {
  open: boolean
}

const NOT_AUTHENTICATED = 'Not authenticated'

/**
 * First-run setup, shown once on a fresh browser after power-on (and after
 * the onboarding walkthrough is dismissed). Three paths:
 *  - Download the curated factory pack through the user's Tone3000 account,
 *  - Import a whole-app backup (scenes + presets + assets),
 *  - Skip - seed the offline FX-only starters.
 * Every path writes a flag and reloads so the next boot hydrates normally.
 */
export function FactorySetupDialog({ open }: FactorySetupDialogProps) {
  const auth = useTone3000Auth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsConnect, setNeedsConnect] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  if (!open) return null

  const packEmpty = FACTORY_PACK.models.length === 0

  const finish = () => {
    setFactorySetupDone()
    window.location.reload()
  }

  const handleDownload = async () => {
    setBusy(true)
    setError(null)
    setNeedsConnect(false)
    try {
      const summary = await downloadFactoryPack((p) =>
        setProgress({ done: p.done, total: p.total }),
      )
      if (summary.failed.length > 0) {
        setError(
          `${summary.failed.length} model(s) failed to download: ${summary.failed
            .map((f) => f.name)
            .join(', ')}`,
        )
      }
      finish()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message === NOT_AUTHENTICATED) {
        setNeedsConnect(true)
        setError('Downloading the factory pack needs a Tone3000 account connection.')
      } else {
        setError(`Factory pack download failed: ${message}`)
      }
      setBusy(false)
    }
  }

  const handleImportFile = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const bundle = await readDataBundleFromFile(file)
      await importDataBundle(bundle)
      finish()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const handleSkip = async () => {
    setBusy(true)
    setError(null)
    try {
      await installOfflineFactorySetup()
      finish()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open title="GET STARTED" onClose={() => {}} width="min(480px, 92vw)" zIndex={120}>
      <div className={styles.body}>
        <p className={styles.copy}>
          {packEmpty
            ? 'Download the curated factory pack of NAM models, restore a backup of your scenes and presets, or start with the built-in FX-only presets.'
            : 'Download a curated pack of amp / cab / pedal models through your Tone3000 account, restore a backup of your scenes and presets, or start with the built-in FX-only presets.'}
        </p>

        <div className={styles.actions}>
          <HardwareButton
            label={
              progress ? `Downloading ${progress.done}/${progress.total}…` : 'Download factory pack'
            }
            onClick={() => void handleDownload()}
            disabled={busy || packEmpty || auth.status !== 'connected'}
          />
          {!packEmpty && auth.status !== 'connected' && (
            <HardwareButton
              label="Connect Tone3000"
              onClick={() => void auth.connect()}
              disabled={busy}
            />
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="srOnly"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleImportFile(file)
              e.target.value = ''
            }}
          />
          <HardwareButton
            label="Import session"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          />
          <OutlineButton onClick={() => void handleSkip()} disabled={busy}>
            Skip
          </OutlineButton>
        </div>

        {packEmpty && (
          <p className={styles.hint}>
            The factory pack isn&apos;t curated yet — use Skip to start with the built-in presets,
            or Import a backup.
          </p>
        )}
        {needsConnect && (
          <p className={styles.hint}>Connect Tone3000 above, then press Download again.</p>
        )}
        {error && <p className={styles.error}>{error}</p>}
      </div>
    </Dialog>
  )
}
