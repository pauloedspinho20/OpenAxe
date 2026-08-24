import { useEffect, useRef, useState } from 'react'
import type { GraphRig } from '../../../engine/GraphRig'
import type { EngineStatus } from '../../../hooks/useAudioEngine'
import { useIOStore, type InputChannelMode, type LatencyHint } from '../../../state/ioStore'
import { getOpenAxe } from '../../../native/openaxe'
import { useSettingsStore } from '../../../state/settingsStore'
import { useTone3000Auth } from '../../../tone3000/authStore'
import {
  buildDataBundle,
  clearAssetCache,
  deleteAllData,
  downloadDataBundle,
  getAssetCacheStats,
  importDataBundle,
  readDataBundleFromFile,
  type DataBundle,
} from '../../../settings/dataBundle'
import { getCachedAsset } from '../../../engine/assetCache'
import {
  allFactoryGear,
  cacheFactoryGear,
  loadFactoryManifest,
} from '../../../tone3000/factoryGear'
import { Dialog, HardwareButton, Knob, Toggle } from '@openaxe/ui'
import styles from './SettingsDialog.module.css'

export interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  rig: GraphRig | null
  context: AudioContext | null
  status: EngineStatus
  outputSelectionSupported: boolean
  onPowerOff: () => Promise<void>
  onPowerOn: () => Promise<void>
}

const LATENCY_OPTIONS: Array<{ value: LatencyHint; label: string }> = [
  { value: 'interactive', label: 'Low latency (smallest buffer)' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'playback', label: 'Safe (largest buffer, most stable)' },
]

