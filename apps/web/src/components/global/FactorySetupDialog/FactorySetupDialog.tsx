import { useRef, useState } from 'react'
import { Dialog, HardwareButton, OutlineButton, Select } from '@openaxe/ui'
import { useTone3000Auth } from '../../../tone3000/authStore'
import { Tone3000Library } from '../../../tone3000/library'
import { downloadFactoryPack, type FactoryDownloadSummary } from '../../../factory/factoryDownload'
import { FACTORY_PACK } from '../../../factory/factoryPack'
import {
  importAccountTones,
  type AccountImportProgress,
  type AccountImportResult,
  type AccountImportScope,
} from '../../../tone3000/accountImport'
import {
  installOfflineFactorySetup,
  refreshBanks,
  setFactorySetupDone,
} from '../../../factory/factorySetup'
import { importDataBundle, readDataBundleFromFile } from '../../../settings/dataBundle'
import { flushPresetBank } from '../../../state/presetBankStore'
import { flushSceneBank } from '../../../state/sceneStore'
import { useMidiStore } from '../../../state/midiStore'
import styles from './FactorySetupDialog.module.css'

export interface FactorySetupDialogProps {
  open: boolean
  /** Called once the user picks a path so the shell stops showing the offer. */
  onDone: () => void
}

const NOT_AUTHENTICATED = 'Not authenticated'

/**
 * First-run setup, shown once on a fresh browser after power-on. It's a
 * purely optional offer - scenes and presets are already hydrated (empty) by
 * bootstrapFactorySetup, so the app is fully usable offline without logging
 * in or downloading anything. Paths:
 *  - Download the curated factory pack through the user's Tone3000 account,
 *  - Import the user's own Tone3000 account tones (downloaded history,
 *    favorites, or created) into the local library - independent of the
 *    curated pack and reachable with a scope selector,
 *  - Import a whole-app backup (scenes + presets + assets),
 *  - Skip - seed the offline FX-only starters (10 FX-only presets, no models),
 *  - Start empty - persist the freshly-hydrated empty banks (0 presets).
 * Every path completes IN PLACE (no page reload, so the engine stays powered
 * on): it writes the chosen banks to IndexedDB, re-hydrates the stores, and
 * calls onDone. Download failures are surfaced in the dialog so the user can
 * retry or continue with whatever downloaded, rather than being whisked back
 * to the power gate.
 */
