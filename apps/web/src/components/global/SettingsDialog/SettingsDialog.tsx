import { useEffect, useRef, useState } from 'react'
import type { GraphRig } from '../../../engine/GraphRig'
import type { EngineStatus } from '../../../hooks/useAudioEngine'
import { useIOStore, type InputChannelMode, type LatencyHint } from '../../../state/ioStore'
import { getOpenAxe, getShellKind, shellOwnsAudioDevice } from '../../../native/openaxe'
import { useSettingsStore } from '../../../state/settingsStore'
import { useTone3000Auth } from '../../../tone3000/authStore'
import { downloadFactoryPack, type FactoryDownloadSummary } from '../../../factory/factoryDownload'
import { FACTORY_PACK } from '../../../factory/factoryPack'
import { refreshBanks, setFactorySetupDone } from '../../../factory/factorySetup'
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
import { Dialog, HardwareButton, Knob, Select, Toggle } from '@openaxe/ui'
import styles from './SettingsDialog.module.css'
import {
  importAccountTones,
  type AccountImportProgress,
  type AccountImportResult,
  type AccountImportScope,
} from '../../../tone3000/accountImport'
import { Tone3000Library } from '../../../tone3000/library'

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
  // Device selection is only ours when this shell actually opens the device.
  // In a plugin the DAW owns input, output, sample rate and buffer size, so
  // offering pickers for them is offering controls that do nothing
  // (issue #300 E1).
  const ownsAudioDevice = shellOwnsAudioDevice()
  // A plugin has no device of its own at all: the DAW routes a track into it
  // and takes the result back. That is different from the web, which also
  // does not "own" a device but does still choose which microphone to open,
  // so the two cannot share a branch.
  const isPluginShell = getShellKind() === 'plugin'
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
  const [nativeConfig, setNativeConfig] = useState<{
    sampleRate: number
    bufferFrames: number
    latencyMs: number
    latencyFrames: number
  } | null>(null)

  // Account tones bulk import — independent of other settings busy states
  const [factoryBusy, setFactoryBusy] = useState(false)
  const [factoryConfirming, setFactoryConfirming] = useState(false)
  const [factoryProgress, setFactoryProgress] = useState<{ done: number; total: number } | null>(
    null,
  )
  const [factorySummary, setFactorySummary] = useState<FactoryDownloadSummary | null>(null)
  const [factoryError, setFactoryError] = useState<string | null>(null)
  const [accountScope, setAccountScope] = useState<AccountImportScope>('all')
  const [accountBusy, setAccountBusy] = useState(false)
  const [accountProgress, setAccountProgress] = useState<AccountImportProgress | null>(null)
  const [accountSummary, setAccountSummary] = useState<AccountImportResult | null>(null)

  const refreshCacheStats = () => {
    void getAssetCacheStats().then(setCacheStats)
  }

  useEffect(() => {
    if (!open) return
    refreshCacheStats()
    setStatusMessage(null)
    setErrorMessage(null)
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

  // For desktop, poll getConfig() for the real device latency/buffer info.
  // The NativeAudioContext shim always reports 0 for baseLatency/outputLatency,
  // so the diagnostics would otherwise show 0ms/48000Hz even when the device
  // is running at a different rate or buffer size.
  useEffect(() => {
    if (!open || !isNative) return
    let cancelled = false
    const poll = async () => {
      try {
        const bridge = getOpenAxe()
        if (!bridge) return
        const cfg = await bridge.getConfig()
        if (cancelled) return
        if (typeof cfg.sampleRate === 'number' && typeof cfg.bufferFrames === 'number') {
          setNativeConfig({
            sampleRate: cfg.sampleRate,
            bufferFrames: cfg.bufferFrames,
            latencyMs: typeof cfg.latencyMs === 'number' ? cfg.latencyMs : -1,
            latencyFrames: typeof cfg.latencyFrames === 'number' ? cfg.latencyFrames : -1,
          })
        }
      } catch {
        // ignore
      }
    }
    void poll()
    const id = window.setInterval(() => void poll(), 1000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [open, isNative])

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
      setStatusMessage('Cache cleared.')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
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

  const handleFactoryDownload = async () => {
    setFactoryBusy(true)
    setFactoryConfirming(false)
    setFactoryError(null)
    setFactorySummary(null)
    try {
      const result = await downloadFactoryPack((p) =>
        setFactoryProgress({ done: p.done, total: p.total }),
      )
      setFactorySummary(result)
      // Mark first-run setup handled and re-read both banks in place, so the
      // newly placed presets and scene appear without a reload — the same
      // thing the first-run dialog does, and the reason the engine can stay
      // powered on through it.
      setFactorySetupDone()
      await refreshBanks()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setFactoryError(
        message === 'Not authenticated'
          ? 'Downloading the factory pack needs a Tone3000 account connection.'
          : message,
      )
    } finally {
      setFactoryProgress(null)
      setFactoryBusy(false)
    }
  }

  const handleAccountImport = async () => {
    setAccountBusy(true)
    setErrorMessage(null)
    setStatusMessage(null)
    setAccountSummary(null)
    try {
      const result = await importAccountTones({
        scope: accountScope,
        onProgress: (p) => setAccountProgress(p),
      })
      setAccountProgress(null)
      setAccountSummary(result)
      await Tone3000Library.refresh()
      void getAssetCacheStats().then(setCacheStats)
      if (result.tones === 0) {
        setStatusMessage('No tones found for that scope in your Tone3000 account.')
      } else if (result.failed > 0) {
        setErrorMessage(
          `Import: ${result.ok} downloaded, ${result.skipped} already cached, ${result.failed} failed. ${result.errors.slice(0, 3).join('; ')}${result.errors.length > 3 ? '…' : ''}`,
        )
      } else {
        setStatusMessage(
          `Imported ${result.tones} tone(s): ${result.ok} downloaded, ${result.skipped} already cached.`,
        )
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message === 'Not authenticated') {
        setErrorMessage(
          'Importing your account tones needs a Tone3000 account connection — connect above, then retry.',
        )
      } else {
        setErrorMessage(`Account import failed: ${message}`)
      }
      setAccountProgress(null)
    } finally {
      setAccountBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Settings">
      {/* In a plugin there is no device to pick - the DAW decides what feeds
          it and where the result goes - so the input device picker and the
          whole output section are gone. Which channel of the incoming bus the
          rig hears is still a real choice, though: a guitar is one cable on a
          stereo track. */}
      {isPluginShell ? (
        <section className={styles.section}>
          <span className={`label ${styles.sectionLabel}`}>Audio Input</span>
          <div className={styles.row}>
            <Select
              label="Channel"
              value={io.inputChannel}
              onChange={(e) => io.setInputChannel(e.target.value as InputChannelMode)}
              aria-label="Input channel"
              className={styles.field}
            >
              <option value="l">Ch 1</option>
              <option value="r">Ch 2</option>
              <option value="stereo">Stereo</option>
              <option value="sum">Ch 1+2</option>
            </Select>
          </div>
          <p className={styles.sectionHint}>
            Which channels of the track feeding this plugin reach the rig. Ch 1 or Ch 2 sends that
            one in as mono; Ch 1+2 averages them.
          </p>
        </section>
      ) : ownsAudioDevice ? (
        /* Native (desktop): input and output are independent devices - the
         * C++ core opens them as separate createDevice(output, input) names
         * (apps/desktop/src/audio.cpp), so two selectors drive them. */
        <>
          <section className={styles.section}>
            <span className={`label ${styles.sectionLabel}`}>Audio Input</span>
            <div className={styles.row}>
              <Select
                label="Device"
                value={io.inputDeviceId}
                onChange={(e) => io.setInputDevice(e.target.value)}
                aria-label="Input device"
                className={styles.field}
              >
                <option value="">Default input</option>
                {io.inputDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </div>
            {io.micError && <p className={styles.errorText}>{io.micError}</p>}
          </section>

          <section className={styles.section}>
            <span className={`label ${styles.sectionLabel}`}>Audio Output</span>
            <div className={styles.row}>
              <Select
                label="Device"
                value={io.outputDeviceId}
                onChange={(e) => io.setOutputDevice(e.target.value)}
                aria-label="Output device"
                className={styles.field}
              >
                <option value="">Default output</option>
                {io.outputDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </div>
          </section>
        </>
      ) : (
        <>
          {/* Audio input */}
          <section className={styles.section}>
            <span className={`label ${styles.sectionLabel}`}>Audio Input</span>
            <div className={styles.row}>
              <Select
                label="Device"
                value={io.inputDeviceId}
                onChange={(e) => io.setInputDevice(e.target.value)}
                aria-label="Input device"
                className={styles.field}
              >
                <option value="">Default input</option>
                {io.inputDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </Select>
              <Select
                label="Channel"
                value={io.inputChannel}
                onChange={(e) => io.setInputChannel(e.target.value as InputChannelMode)}
                aria-label="Input channel"
                className={styles.field}
              >
                <option value="l">Ch 1</option>
                <option value="r">Ch 2</option>
                <option value="stereo">Stereo</option>
                <option value="sum">Ch 1+2</option>
              </Select>
            </div>
            {io.micError && <p className={styles.errorText}>{io.micError}</p>}
          </section>

          {/* Audio output */}
          <section className={styles.section}>
            <span className={`label ${styles.sectionLabel}`}>Audio Output</span>
            {outputSelectionSupported ? (
              <div className={styles.row}>
                <Select
                  label="Device"
                  value={io.outputDeviceId}
                  onChange={(e) => io.setOutputDevice(e.target.value)}
                  aria-label="Output device"
                  className={styles.field}
                >
                  <option value="">Default output</option>
                  {io.outputDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </Select>
              </div>
            ) : (
              <p className={styles.sectionHint}>
                Output device selection isn't supported in this browser.
              </p>
            )}
          </section>
        </>
      )}

      {/* Buffer size / latency — the DAW owns both in a plugin, so the whole
          section is hidden there rather than left as controls that do nothing.
          That also removes "Restart Audio Engine", which is a power control:
          in a plugin it would tear down the UI's view of a graph the host keeps
          processing. */}
      {ownsAudioDevice && (
        <section className={styles.section}>
          <span className={`label ${styles.sectionLabel}`}>Buffer Size / Latency</span>
          <p className={styles.sectionHint}>
            A smaller buffer responds faster but is more likely to click/drop out on a slower
            machine. Changes only take effect after restarting the audio engine.
          </p>
          <div className={styles.row}>
            <Select
              label="Buffer"
              value={io.latencyHint}
              onChange={(e) => io.setLatencyHint(e.target.value as LatencyHint)}
              aria-label="Buffer size / latency"
              className={styles.field}
            >
              {LATENCY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
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
      )}

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
            <span className={styles.diagValue}>
              {isNative
                ? nativeConfig
                  ? `${nativeConfig.sampleRate} Hz`
                  : context
                    ? `${context.sampleRate} Hz`
                    : '—'
                : context
                  ? `${context.sampleRate} Hz`
                  : '—'}
            </span>
            <span className={`label ${styles.diagLabel}`}>Sample Rate</span>
          </div>
          {isNative ? (
            <>
              <div className={styles.diagItem}>
                <span className={styles.diagValue}>
                  {nativeConfig ? `${nativeConfig.bufferFrames} frames` : '—'}
                </span>
                <span className={`label ${styles.diagLabel}`}>Buffer Frames</span>
              </div>
              <div className={styles.diagItem}>
                <span className={styles.diagValue}>
                  {nativeConfig && nativeConfig.latencyMs >= 0
                    ? `${Math.round(nativeConfig.latencyMs)} ms`
                    : '—'}
                </span>
                <span className={`label ${styles.diagLabel}`}>Round-trip Latency</span>
              </div>
              <div className={styles.diagItem}>
                <span className={styles.diagValue}>
                  {nativeConfig && nativeConfig.latencyFrames >= 0
                    ? `${nativeConfig.latencyFrames} frames`
                    : '—'}
                </span>
                <span className={`label ${styles.diagLabel}`}>Latency Frames</span>
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
          <div className={styles.diagItem}>
            <span className={styles.diagValue}>{rig?.countActiveHeavyBlocks() ?? 0}</span>
            <span className={`label ${styles.diagLabel}`}>Amps/Cabs Loaded</span>
          </div>
        </div>
        {isNative && nativeConfig && (
          <p className={styles.sectionHint}>
            Round-trip is input + output buffering reported by{' '}
            {nativeConfig.latencyFrames >= 0 ? 'the device' : '—'} at {nativeConfig.sampleRate} Hz.
            Lower buffer = lower latency but higher CPU.
          </p>
        )}
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

      {/* Factory pack — the curated starter rig, downloadable after first run.
          It is offered in the first-run dialog, but that dialog is shown once
          and never again, so skipping it (or clearing data later) used to
          leave no way back to the pack. */}
      <section className={styles.section}>
        <span className={`label ${styles.sectionLabel}`}>Factory Pack</span>
        <p className={styles.sectionHint}>
          Downloads the {FACTORY_PACK.models.length} curated amp/cab captures from Tone3000 and
          builds the starter presets from them. Models already in your library are skipped, so
          re-running this only fetches what is missing.
        </p>
        <div className={styles.actions}>
          <HardwareButton
            label={
              factoryProgress
                ? `Downloading ${factoryProgress.done}/${factoryProgress.total}…`
                : 'Download Factory Pack'
            }
            disabled={
              factoryBusy || auth.status !== 'connected' || FACTORY_PACK.models.length === 0
            }
            onClick={() => setFactoryConfirming(true)}
          />
        </div>
        {auth.status !== 'connected' && (
          <p className={styles.sectionHint}>
            Connect your Tone3000 account above to download the pack.
          </p>
        )}
        {factoryConfirming && (
          <div className={styles.confirmBox}>
            <p className={styles.confirmText}>
              This writes the pack&rsquo;s presets into their preset-bank slots, replacing whatever
              is in those slots now. Your other slots, scenes and saved presets are left alone, and
              nothing already downloaded is fetched again.
            </p>
            <div className={styles.actions}>
              <HardwareButton
                label="Download Factory Pack"
                disabled={factoryBusy}
                onClick={() => void handleFactoryDownload()}
              />
              <HardwareButton label="Cancel" onClick={() => setFactoryConfirming(false)} />
            </div>
          </div>
        )}
        {factorySummary && !factoryProgress && (
          <p className={styles.sectionHint}>
            {factorySummary.downloaded} downloaded, {factorySummary.skipped} already cached,{' '}
            {factorySummary.placedPresets} preset(s) placed
            {factorySummary.failed.length > 0 ? `, ${factorySummary.failed.length} failed` : ''}.
          </p>
        )}
        {factorySummary && factorySummary.failed.length > 0 && (
          <p className={styles.errorText}>
            {factorySummary.failed
              .slice(0, 3)
              .map((f) => `${f.name}: ${f.error}`)
              .join('; ')}
            {factorySummary.failed.length > 3 ? '…' : ''}
          </p>
        )}
        {factoryError && <p className={styles.errorText}>{factoryError}</p>}
      </section>

      {/* Tone3000 Library — bulk import from account history */}
      <section className={styles.section}>
        <span className={`label ${styles.sectionLabel}`}>
          Tone3000 Library — Import Account Tones
        </span>
        <p className={styles.sectionHint}>
          Bulk-download every model file from your Tone3000 account into the local library. Choose
          the scope, then import — skips anything already cached, throttled to Tone3000’s 100
          req/min.
        </p>
        <div className={styles.row}>
          <Select
            label="Scope"
            value={accountScope}
            onChange={(e) => setAccountScope(e.target.value as AccountImportScope)}
            aria-label="Account tones scope"
            className={styles.field}
            disabled={accountBusy}
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
            disabled={accountBusy || auth.status !== 'connected'}
            onClick={() => void handleAccountImport()}
          />
        </div>
        {auth.status !== 'connected' && (
          <p className={styles.sectionHint}>Connect your Tone3000 account above to import.</p>
        )}
        {accountProgress && (
          <p className={styles.sectionHint}>
            {accountProgress.status === 'fetching_models'
              ? `Fetching models for ${accountProgress.toneTitle}…`
              : accountProgress.status === 'downloading'
                ? `Downloading ${accountProgress.toneTitle}…`
                : `${accountProgress.toneTitle} — ${accountProgress.status}`}{' '}
            {accountProgress.currentTone}/{accountProgress.totalTones} tones
          </p>
        )}
        {accountSummary && !accountProgress && (
          <p className={styles.sectionHint}>
            {accountSummary.tones} tone(s): {accountSummary.ok} downloaded, {accountSummary.skipped}{' '}
            already cached
            {accountSummary.failed > 0 ? `, ${accountSummary.failed} failed` : ''}.
          </p>
        )}
        {accountSummary && accountSummary.errors.length > 0 && (
          <p className={styles.errorText}>
            {accountSummary.errors.slice(0, 3).join('; ')}
            {accountSummary.errors.length > 3 ? '…' : ''}
          </p>
        )}
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
          {!deleteConfirming && (
            <>
              <HardwareButton
                label="Export"
                disabled={busy === 'export'}
                onClick={() => void handleExport()}
              />
              <HardwareButton
                label="Import"
                disabled={busy === 'import'}
                onClick={() => fileInputRef.current?.click()}
              />
              <HardwareButton
                label="Delete"
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
            </>
          )}
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
