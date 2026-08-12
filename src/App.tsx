import { ChannelStrip } from './components/ChannelStrip'
import { MasterSection } from './components/MasterSection'
import { SignalFlow } from './components/SignalFlow'
import { HardwareButton } from './components/primitives/HardwareButton'
import { Led } from './components/primitives/Led'
import { useAudioEngine } from './hooks/useAudioEngine'
import styles from './App.module.css'

const STATUS_LABEL: Record<string, string> = {
  off: 'Power off',
  starting: 'Starting…',
  ready: 'Running',
  error: 'Error',
}

function App() {
  const engine = useAudioEngine()
  const isReady = engine.status === 'ready'

  return (
    <div className={styles.chassis}>
      <header className={styles.header}>
        <div className={styles.wordmark}>
          <span className={styles.dot} />
          NAM WEB STUDIO
        </div>
        <div className={styles.powerGroup}>
          <span className={styles.statusText}>
            {STATUS_LABEL[engine.status]}
            {isReady && !engine.micGranted ? ' · no mic' : ''}
          </span>
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

      <main className={styles.main}>
        <SignalFlow />

        <div className={styles.chains}>
          <ChannelStrip chain="A" rig={engine.rig} />
          <ChannelStrip chain="B" rig={engine.rig} />
        </div>

        <MasterSection analyser={engine.analyser} />
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
      </footer>
    </div>
  )
}

export default App
