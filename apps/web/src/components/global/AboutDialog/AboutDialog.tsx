import { Dialog, Wordmark } from '@openaxe/ui'
import pkg from '../../../../package.json'
import { LANDING_DOWNLOAD_URL, LANDING_RELEASES_URL } from '@/config/landing'
import styles from './AboutDialog.module.css'

export interface AboutDialogProps {
  open: boolean
  onClose: () => void
}

export function AboutDialog({ open, onClose }: AboutDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="About OpenAxe" width="560px">
      <div className={styles.body}>
        <div className={styles.hero}>
          <Wordmark version={pkg.version} />
          <p className={styles.description}>{pkg.description}</p>
          <p className={styles.version}>v{pkg.version} · 2024–2026 OpenAxe</p>
        </div>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Download</h3>
          <ul className={styles.list}>
            <li>
              <a href={LANDING_DOWNLOAD_URL} target="_blank" rel="noreferrer">
                Desktop app
              </a>{' '}
              — macOS, Windows &amp; Linux
            </li>
            <li>
              <a href={LANDING_DOWNLOAD_URL} target="_blank" rel="noreferrer">
                DAW plugin
              </a>{' '}
              — VST3, CLAP &amp; AU
            </li>
            <li>
              <a href={LANDING_RELEASES_URL} target="_blank" rel="noreferrer">
                All releases
              </a>{' '}
              — every version, with checksums
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Built with</h3>
          <ul className={styles.list}>
            <li>Neural Amp Modeler — amp &amp; pedal captures</li>
            <li>
              <a href="https://www.tone3000.com" target="_blank" rel="noreferrer">
                TONE3000
              </a>{' '}
              — models &amp; IR library
            </li>
            <li>
              Made with ❤ by{' '}
              <a href="https://hotdogtor.com" target="_blank" rel="noreferrer">
                Hot Dogtor
              </a>
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Technology</h3>
          <p className={styles.text}>
            Web: Vite + React + AudioWorklet + WASM. Desktop: C++ + native webview + miniaudio.
            Plugin: VST3/CLAP/AU with the same C++ DSP core and React editor across every target.
          </p>
          <p className={styles.text}>
            Amp models run through Neural Amp Modeler; cabinet and effect processing share one core
            so a rig sounds the same in the browser, on the desktop and in your DAW.
          </p>
        </section>
      </div>
    </Dialog>
  )
}
