import { useEffect, useMemo } from 'react'
import { GridEditor } from './components/grid/GridEditor'
import { BlockInspector } from './components/grid/BlockInspector'
import { MasterSection } from './components/MasterSection'
import { MasterUtility } from './components/MasterUtility'
import { PresetManager } from './components/presets/PresetManager'
import { Tone3000Browser } from './components/Tone3000Browser'
import { HardwareButton } from './components/primitives/HardwareButton'
import { Led } from './components/primitives/Led'
import { Toggle } from './components/primitives/Toggle'
import { useAudioEngine } from './hooks/useAudioEngine'
import { useAudioIO } from './hooks/useAudioIO'
import { useTheme } from './hooks/useTheme'
import { useTone3000Auth, handleTone3000CallbackOnLoad } from './tone3000/authStore'
import { useTone3000Browser } from './tone3000/browserStore'
import { Tone3000Library } from './tone3000/library'
import { useIOStore } from './state/ioStore'
import { useToast } from './state/toast'
import { useEngineVersion } from './state/engineVersion'
import { usePresetManager } from './state/presetManager'
import { installFactoryPresets } from './presets/factoryPresets'
import type { AmpBlock } from './engine/blocks/AmpBlock'
import type { CabBlock } from './engine/blocks/CabBlock'
import type { BlockLoadTarget } from './tone3000/importService'
import type { LatencyHint } from './state/ioStore'
import styles from './App.module.css'

const STATUS_LABEL: Record<string, string> = {
  off: 'Power off',
  starting: 'Starting…',
  ready: 'Running',
  error: 'Error',
}

const LATENCY_OPTIONS: Array<{ value: LatencyHint; label: string }> = [
  { value: 'interactive', label: 'Low latency' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'playback', label: 'Safe' },
]

const LATENCY_HINT: Record<LatencyHint, string> = {
  interactive: 'Lowest possible latency; best for live playing.',
  balanced: 'Moderate latency; conserves CPU.',
  playback: 'Highest latency; safest for weak CPUs or many effects.',
}

/** Soft advisory only, not an enforced cap - see GraphRig.countActiveHeavyBlocks. */
const HEAVY_BLOCK_SOFT_THRESHOLD = 6

function App() {
  const engine = useAudioEngine()
  const { theme, setTheme } = useTheme()
  const isReady = engine.status === 'ready'
  const browser = useTone3000Browser()
  const auth = useTone3000Auth()
  const io = useIOStore()
  const { outputSelectionSupported } = useAudioIO()
  const toastMessage = useToast((s) => s.message)
  // Re-render when the engine's live block state changes (model/IR loads) -
  // graphStore doesn't track that, see engineVersion.ts.
  useEngineVersion((s) => s.version)
  const activeHeavyBlocks = engine.rig?.countActiveHeavyBlocks() ?? 0
  const openPresetManager = usePresetManager((s) => s.openManager)

  // Complete a Tone3000 OAuth redirect-back on launch, refresh the local
  // library metadata, and make sure the bundled starter presets exist.
  // Network-free when Tone3000 isn't configured.
  useEffect(() => {
    void handleTone3000CallbackOnLoad()
    void Tone3000Library.refresh()
    void installFactoryPresets()
  }, [])

  const tone3000Target: BlockLoadTarget | null = useMemo(() => {
    if (!browser.target || !engine.rig) return null
    const block = engine.rig.getBlock(browser.target.blockId)
    if (!block) return null
    if (browser.target.slot === 'model') {
      return {
        loadModel: (json, info) => (block as AmpBlock).loadModel(json, undefined, info),
        loadIR: () => {
          throw new Error('This block is not a Cab block')
        },
      }
    }
    return {
      loadModel: () => {
        throw new Error('This block is not an Amp block')
      },
      loadIR: (buffer, info) => (block as CabBlock).loadIR(buffer, 1, info),
    }
  }, [browser.target, engine.rig])

  return (
    <div className={styles.chassis}>
      <header className={styles.header}>
        <div className={styles.wordmark}>
          <span className={styles.dot} />
          NAM WEB STUDIO
        </div>
        <div className={styles.powerGroup}>
          <Toggle
            label="Aluminum"
            checked={theme === 'light'}
            onChange={(checked) => setTheme(checked ? 'light' : 'dark')}
          />
          <span className={styles.statusText}>
            {STATUS_LABEL[engine.status]}
            {isReady && !engine.micGranted ? ' · no mic' : ''}
          </span>
          {isReady && activeHeavyBlocks > HEAVY_BLOCK_SOFT_THRESHOLD && (
            <span
              className={styles.connectionBadge}
              title="No hard limit, but this many simultaneous amp models/cab IRs may strain your CPU"
            >
              {activeHeavyBlocks} amps/cabs active
            </span>
          )}
          <span className={styles.connectionBadge}>
            {auth.status === 'connected' ? 'TONE3000 ✓' : ''}
          </span>
          {!isReady && (
            <select
              className={styles.latencySelect}
              value={io.latencyHint}
              onChange={(e) => io.setLatencyHint(e.target.value as LatencyHint)}
              aria-label="Latency mode"
              title={LATENCY_HINT[io.latencyHint]}
            >
              {LATENCY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}
          <Led on={isReady} color={engine.status === 'error' ? 'red' : 'green'} />
          <HardwareButton label="Presets" onClick={openPresetManager} />
          <HardwareButton
            label={isReady ? 'Power off' : 'Power on'}
            active={isReady}
            disabled={engine.status === 'starting'}
            onClick={() => void (isReady ? engine.powerOff() : engine.powerOn())}
          />
        </div>
      </header>

      {engine.error && <div className={styles.errorBanner}>{engine.error}</div>}
      {auth.error && auth.status === 'error' && (
        <div className={styles.errorBanner}>Tone3000: {auth.error}</div>
      )}
      {io.micError && engine.status === 'ready' && !engine.micGranted && (
        <div className={styles.errorBanner}>
          {io.micError.includes('NotAllowedError') || io.micError.includes('Permission')
            ? 'Mic access denied — check browser permissions to enable audio input.'
            : `Mic error: ${io.micError}`}
        </div>
      )}
      {toastMessage && <div className={styles.noticeBanner}>{toastMessage}</div>}

      <main className={styles.main}>
        <GridEditor rig={engine.rig} tunerAnalyser={engine.tunerAnalyser} />

        <BlockInspector rig={engine.rig} context={engine.context} />

        <div className={styles.masterRow}>
          <MasterUtility analyser={engine.analyser} />
          <MasterSection outputSelectionSupported={outputSelectionSupported} />
        </div>
      </main>

      <footer className={styles.footer}>
        <span>
          Built on{' '}
          <a
            href="https://github.com/tone-3000/neural-amp-modeler-wasm"
            target="_blank"
            rel="noreferrer"
          >
            Neural Amp Modeler
          </a>
        </span>
        <span className={styles.footerDot}>·</span>
        <span>
          Models &amp; IRs via{' '}
          <a href="https://www.tone3000.com" target="_blank" rel="noreferrer">
            TONE3000
          </a>
        </span>
      </footer>

      <Tone3000Browser target={tone3000Target} context={engine.context} />
      <PresetManager rig={engine.rig} context={engine.context} />
    </div>
  )
}

export default App
