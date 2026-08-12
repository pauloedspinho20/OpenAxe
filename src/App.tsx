import { useEffect, useMemo } from 'react'
import { ChannelStrip } from './components/ChannelStrip'
import { MasterSection } from './components/MasterSection'
import { SignalFlow } from './components/SignalFlow'
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
import type { ChainId } from './engine/DualChainRig'
import type { ChainLoadTarget } from './tone3000/importService'
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

function App() {
  const engine = useAudioEngine()
  const { theme, setTheme } = useTheme()
  const isReady = engine.status === 'ready'
  const browser = useTone3000Browser()
  const auth = useTone3000Auth()
  const io = useIOStore()
  const { outputSelectionSupported } = useAudioIO()

  // Complete a Tone3000 OAuth redirect-back on launch, and refresh the local
  // library metadata. Network-free when not configured.
  useEffect(() => {
    void handleTone3000CallbackOnLoad()
    void Tone3000Library.refresh()
  }, [])

  const tone3000Target: ChainLoadTarget | null = useMemo(() => {
    if (!browser.target || !engine.rig) return null
    const chain: ChainId = browser.target.chain
    return {
      loadModel: (json, info) => engine.rig!.amp(chain).loadModel(json, undefined, info),
      loadIR: (buffer, info) => engine.rig!.amp(chain).loadIR(buffer, 1, info),
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

      <main className={styles.main}>
        <SignalFlow />

        <div className={styles.chains}>
          <ChannelStrip chain="A" rig={engine.rig} context={engine.context} />
          <ChannelStrip chain="B" rig={engine.rig} context={engine.context} />
        </div>

        <MasterSection
          analyser={engine.analyser}
          outputSelectionSupported={outputSelectionSupported}
        />
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
    </div>
  )
}

export default App
