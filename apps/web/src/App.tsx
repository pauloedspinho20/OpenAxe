import { useEffect, useRef } from 'react'
import { GridEditor } from './components/grid/GridEditor/GridEditor'
import { MidiManager } from './components/midi/MidiManager/MidiManager'
import { PresetManager } from './components/presets/PresetManager/PresetManager'
import { SceneBar } from './components/scenes/SceneBar/SceneBar'
import { SceneManager } from './components/scenes/SceneManager/SceneManager'
import { Tone3000Browser } from './components/Tone3000Browser/Tone3000Browser'
import { OnboardingModal } from './components/global/OnboardingModal/OnboardingModal'
import { PowerGate } from './components/global/PowerGate/PowerGate'
import { SettingsDialog } from './components/global/SettingsDialog/SettingsDialog'
import { HeaderPerfWidget } from './components/global/HeaderPerfWidget/HeaderPerfWidget'
import {
  HardwareButton,
  IconButton,
  Led,
  MidiIcon,
  PowerIcon,
  SettingsIcon,
  Toggle,
  Toaster,
  Wordmark,
} from '@openaxe/ui'
import pkg from '../package.json'
import { useAudioEngine } from './hooks/useAudioEngine'
import { useAudioIO } from './hooks/useAudioIO'
import { useMidiEngine } from './hooks/useMidiEngine'
import { useOnboarding } from './hooks/useOnboarding'
import { useSceneEngine } from './hooks/useSceneEngine'
import { useSceneHotkeys } from './hooks/useSceneHotkeys'
import { useUndoRedoHotkeys } from './hooks/useUndoRedoHotkeys'
import { useTheme } from './hooks/useTheme'
import { RedoIcon, UndoIcon } from './components/grid/blockIcons'
import { setHistoryTarget, useHistoryStore } from './state/historyStore'
import { useTone3000Target } from './hooks/useTone3000Target'
import { useTone3000Auth, handleTone3000CallbackOnLoad } from './tone3000/authStore'
import { useSongEngine } from './songs/useSongEngine'
import { SongsLibrary, openSongsLibrary } from './songs/SongsLibrary'
import { PlayerWidget } from './songs/PlayerWidget'
import { SheetViewer } from './songs/SheetViewer'
import { PracticeToolkit } from './songs/PracticeToolkit'
import { useSongsStore } from './songs/songsStore'
import { useTakesStore } from './recorder/takesStore'
import { MixerPanel } from './mixer/MixerPanel'
import { RecordPanel } from './recorder/RecordPanel'
import { TakesManager, openTakesManager } from './recorder/TakesManager'
import { SessionManager, openSessionManager } from './recorder/SessionManager'
import { useTone3000Browser } from './tone3000/browserStore'
import { Tone3000Library } from './tone3000/library'
import { installFactoryScenes } from './scenes/factoryScenes'
import { useIOStore } from './state/ioStore'
import { useSettingsStore } from './state/settingsStore'
import { useMidiManager } from './state/midiManager'
import { useMidiStore } from './state/midiStore'
import { useEngineVersion } from './state/engineVersion'
import { hydrateSceneStore } from './state/sceneStore'
import { installFactoryPresets } from './presets/factoryPresets'
import { useUpdateCheck } from './hooks/useUpdateCheck'

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

  const { latest: updateLatest, dismiss: dismissUpdate } = useUpdateCheck()
  const toastedTagRef = useRef<string | null>(null)

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
  useUndoRedoHotkeys()
  useMidiEngine()
  useSongEngine(engine)

  useEffect(() => {
    void useSongsStore.getState().load()
  }, [])

  useEffect(() => {
    void useTakesStore.getState().load()
  }, [])

  // Post-power-on update toast — PowerGate already shows the banner pre-power-on
  useEffect(() => {
    if (isReady && updateLatest && toastedTagRef.current !== updateLatest.tag) {
      toastedTagRef.current = updateLatest.tag
      // also surface via persistent in-app banner; toast is optional transient
    }
  }, [isReady, updateLatest])

  const canUndo = useHistoryStore((s) => s.canUndo)
  const canRedo = useHistoryStore((s) => s.canRedo)
  const undo = useHistoryStore((s) => s.undo)
  const redo = useHistoryStore((s) => s.redo)
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
  const undoTitle = `Undo (${isMac ? '⌘Z' : 'Ctrl+Z'})`
  const redoTitle = `Redo (${isMac ? '⇧⌘Z' : 'Ctrl+Shift+Z / Ctrl+Y'})`

  useEffect(() => {
    if (engine.rig && engine.context) setHistoryTarget({ rig: engine.rig, context: engine.context })
    else setHistoryTarget(null)
  }, [engine.rig, engine.context])

  const tone3000Target = useTone3000Target(engine.rig, browser.target, engineVersion)

  return (
    <div className={styles.chassis}>
      <header className={styles.header}>
        <div className={`${styles.headerGroup} ${styles.brand}`}>
          <Wordmark version={pkg.version} />
        </div>

        <div className={`${styles.headerGroup} ${styles.status}`}>
          <Led on={isReady} color={engine.status === 'error' ? 'statusRed' : 'statusGreen'} />
          <span className={styles.statusText}>
            {STATUS_LABEL[engine.status]}
            {isReady && engine.noSound
              ? ' · no sound'
              : isReady && !engine.micGranted
                ? ' · no mic'
                : ''}
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
          <HardwareButton
            label="SONGS"
            onClick={openSongsLibrary}
            title="Browse songs — import, play, practice"
          />
          <HardwareButton
            label="TAKES"
            onClick={openTakesManager}
            title="Browse takes — rename, download, import"
          />
          <HardwareButton
            label="SESSIONS"
            onClick={openSessionManager}
            title="Save/load mixer + song/takes"
          />
          <IconButton
            label="Undo"
            disabled={!canUndo}
            title={undoTitle}
            onClick={() => void undo()}
          >
            <UndoIcon size={16} />
          </IconButton>
          <IconButton
            label="Redo"
            disabled={!canRedo}
            title={redoTitle}
            onClick={() => void redo()}
          >
            <RedoIcon size={16} />
          </IconButton>
        </div>

        <div className={styles.headerGroup}>
          <HardwareButton
            label="Settings"
            icon={<SettingsIcon size={22} />}
            iconOnly
            onClick={openSettings}
            title="Open app settings"
          />
          <HardwareButton
            label="MIDI"
            icon={<MidiIcon size={20} />}
            iconOnly
            active={midiConnected}
            onClick={openMidiManager}
            title={midiStatusTitle}
          />
          {isReady && (
            <HardwareButton
              label="Power off"
              icon={<PowerIcon size={22} />}
              iconOnly
              active
              onClick={() => void engine.powerOff()}
            />
          )}
        </div>
      </header>

      {engine.error && <div className={styles.errorBanner}>{engine.error}</div>}
      {updateLatest && isReady && (
        <div className={styles.updateBanner} role="status" aria-live="polite">
          <span>New version {updateLatest.tag} available</span>
          <span style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <a
              href="https://pauloedspinho20.github.io/OpenAxe/#download"
              target="_blank"
              rel="noopener"
            >
              Download
            </a>
            <button
              type="button"
              className={styles.updateDismiss}
              onClick={dismissUpdate}
              aria-label="Dismiss update"
            >
              Dismiss
            </button>
          </span>
        </div>
      )}
      {io.micError && engine.status === 'ready' && !engine.micGranted && (
        <div className={styles.errorBanner}>
          {io.micError.includes('NotAllowedError') || io.micError.includes('Permission')
            ? 'Mic access denied — check browser permissions to enable audio input.'
            : `Mic error: ${io.micError}`}
        </div>
      )}
      <SceneBar rig={engine.rig} context={engine.context} />

      <PlayerWidget />

      <MixerPanel rig={engine.rig} status={engine.status} />

      <RecordPanel rig={engine.rig} status={engine.status} />

      <main className={styles.main}>
        <GridEditor
          rig={engine.rig}
          tunerAnalyser={engine.tunerAnalyser}
          analyser={engine.analyser}
          outputSelectionSupported={outputSelectionSupported}
          context={engine.context}
        />
        <SheetViewer />
        <PracticeToolkit />
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
      <SongsLibrary />
      <TakesManager rig={engine.rig} />
      <SessionManager />
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
        outputSelectionSupported={outputSelectionSupported}
        onPowerOn={(opts) => void engine.powerOn(opts)}
      />
      <OnboardingModal open={onboarding.open} onDismiss={onboarding.dismiss} />
      <Toaster />
    </div>
  )
}

export default App