export function FactorySetupDialog({ open, onDone }: FactorySetupDialogProps) {
  const auth = useTone3000Auth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsConnect, setNeedsConnect] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [summary, setSummary] = useState<FactoryDownloadSummary | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Account-tones bulk import — fully independent of the factory-pack flow
  // (separate busy/progress/summary so the two can run without blocking each other).
  const [accountScope, setAccountScope] = useState<AccountImportScope>('all')
  const [accountBusy, setAccountBusy] = useState(false)
  const [accountProgress, setAccountProgress] = useState<AccountImportProgress | null>(null)
  const [accountSummary, setAccountSummary] = useState<AccountImportResult | null>(null)
  const [accountError, setAccountError] = useState<string | null>(null)
  const [accountNeedsConnect, setAccountNeedsConnect] = useState(false)

  if (!open) return null

  const packEmpty = FACTORY_PACK.models.length === 0
  const offline = typeof navigator !== 'undefined' && !navigator.onLine

  /** Persist the choice and close the dialog in place (no reload -> no PowerGate). */
  const finish = async () => {
    setFactorySetupDone()
    await refreshBanks()
    onDone()
  }

  const handleDownload = async () => {
    setBusy(true)
    setError(null)
    setNeedsConnect(false)
    setSummary(null)
    try {
      const result = await downloadFactoryPack((p) => setProgress({ done: p.done, total: p.total }))
      setProgress(null)
      setSummary(result)
      // Auto-close when every model landed; otherwise keep the dialog open so
      // the failures can be seen and retried.
      if (result.failed.length === 0) {
        await finish()
      } else {
        setBusy(false)
      }
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

  const handleAccountImport = async () => {
    setAccountBusy(true)
    setAccountError(null)
    setAccountNeedsConnect(false)
    setAccountSummary(null)
    setAccountProgress(null)
    try {
      const result = await importAccountTones({
        scope: accountScope,
        onProgress: (p) => setAccountProgress(p),
      })
      setAccountProgress(null)
      setAccountSummary(result)
      await Tone3000Library.refresh()
      if (result.failed > 0) {
        setAccountError(
          `${result.ok} downloaded, ${result.skipped} already cached, ${result.failed} failed. ${result.errors.slice(0, 3).join('; ')}${result.errors.length > 3 ? '…' : ''}`,
        )
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message === NOT_AUTHENTICATED) {
        setAccountNeedsConnect(true)
        setAccountError('Importing your account tones needs a Tone3000 account connection.')
      } else {
        setAccountError(`Account import failed: ${message}`)
      }
    } finally {
      setAccountBusy(false)
    }
  }

  const handleImportFile = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const bundle = await readDataBundleFromFile(file)
      await importDataBundle(bundle)
      // Restore the in-memory stores the backup just replaced, without reloading.
      await refreshBanks()
      await Tone3000Library.refresh()
      useMidiStore.setState({ loaded: false })
      void useMidiStore.getState().loadConfig()
      await finish()
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
      await finish()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  /** No Tone3000 needed: keep the freshly-hydrated empty banks and move on. */
  const handleStartEmpty = async () => {
    // The empty banks were only hydrated in memory - persist them before
    // closing so the next boot sees a real (empty) session.
    flushSceneBank()
    flushPresetBank()
    await finish()
  }

  const failedCount = summary?.failed.length ?? 0

  return (
    <Dialog open title="GET STARTED" onClose={() => {}} width="min(480px, 92vw)" zIndex={120}>
      <div className={styles.content}>
        {/* <p className={styles.copy}>
          {packEmpty
            ? 'Download a curated factory pack of NAM models, restore a backup, or just start from scratch - no Tone3000 login required.'
            : 'Download a curated pack of amp / cab / pedal models through your Tone3000 account, restore a backup, or just start from scratch - no Tone3000 login required.'}
        </p> */}

        <div className={styles.actions}>
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
          <OutlineButton onClick={() => void handleStartEmpty()} disabled={busy}>
            Start empty
          </OutlineButton>
          <OutlineButton onClick={() => void handleSkip()} disabled={busy}>
            Skip
          </OutlineButton>
        </div>

        {auth.status === 'connected' && (
          <div className={styles.actions}>
            <HardwareButton
              label={
                progress
                  ? `Downloading ${progress.done}/${progress.total}…`
                  : 'Download factory pack'
              }
              onClick={() => void handleDownload()}
              disabled={busy || packEmpty || auth.status !== 'connected'}
            />

            <p className={styles.hint} style={{ marginBottom: 4 }}>
              Or import your own Tone3000 account tones directly into the library — separate from
              the curated factory pack.
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Select
                value={accountScope}
                onChange={(e) => setAccountScope(e.target.value as AccountImportScope)}
                aria-label="Account tones scope"
                disabled={accountBusy}
                style={{ flex: 1 }}
              >
                <option value="all">All</option>
                <option value="downloaded">Downloaded</option>
                <option value="favorited">Favorited</option>
                <option value="created">My models</option>
              </Select>
              <HardwareButton
                label={
                  accountProgress
                    ? `Importing ${accountProgress.currentTone}/${accountProgress.totalTones}…`
                    : 'Import from Tone3000 account'
                }
                onClick={() => void handleAccountImport()}
                disabled={accountBusy || auth.status !== 'connected'}
              />
            </div>
            {auth.status !== 'connected' && !accountBusy && (
              <HardwareButton
                label="Connect Tone3000"
                onClick={() => void auth.connect()}
                disabled={accountBusy}
              />
            )}
            {accountProgress && (
              <p className={styles.hint}>
                {accountProgress.status === 'fetching_models'
                  ? `Fetching models for ${accountProgress.toneTitle}…`
                  : accountProgress.status === 'downloading'
                    ? `Downloading ${accountProgress.toneTitle}…`
                    : `${accountProgress.toneTitle} — ${accountProgress.status}`}
                {' — '}
                {accountProgress.currentTone}/{accountProgress.totalTones} tones
              </p>
            )}
            {accountSummary && !accountProgress && (
              <p className={styles.hint}>
                {accountSummary.tones} tone(s): {accountSummary.ok} downloaded,{' '}
                {accountSummary.skipped} already cached
                {accountSummary.failed > 0 ? `, ${accountSummary.failed} failed` : ''}.
              </p>
            )}
            {accountNeedsConnect && (
              <p className={styles.hint}>Connect Tone3000 above, then press Import again.</p>
            )}
            {accountError && <p className={styles.error}>{accountError}</p>}
            {accountSummary && accountSummary.errors.length > 0 && (
              <div className={styles.failures}>
                <ul className={styles.failureList}>
                  {accountSummary.errors.slice(0, 5).map((e, idx) => (
                    <li key={idx}>{e}</li>
                  ))}
                </ul>
                {accountSummary.errors.length > 5 && (
                  <p className={styles.hint}>…and {accountSummary.errors.length - 5} more</p>
                )}
              </div>
            )}
          </div>
        )}

        {failedCount > 0 && (
          <div className={styles.failures}>
            <p className={styles.error}>
              {summary!.downloaded + summary!.skipped} model(s) ready, but {failedCount} failed to
              download{offline ? ' - you appear to be offline' : ''}:
            </p>
            <ul className={styles.failureList}>
              {summary!.failed.map((f) => (
                <li key={f.name}>
                  <strong>{f.name}</strong> — {f.error}
                </li>
              ))}
            </ul>
            <div className={styles.actions}>
              <HardwareButton label="Retry" onClick={() => void handleDownload()} disabled={busy} />
              <OutlineButton onClick={() => void finish()} disabled={busy}>
                Continue with what downloaded
              </OutlineButton>
            </div>
          </div>
        )}

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
