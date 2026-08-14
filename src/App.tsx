import { useEffect } from 'react'
import { GridEditor } from './components/grid/GridEditor'
import { BlockInspector } from './components/grid/BlockInspector'
import { MidiManager } from './components/midi/MidiManager'
import { PresetManager } from './components/presets/PresetManager'
import { SceneBar } from './components/scenes/SceneBar'
import { SceneManager } from './components/scenes/SceneManager'
import { Tone3000Browser } from './components/Tone3000Browser'
import { OnboardingModal } from './components/OnboardingModal'
import { PowerGate } from './components/PowerGate'
import { SettingsDialog } from './components/SettingsDialog'
import { HeaderPerfWidget } from './components/HeaderPerfWidget'
import { HardwareButton } from './components/primitives/HardwareButton'
import { Led } from './components/primitives/Led'
import { Toggle } from './components/primitives/Toggle'
import { useAudioEngine } from './hooks/useAudioEngine'
import { useAudioIO } from './hooks/useAudioIO'
import { useMidiEngine } from './hooks/useMidiEngine'
import { useOnboarding } from './hooks/useOnboarding'
import { useSceneEngine } from './hooks/useSceneEngine'
import { useSceneHotkeys } from './hooks/useSceneHotkeys'
import { useTheme } from './hooks/useTheme'
import { useTone3000Target } from './hooks/useTone3000Target'
import { useTone3000Auth, handleTone3000CallbackOnLoad } from './tone3000/authStore'
import { useTone3000Browser } from './tone3000/browserStore'
import { Tone3000Library } from './tone3000/library'
import { installFactoryScenes } from './scenes/factoryScenes'
import { useIOStore } from './state/ioStore'
import { useSettingsStore } from './state/settingsStore'
import { useMidiManager } from './state/midiManager'
import { useMidiStore } from './state/midiStore'
import { useToast } from './state/toast'
import { useEngineVersion } from './state/engineVersion'
import { hydrateSceneStore } from './state/sceneStore'
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
  const openMidiManager = useMidiManager((s) => s.openManager)
  const settingsOpen = useSettingsStore((s) => s.open)
  const openSettings = useSettingsStore((s) => s.openSettings)
  const closeSettings = useSettingsStore((s) => s.closeSettings)
  const midiSupported = useMidiStore((s) => s.supported)
  const midiPermission = useMidiStore((s) => s.permission)
  const midiInputCount = useMidiStore((s) => s.inputs.length)
  const midiMappingCount = useMidiStore((s) => s.mappings.length)
  const midiConnected = midiSupported && midiPermission === 'granted' && midiInputCount > 0
  const midiStatusTitle = !midiSupported
    ? 'Web MIDI not supported in this browser'
    : midiPermission !== 'granted'
      ? 'MIDI not enabled'
      : `MIDI: ${midiInputCount} input${midiInputCount === 1 ? '' : 's'}, ${midiMappingCount} mapping${midiMappingCount === 1 ? '' : 's'}`

  // Complete a Tone3000 OAuth redirect-back on launch, refresh the local
  // library metadata, and make sure the bundled starter presets/scenes exist.
  // Network-free when Tone3000 isn't configured.
  useEffect(() => {
    void handleTone3000CallbackOnLoad()
    void Tone3000Library.refresh()
    void installFactoryPresets()
    void installFactoryScenes().then(hydrateSceneStore)
  }, [])

  useSceneEngine(engine.rig, engine.context, engine.status)
  useSceneHotkeys()
  useMidiEngine()

  const tone3000Target = useTone3000Target(engine.rig, browser.target, engineVersion)

  return (
    <div className={styles.chassis}>
      <header className={styles.header}>
        <div className={`${styles.headerGroup} ${styles.brand}`}>
          <div className={styles.wordmark}>
            <img src="./logo.png" className={styles.logo} />
            NAM WEB STUDIO
          </div>
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
          <HeaderPerfWidget context={engine.context} />
        </div>

        <div className={styles.headerGroup}>
          <Toggle
            label="Theme"
            checked={theme === 'light'}
            onChange={(checked) => setTheme(checked ? 'light' : 'dark')}
          />
        </div>

        <div className={styles.headerGroup}>
          <HardwareButton label="SETTINGS" onClick={openSettings} title="Open app settings" />
          <HardwareButton
            label="MIDI"
            active={midiConnected}
            onClick={openMidiManager}
            title={midiStatusTitle}
          />
          {isReady && (
            <HardwareButton label="POWER OFF" active onClick={() => void engine.powerOff()} />
          )}
        </div>
      </header>

      {engine.error && <div className={styles.errorBanner}>{engine.error}</div>}
      {io.micError && engine.status === 'ready' && !engine.micGranted && (
        <div className={styles.errorBanner}>
          {io.micError.includes('NotAllowedError') || io.micError.includes('Permission')
            ? 'Mic access denied — check browser permissions to enable audio input.'
            : `Mic error: ${io.micError}`}
        </div>
      )}
      {toastMessage && <div className={styles.noticeBanner}>{toastMessage}</div>}

      <SceneBar rig={engine.rig} context={engine.context} />

      <main className={styles.main}>
        <GridEditor
          rig={engine.rig}
          tunerAnalyser={engine.tunerAnalyser}
          analyser={engine.analyser}
          outputSelectionSupported={outputSelectionSupported}
          context={engine.context}
        />

        <BlockInspector rig={engine.rig} context={engine.context} />
      </main>

      <footer className={styles.footer}>
        <span>
          Built using{' '}
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

        <span>
          Made with ❤ by{' '}
          <a href="https://hotdogtor.com" target="_blank" rel="noreferrer">
            Hot Dogtor
          </a>
        </span>
      </footer>

      <Tone3000Browser target={tone3000Target} context={engine.context} />
      <PresetManager rig={engine.rig} context={engine.context} />
      <SceneManager />
      <MidiManager />
      <SettingsDialog
        open={settingsOpen}
        onClose={closeSettings}
        rig={engine.rig}
        context={engine.context}
        status={engine.status}
        outputSelectionSupported={outputSelectionSupported}
        onPowerOff={engine.powerOff}
        onPowerOn={engine.powerOn}
      />
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