/** Applies a slim-size fraction to every currently-loaded NAM model on the rig. */
function applyQualityToLoadedModels(rig: GraphRig | null, quality: number): void {
  if (!rig) return
  for (const id of rig.listBlockIds()) {
    const block = rig.getBlock(id) as { setModelSlimSize?: (n: number) => Promise<void> } | null
    void block?.setModelSlimSize?.(quality)
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * The app's central control panel: audio I/O, buffer/latency, NAM model
 * quality, diagnostics, Tone3000 account, cache, and whole-app backup. Opened
 * from the header's SETTINGS button - see App.tsx.
 */
export function SettingsDialog({
  open,
  onClose,
  rig,
  context,
  status,
  outputSelectionSupported,
  onPowerOff,
  onPowerOn,
}: SettingsDialogProps) {
  const io = useIOStore()
  const isNative = getOpenAxe() !== null
  const namQuality = useSettingsStore((s) => s.namQuality)
  const setNamQuality = useSettingsStore((s) => s.setNamQuality)
  const auth = useTone3000Auth()

  const [busy, setBusy] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [cacheStats, setCacheStats] = useState<{ count: number; bytes: number } | null>(null)
  const [importPreview, setImportPreview] = useState<DataBundle | null>(null)
  const [deleteConfirming, setDeleteConfirming] = useState(false)
  const [signOutOnDelete, setSignOutOnDelete] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [factoryStats, setFactoryStats] = useState<{ total: number; cached: number } | null>(null)
  const [factoryError, setFactoryError] = useState<string | null>(null)
  const [factoryProgress, setFactoryProgress] = useState<{ done: number; total: number } | null>(
    null,
  )

  const refreshCacheStats = () => {
    void getAssetCacheStats().then(setCacheStats)
  }

  const refreshFactoryStats = async () => {
    try {
      await loadFactoryManifest()
      const all = allFactoryGear()
      let cached = 0
      await Promise.all(
        all.map(async (e) => {
          const blob = await getCachedAsset(e.id)
          if (blob) cached += 1
        }),
      )
      setFactoryStats({ total: all.length, cached })
    } catch {
      setFactoryStats({ total: 0, cached: 0 })
    }
  }

  useEffect(() => {
    if (!open) return
    refreshCacheStats()
    void refreshFactoryStats()
    setStatusMessage(null)
    setErrorMessage(null)
    setFactoryError(null)
    setFactoryProgress(null)
    setImportPreview(null)
    setDeleteConfirming(false)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const handleQualityChange = (value: number) => {
    setNamQuality(value)
    applyQualityToLoadedModels(rig, value)
  }

  const handleRestartEngine = async () => {
    setBusy('restart')
    setErrorMessage(null)
    try {
      await onPowerOff()
      await onPowerOn()
      setStatusMessage('Audio engine restarted.')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const handleExport = async () => {
    setBusy('export')
    setErrorMessage(null)
    try {
      const bundle = await buildDataBundle()
      downloadDataBundle(bundle)
      setStatusMessage(
        `Exported ${bundle.presets.length} preset(s), ${bundle.library.length} library entr${bundle.library.length === 1 ? 'y' : 'ies'}, ${bundle.assets.length} cached file(s).`,
      )
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const handlePickImportFile = async (file: File) => {
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      setImportPreview(await readDataBundleFromFile(file))
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
    }
  }

  const handleConfirmImport = async () => {
    if (!importPreview) return
    setBusy('import')
    setErrorMessage(null)
    try {
      await importDataBundle(importPreview)
      window.location.reload()
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
      setBusy(null)
    }
  }

  const handleClearCache = async () => {
    setBusy('cache')
    setErrorMessage(null)
    try {
      await clearAssetCache()
      refreshCacheStats()
      void refreshFactoryStats()
      setStatusMessage('Cache cleared.')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const handleFactoryDownloadAll = async () => {
    setBusy('factory')
    setFactoryError(null)
    setFactoryProgress(null)
    try {
      await loadFactoryManifest()
      const all = allFactoryGear()
      if (all.length === 0) return
      let done = 0
      setFactoryProgress({ done: 0, total: all.length })
      const results = await Promise.allSettled(
        all.map(async (entry) => {
          try {
            await cacheFactoryGear(entry)
          } finally {
            done += 1
            setFactoryProgress({ done, total: all.length })
          }
        }),
      )
      const failed = results.filter((r) => r.status === 'rejected').length
      if (failed > 0) setFactoryError(`${failed} factory asset(s) failed to download.`)
      else setStatusMessage(`Factory pack ready — ${all.length} file(s) cached.`)
      refreshCacheStats()
      void refreshFactoryStats()
    } catch (err) {
      setFactoryError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
      setFactoryProgress(null)
    }
  }

  const handleConfirmDelete = async () => {
    setBusy('delete')
    setErrorMessage(null)
    try {
      await deleteAllData({ signOutTone3000: signOutOnDelete })
      window.location.reload()
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Settings" width="min(520px, 90vw)">
      {isNative ? (
        /* Native (desktop): input and output are independent devices - the
         * C++ core opens them as separate createDevice(output, input) names
         * (apps/desktop/src/audio.cpp), so two selectors drive them. */
        <>
          <section className={styles.section}>
            <span className={`label ${styles.sectionLabel}`}>Audio Input</span>
            <div className={styles.row}>
              <label className={styles.field}>
                <span className="label">Device</span>
                <select
                  className={styles.select}
                  value={io.inputDeviceId}
                  onChange={(e) => io.setInputDevice(e.target.value)}
                  aria-label="Input device"
                >
                  <option value="">Default input</option>
                  {io.inputDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {io.micError && <p className={styles.errorText}>{io.micError}</p>}
          </section>

          <section className={styles.section}>
            <span className={`label ${styles.sectionLabel}`}>Audio Output</span>
            <div className={styles.row}>
              <label className={styles.field}>
                <span className="label">Device</span>
                <select
                  className={styles.select}
                  value={io.outputDeviceId}
                  onChange={(e) => io.setOutputDevice(e.target.value)}
                  aria-label="Output device"
                >
                  <option value="">Default output</option>
                  {io.outputDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>
        </>
      ) : (
        <>
          {/* Audio input */}
          <section className={styles.section}>
            <span className={`label ${styles.sectionLabel}`}>Audio Input</span>
            <div className={styles.row}>
              <label className={styles.field}>
                <span className="label">Device</span>
                <select
                  className={styles.select}
                  value={io.inputDeviceId}
                  onChange={(e) => io.setInputDevice(e.target.value)}
                  aria-label="Input device"
                >
                  <option value="">Default input</option>
                  {io.inputDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span className="label">Channel</span>
                <select
                  className={styles.select}
                  value={io.inputChannel}
                  onChange={(e) => io.setInputChannel(e.target.value as InputChannelMode)}
                  aria-label="Input channel"
                >
                  <option value="l">Ch 1</option>
                  <option value="r">Ch 2</option>
                  <option value="stereo">Stereo</option>
                  <option value="sum">Ch 1+2</option>
                </select>
              </label>
            </div>
            {io.micError && <p className={styles.errorText}>{io.micError}</p>}
          </section>

          {/* Audio output */}
          <section className={styles.section}>
            <span className={`label ${styles.sectionLabel}`}>Audio Output</span>
            {outputSelectionSupported ? (
              <div className={styles.row}>
                <label className={styles.field}>
                  <span className="label">Device</span>
                  <select
                    className={styles.select}
                    value={io.outputDeviceId}
                    onChange={(e) => io.setOutputDevice(e.target.value)}
                    aria-label="Output device"
                  >
                    <option value="">Default output</option>
                    {io.outputDevices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : (
              <p className={styles.sectionHint}>
                Output device selection isn't supported in this browser.
              </p>
            )}
          </section>
        </>
      )}

      {/* Buffer size / latency */}
      <section className={styles.section}>
        <span className={`label ${styles.sectionLabel}`}>Buffer Size / Latency</span>
        <p className={styles.sectionHint}>
          A smaller buffer responds faster but is more likely to click/drop out on a slower machine.
          Changes only take effect after restarting the audio engine.
        </p>
        <div className={styles.row}>
          <label className={styles.field}>
            <span className="label">Buffer</span>
            <select
              className={styles.select}
              value={io.latencyHint}
              onChange={(e) => io.setLatencyHint(e.target.value as LatencyHint)}
              aria-label="Buffer size / latency"
            >
              {LATENCY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          {status === 'ready' && (
            <HardwareButton
              label="Restart Audio Engine"
              disabled={busy === 'restart'}
              onClick={() => void handleRestartEngine()}
              title="Power-cycles the audio engine to apply the buffer size"
            />
          )}
        </div>
      </section>

      {/* NAM quality */}
      <section className={styles.section}>
        <span className={`label ${styles.sectionLabel}`}>Neural Amp Modeler Quality</span>
        <p className={styles.sectionHint}>
          Lower quality uses a smaller neural network per model, reducing CPU load at some cost to
          fidelity. Applies immediately to every loaded amp/pedal/outboard/space model, and becomes
          the default for anything you load next.
        </p>
        <div className={styles.qualityRow}>
          <Knob
            label="Quality"
            value={namQuality}
            min={0.01}
            max={1}
            step={0.01}
            defaultValue={1}
            onChange={handleQualityChange}
            formatValue={(v) => `${Math.round(v * 100)}%`}
            size={56}
          />
          <p className={styles.sectionHint}>
            100% is full fidelity. Only affects models captured as "slimmable" (e.g. most Tone3000
            A2 captures) - other models are unaffected.
          </p>
        </div>
      </section>

      {/* Diagnostics */}
      <section className={styles.section}>
        <span className={`label ${styles.sectionLabel}`}>Diagnostics</span>
        <div className={styles.diagGrid}>
          <div className={styles.diagItem}>
            <span className={styles.diagValue}>{context?.state ?? 'off'}</span>
            <span className={`label ${styles.diagLabel}`}>Engine State</span>
          </div>
          <div className={styles.diagItem}>
            <span className={styles.diagValue}>{context ? `${context.sampleRate} Hz` : '—'}</span>
            <span className={`label ${styles.diagLabel}`}>Sample Rate</span>
          </div>
          <div className={styles.diagItem}>
            <span className={styles.diagValue}>
              {context ? `${Math.round(context.baseLatency * 1000)} ms` : '—'}
            </span>
            <span className={`label ${styles.diagLabel}`}>Base Latency</span>
          </div>
          <div className={styles.diagItem}>
            <span className={styles.diagValue}>
              {context ? `${Math.round((context.outputLatency || 0) * 1000)} ms` : '—'}
            </span>
            <span className={`label ${styles.diagLabel}`}>Output Latency</span>
          </div>
          <div className={styles.diagItem}>
            <span className={styles.diagValue}>{rig?.countActiveHeavyBlocks() ?? 0}</span>
            <span className={`label ${styles.diagLabel}`}>Amps/Cabs Loaded</span>
          </div>
        </div>
      </section>

      {/* Tone3000 account */}
      <section className={styles.section}>
        <span className={`label ${styles.sectionLabel}`}>Tone3000 Account</span>
        <div className={styles.row}>
          <p className={styles.sectionHint}>
            {auth.status === 'connected'
              ? `Connected${auth.user ? ` as ${auth.user.username}` : ''}.`
              : 'Not connected - browsing works anonymously, but importing/downloading models needs a connection.'}
          </p>
          {auth.status === 'connected' ? (
            <HardwareButton label="Disconnect" onClick={() => auth.disconnect()} />
          ) : (
            <HardwareButton label="Connect Tone3000" onClick={() => void auth.connect()} />
          )}
        </div>
      </section>

      {/* Factory pack */}
      <section className={styles.section}>
        <span className={`label ${styles.sectionLabel}`}>Factory Pack</span>
        <div className={styles.row}>
          <p className={styles.sectionHint}>
            {factoryStats
              ? factoryStats.total === 0
                ? 'No factory models are curated yet.'
                : `${factoryStats.cached}/${factoryStats.total} factory file(s) cached locally.`
              : 'Loading…'}
          </p>
          <HardwareButton
            label={
              factoryProgress
                ? `Downloading… ${factoryProgress.done}/${factoryProgress.total}`
                : `Download all factory (${factoryStats?.total ?? 0})`
            }
            disabled={
              busy === 'factory' ||
              !factoryStats?.total ||
              factoryStats.cached === factoryStats.total
            }
            onClick={() => void handleFactoryDownloadAll()}
            title={
              factoryStats && factoryStats.cached === factoryStats.total && factoryStats.total > 0
                ? 'All factory files already cached'
                : 'Download every factory model/IR for offline use'
            }
          />
        </div>
        {factoryProgress && (
          <p className={styles.sectionHint}>
            Downloading… {factoryProgress.done}/{factoryProgress.total}
          </p>
        )}
        {factoryError && <p className={styles.errorText}>{factoryError}</p>}
        <p className={styles.sectionHint}>
          Also available per-block via the inspector → Factory tab, or via the header&apos;s FACTORY
          button. Each block can swap its factory model independently.
        </p>
      </section>

      {/* Cache */}
      <section className={styles.section}>
        <span className={`label ${styles.sectionLabel}`}>Model/IR Cache</span>
        <div className={styles.row}>
          <p className={styles.sectionHint}>
            {cacheStats
              ? `${cacheStats.count} file(s), ${formatBytes(cacheStats.bytes)} cached locally.`
              : 'Loading…'}
          </p>
          <HardwareButton
            label="Clear Cache"
            disabled={busy === 'cache' || !cacheStats?.count}
            onClick={() => void handleClearCache()}
            title="Removes downloaded model/IR files - your library list and presets are unaffected, but re-loading them will re-download"
          />
        </div>
      </section>

      {/* User data */}
      <section className={styles.section}>
        <span className={`label ${styles.sectionLabel}`}>User Data</span>
        <p className={styles.sectionHint}>
          Presets, scenes, MIDI mappings, your Tone3000 library, and cached model/IR files -
          everything this app stores on this device.
        </p>
        <div className={styles.actions}>
          <HardwareButton
            label="Export All Data"
            disabled={busy === 'export'}
            onClick={() => void handleExport()}
          />
          <HardwareButton
            label="Import Data…"
            disabled={busy === 'import'}
            onClick={() => fileInputRef.current?.click()}
          />
          <HardwareButton
            label="Delete All Data"
            variant="danger"
            disabled={busy === 'delete'}
            onClick={() => setDeleteConfirming(true)}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="srOnly"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handlePickImportFile(file)
              e.target.value = ''
            }}
          />
        </div>

        {importPreview && (
          <div className={styles.confirmBox}>
            <p className={styles.confirmText}>
              This backup has {importPreview.presets.length} preset(s),{' '}
              {importPreview.library.length} library entr
              {importPreview.library.length === 1 ? 'y' : 'ies'}, {importPreview.assets.length}{' '}
              cached file(s), from {new Date(importPreview.exportedAt).toLocaleString()}. Importing
              replaces <strong>all</strong> current presets, scenes, MIDI mappings, library, and
              cache, then reloads the app.
            </p>
            <div className={styles.actions}>
              <HardwareButton
                label="Yes, Import & Replace Everything"
                variant="danger"
                disabled={busy === 'import'}
                onClick={() => void handleConfirmImport()}
              />
              <HardwareButton label="Cancel" onClick={() => setImportPreview(null)} />
            </div>
          </div>
        )}

        {deleteConfirming && (
          <div className={styles.confirmBox}>
            <p className={styles.confirmText}>
              This permanently deletes every preset, scene, MIDI mapping, library entry, and cached
              file on this device, then reloads the app. This cannot be undone.
            </p>
            <Toggle
              label="Also sign out of Tone3000"
              checked={signOutOnDelete}
              onChange={setSignOutOnDelete}
            />
            <div className={styles.actions}>
              <HardwareButton
                label="Yes, Delete Everything"
                variant="danger"
                disabled={busy === 'delete'}
                onClick={() => void handleConfirmDelete()}
              />
              <HardwareButton label="Cancel" onClick={() => setDeleteConfirming(false)} />
            </div>
          </div>
        )}

        {statusMessage && <p className={styles.statusText}>{statusMessage}</p>}
        {errorMessage && <p className={styles.errorText}>{errorMessage}</p>}
      </section>
    </Dialog>
  )
}
