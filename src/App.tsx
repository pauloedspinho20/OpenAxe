import { useEffect } from 'react'
import { GridEditor } from './components/grid/GridEditor'
import { BlockInspector } from './components/grid/BlockInspector'
import { HeaderIO } from './components/HeaderIO'
import { MasterUtility } from './components/MasterUtility'
import { PresetManager } from './components/presets/PresetManager'
import { Tone3000Browser } from './components/Tone3000Browser'
import { OnboardingModal } from './components/OnboardingModal'
import { PowerGate } from './components/PowerGate'
import { HardwareButton } from './components/primitives/HardwareButton'
import { Led } from './components/primitives/Led'
import { Toggle } from './components/primitives/Toggle'
import { useAudioEngine } from './hooks/useAudioEngine'
import { useAudioIO } from './hooks/useAudioIO'
import { useOnboarding } from './hooks/useOnboarding'
import { useTheme } from './hooks/useTheme'
import { useTone3000Target } from './hooks/useTone3000Target'
import { useTone3000Auth, handleTone3000CallbackOnLoad } from './tone3000/authStore'
import { useTone3000Browser } from './tone3000/browserStore'
import { Tone3000Library } from './tone3000/library'
import { useIOStore } from './state/ioStore'
import { useToast } from './state/toast'
import { useEngineVersion } from './state/engineVersion'
import { usePresetManager } from './state/presetManager'
import { installFactoryPresets } from './presets/factoryPresets'
import styles from './App.module.css'

const STATUS_LABEL: Record<string, string> = {
  off: 'Power off',
  starting: 'Starting…',
  ready: 'Running',
  error: 'Error',
}

/** Soft advisory only, not an enforced cap - see GraphRig.countActiveHeavyBlocks. */
const HEAVY_BLOCK_SOFT_THRESHOLD = 6

function App() {
  const engine = useAudioEngine()
  const { theme, setTheme } = useTheme()
  const onboarding = useOnboarding()
  const isReady = engine.status === 'ready'
  const browser = useTone3000Browser()
  const auth = useTone3000Auth()
  const io = useIOStore()
  const { outputSelectionSupported } = useAudioIO()
  const toastMessage = useToast((s) => s.message)
  // Re-render when the engine's live block state changes (model/IR loads) -
  // graphStore doesn't track that, see engineVersion.ts.
  const engineVersion = useEngineVersion((s) => s.version)
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

  const tone3000Target = useTone3000Target(engine.rig, browser.target, engineVersion)

  return (
    <div className={styles.chassis}>
      <header className={styles.header}>
        <div className={`${styles.headerGroup} ${styles.brand}`}>
          <div className={styles.wordmark}>
            <span className={styles.dot} />
            NAM WEB STUDIO
          </div>
        </div>

        <div className={styles.headerGroup}>
          <Toggle
            label="Aluminum"
            checked={theme === 'light'}
            onChange={(checked) => setTheme(checked ? 'light' : 'dark')}
          />
        </div>

        <div className={styles.headerGroup}>
          <HeaderIO outputSelectionSupported={outputSelectionSupported} />
        </div>

        <div className={`${styles.headerGroup} ${styles.status}`}>
          <Led on={isReady} color={engine.status === 'error' ? 'red' : 'green'} />
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
          {auth.status === 'connected' && (
            <span className={styles.connectionBadge}>TONE3000 ✓</span>
          )}
        </div>

        <div className={styles.headerGroup}>
          <HardwareButton label="Presets" onClick={openPresetManager} />
          {isReady && (
            <HardwareButton label="Power off" active onClick={() => void engine.powerOff()} />
          )}
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

        <MasterUtility analyser={engine.analyser} />
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
      <PowerGate
        status={engine.status}
        error={engine.error}
        latencyHint={io.latencyHint}
        onLatencyChange={io.setLatencyHint}
        onPowerOn={() => void engine.powerOn()}
      />
      <OnboardingModal open={onboarding.open} onDismiss={onboarding.dismiss} />
    </div>
  )
}

export default App
